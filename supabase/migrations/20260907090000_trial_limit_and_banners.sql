-- ============================================================
-- Shop Web — 0025: the trial product limit, grace back to 3,
-- and where a renewal banner may be shown
-- ============================================================

-- ------------------------------------------------------------
-- 1. grace is 3 days again
--
-- 0024 moved it to 7. Back to 3, for the shops that migration
-- already changed as well as for new ones.
-- ------------------------------------------------------------
alter table public.subscriptions alter column grace_days set default 3;
update public.subscriptions set grace_days = 3 where grace_days = 7;

-- ------------------------------------------------------------
-- 2. five images, said once more
--
-- MAX_IMAGES went 10 -> 5 in 0022, in the trigger and in
-- save_product_images, but this CHECK was left at 10. Nothing could
-- reach position 6 through the app; the constraint just no longer said
-- what the rule was.
-- ------------------------------------------------------------
alter table public.product_images
  drop constraint if exists product_images_position_check,
  add constraint product_images_position_check
    check (position >= 1 and position <= 5);

-- ------------------------------------------------------------
-- 3. five products on the free trial
--
-- The database is the place this is decided, the same way the image
-- limit is: the Worker checks first so the seller gets a sentence they
-- can act on, and this refuses anything that gets past it.
--
-- Two things it deliberately does not do:
--
--   - It only fires on INSERT. A trial shop that already has more than
--     five products keeps every one of them, can still edit them, and
--     still shows them all publicly. The limit blocks new ones only.
--   - It counts nothing for a paid shop. months_6 and year_1 are
--     unlimited, so the count query does not even run for them.
-- ------------------------------------------------------------
create or replace function app.trial_product_limit()
returns int
language sql
immutable
as $$ select 5; $$;

comment on function app.trial_product_limit() is
  'Products a shop may publish while on the free trial. Must match TRIAL_PRODUCT_LIMIT in worker/config.js — scripts/plan-limits-test.mjs asserts it.';

create or replace function app.enforce_trial_product_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  text;
  v_count int;
  v_max   int := app.trial_product_limit();
begin
  select plan into v_plan from public.subscriptions where shop_id = new.shop_id;

  -- No subscription row, or a paid one: nothing to count.
  if v_plan is distinct from 'trial' then
    return new;
  end if;

  select count(*) into v_count from public.products where shop_id = new.shop_id;

  if v_count >= v_max then
    -- A custom SQLSTATE so the Worker can tell this one refusal apart
    -- from every other write failure and answer with the sentence that
    -- links to the plans, rather than a generic "could not save".
    raise exception 'trial product limit of % reached', v_max
      using errcode = 'SW001';
  end if;

  return new;
end;
$$;

drop trigger if exists products_trial_limit on public.products;
create trigger products_trial_limit
  before insert on public.products
  for each row execute function app.enforce_trial_product_limit();

-- How many a shop may still publish. Null means unlimited (a paid
-- plan); the seller's own screens read this rather than counting.
create or replace function public.trial_slots_left(p_shop uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when sub.plan <> 'trial' then null
           else greatest(0, app.trial_product_limit()
                            - (select count(*)::int from public.products p
                                where p.shop_id = p_shop))
         end
  from public.subscriptions sub
  join public.shops s on s.id = sub.shop_id
  where sub.shop_id = p_shop
    and (s.owner_id = auth.uid() or app.is_admin());
$$;

revoke all on function public.trial_slots_left(uuid) from public;
grant execute on function public.trial_slots_left(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 4. dismissing a renewal banner
--
-- Per shop, in the database, not in localStorage: a seller who opens
-- the app on their phone and then on a laptop should not be told the
-- same thing twice, and clearing site data must not be a way to lose
-- the warning either.
--
-- Dismissing is never permanent. Each kind carries its own cooldown
-- and the banner comes back when it has passed — the row records when
-- it was last dismissed, never that it is gone for good. Only the two
-- amber banners can be dismissed at all; grace and hidden have no row
-- here because they cannot be closed.
-- ------------------------------------------------------------
create table if not exists public.plan_banner_dismissals (
  shop_id      uuid not null references public.shops(id) on delete cascade,
  kind         text not null check (kind in ('soon', 'urgent')),
  dismissed_at timestamptz not null default now(),
  primary key (shop_id, kind)
);

alter table public.plan_banner_dismissals enable row level security;

drop policy if exists plan_banner_dismissals_select_own on public.plan_banner_dismissals;
create policy plan_banner_dismissals_select_own
  on public.plan_banner_dismissals for select
  using (app.owns_shop(shop_id) or app.is_admin());

drop policy if exists plan_banner_dismissals_write_own on public.plan_banner_dismissals;
create policy plan_banner_dismissals_write_own
  on public.plan_banner_dismissals for insert
  with check (app.owns_shop(shop_id));

drop policy if exists plan_banner_dismissals_update_own on public.plan_banner_dismissals;
create policy plan_banner_dismissals_update_own
  on public.plan_banner_dismissals for update
  using (app.owns_shop(shop_id))
  with check (app.owns_shop(shop_id));

grant select, insert, update on public.plan_banner_dismissals to authenticated;
