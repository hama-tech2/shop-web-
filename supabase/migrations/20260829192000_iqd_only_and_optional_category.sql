-- ============================================================
-- Shop Web — 0012
--   * IQD only. Drop the currency columns.
--   * A category is optional: platform_category_id becomes nullable.
--   * Cut the global taxonomy down to the 6 real categories.
-- ============================================================

alter table public.products drop column currency;
alter table public.payments drop column currency;

comment on column public.products.price is 'Always IQD. One price, no discount, no old_price.';
comment on column public.payments.amount is 'Always IQD.';

alter table public.products alter column platform_category_id drop not null;

comment on column public.products.platform_category_id is
  'Optional global category. A seller can post without picking one.';

-- ------------------------------------------------------------
-- 6 categories, exactly as the owner wrote them.
-- ------------------------------------------------------------
update public.platform_categories set name_ckb = 'جل و بەرگ',        name_en = 'Clothing',  slug = 'clothing',    sort_order = 10  where slug = 'women-clothing';
update public.platform_categories set name_ckb = 'جوانکاری و عەتر',  name_en = 'Beauty',    sort_order = 20  where slug = 'beauty';
update public.platform_categories set name_ckb = 'ماڵەوە',           name_en = 'Home',      sort_order = 30  where slug = 'home';
update public.platform_categories set name_ckb = 'ئەلیکترۆنی',       name_en = 'Electronics', sort_order = 40 where slug = 'electronics';
update public.platform_categories set name_ckb = 'خواردن',           name_en = 'Food',      sort_order = 50  where slug = 'food';
update public.platform_categories set name_ckb = 'ئەوانی تر',        name_en = 'Other',     sort_order = 60  where slug = 'other';

delete from public.platform_categories
where slug not in ('clothing', 'beauty', 'home', 'electronics', 'food', 'other');

-- ------------------------------------------------------------
-- admin_apply_payment loses its p_currency argument along with the
-- column. Same plan maths, one fewer thing to get wrong.
-- ------------------------------------------------------------
drop function if exists public.admin_apply_payment(uuid, text, numeric, text, text, text, text);

create or replace function public.admin_apply_payment(
  p_shop      uuid,
  p_plan      text,
  p_amount    numeric,
  p_method    text default 'cash',
  p_reference text default null,
  p_note      text default null
) returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub     public.subscriptions;
  v_months  int;
  v_bonus   int := 0;
  v_base    timestamptz;
  v_payment public.payments;
begin
  if not app.is_admin() then
    raise exception 'only an admin can record payments' using errcode = '42501';
  end if;

  if p_plan not in ('months_6', 'year_1') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions where shop_id = p_shop for update;
  if not found then
    raise exception 'shop % has no subscription row', p_shop using errcode = 'P0002';
  end if;

  v_months := case p_plan when 'months_6' then 6 else 12 end;

  -- Paying while the trial is still running earns 2 bonus months, once.
  if v_sub.plan = 'trial'
     and v_sub.status = 'trialing'
     and now() < v_sub.expires_at
     and not v_sub.bonus_months_granted then
    v_bonus := 2;
  end if;

  -- Never lose unused time: extend from the later of now / current expiry.
  v_base := greatest(now(), v_sub.expires_at);

  update public.subscriptions
     set plan                 = p_plan,
         status               = 'active',
         expires_at           = v_base + make_interval(months => v_months + v_bonus),
         bonus_months_granted = v_sub.bonus_months_granted or (v_bonus > 0),
         updated_at           = now()
   where shop_id = p_shop;

  insert into public.payments (
    shop_id, plan, amount, method,
    months_added, bonus_months, status, reference, note, recorded_by
  ) values (
    p_shop, p_plan, p_amount, p_method,
    v_months, v_bonus, 'confirmed', p_reference, p_note, auth.uid()
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function public.admin_apply_payment(uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.admin_apply_payment(uuid, text, numeric, text, text, text)
  to authenticated, service_role;
