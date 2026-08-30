-- ============================================================
-- Shop Web — 0019: the admin screen, view counting, and the cron
--
--   * shop_notes: admin-only notes. A column on `shops` would leak —
--     anon can select every column of a publicly visible shop.
--   * view_dedupe + a token argument on record_view, so a visitor
--     cannot inflate a counter by reloading.
--   * admin_shops / admin_stats / admin_activate_intent, so the admin
--     screen is a few queries rather than dozens.
--   * expire_lapsed_subscriptions callable by the cron.
-- ============================================================

-- ---------- admin notes ----------
create table public.shop_notes (
  shop_id    uuid primary key references public.shops (id) on delete cascade,
  note       text check (note is null or char_length(note) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.shop_notes is
  'Admin-only notes. Separate from shops because anon can read every column of a public shop.';

alter table public.shop_notes enable row level security;
revoke all on table public.shop_notes from anon, authenticated;
grant all on table public.shop_notes to service_role;
grant select, insert, update on public.shop_notes to authenticated;

create policy shop_notes_admin_all on public.shop_notes
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

create trigger shop_notes_audit
  after insert or update or delete on public.shop_notes
  for each row execute function app.write_audit();

-- ============================================================
-- view counting
-- ============================================================

-- One row per visitor token per target per day. No grants and no
-- policies: only the SECURITY DEFINER function below touches it.
create table public.view_dedupe (
  token  text not null,
  target uuid not null,
  day    date not null default current_date,
  primary key (token, target, day)
);

alter table public.view_dedupe enable row level security;
grant all on table public.view_dedupe to service_role;

create index view_dedupe_day_idx on public.view_dedupe (day);

drop function if exists public.record_view(uuid, uuid);

/**
 * Count a view.
 *
 * p_token is an opaque per-visitor-per-day value the Worker derives
 * from the client IP; the same visitor reloading the same page all day
 * is counted once. Anything not publicly visible is ignored outright.
 */
create or replace function public.record_view(
  p_shop uuid default null,
  p_product uuid default null,
  p_token text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop   uuid := p_shop;
  v_target uuid;
begin
  if p_product is not null then
    if not app.product_is_public(p_product) then return; end if;
    select shop_id into v_shop from public.products where id = p_product;
    v_target := p_product;
  else
    if v_shop is null or not app.shop_is_public(v_shop) then return; end if;
    v_target := v_shop;
  end if;

  -- No token means we cannot tell repeat visits apart, so we do not count.
  if p_token is null or char_length(p_token) < 16 then return; end if;

  begin
    insert into public.view_dedupe (token, target) values (p_token, v_target);
  exception when unique_violation then
    return;                        -- already counted today
  end;

  insert into public.daily_views (shop_id, product_id, day, views)
  values (v_shop, p_product, current_date, 1)
  on conflict (shop_id, product_id, day)
    do update set views = public.daily_views.views + 1;
end;
$$;

revoke all on function public.record_view(uuid, uuid, text) from public;
grant execute on function public.record_view(uuid, uuid, text) to anon, authenticated, service_role;

-- ============================================================
-- admin reads
-- ============================================================

create or replace function public.admin_stats()
returns table (
  shops_total int, shops_active int, shops_trial int,
  shops_expired int, shops_suspended int,
  products_total int, intents_open int, reports_open int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.shops)::int,
    (select count(*) from public.shops s join public.subscriptions sub on sub.shop_id = s.id
      where s.status = 'active'
        and app.subscription_visible(sub.status, sub.expires_at, sub.grace_days))::int,
    (select count(*) from public.subscriptions where plan = 'trial' and now() < expires_at)::int,
    (select count(*) from public.shops s join public.subscriptions sub on sub.shop_id = s.id
      where not app.subscription_visible(sub.status, sub.expires_at, sub.grace_days))::int,
    (select count(*) from public.shops where status <> 'active')::int,
    (select count(*) from public.products)::int,
    (select count(*) from public.payment_intents where status = 'open')::int,
    (select count(*) from public.reports where status = 'open')::int
  where app.is_admin();
$$;

revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated, service_role;

/** The merchant list. Empty for anyone who is not an admin. */
create or replace function public.admin_shops(
  p_search text default null,
  p_status text default null,
  p_limit int default 100
)
returns table (
  id uuid, name text, slug text, city text, status text, created_at timestamptz,
  owner_email text, plan text, sub_status text, expires_at timestamptz,
  days_left int, visible boolean, product_count int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.id, s.name, s.slug, s.city, s.status, s.created_at,
    u.email::text,
    sub.plan, sub.status,
    sub.expires_at,
    ceil(extract(epoch from (sub.expires_at - now())) / 86400)::int,
    app.subscription_visible(sub.status, sub.expires_at, sub.grace_days),
    (select count(*) from public.products p where p.shop_id = s.id)::int
  from public.shops s
  join public.subscriptions sub on sub.shop_id = s.id
  left join auth.users u on u.id = s.owner_id
  where app.is_admin()
    and (p_search is null or btrim(p_search) = ''
         or s.name ilike '%' || p_search || '%'
         or s.slug ilike '%' || p_search || '%'
         or u.email ilike '%' || p_search || '%')
    and (
      p_status is null or p_status = 'all'
      or (p_status = 'active'    and s.status = 'active'
            and app.subscription_visible(sub.status, sub.expires_at, sub.grace_days))
      or (p_status = 'trial'     and sub.plan = 'trial' and now() < sub.expires_at)
      or (p_status = 'expired'   and not app.subscription_visible(sub.status, sub.expires_at, sub.grace_days))
      or (p_status = 'suspended' and s.status <> 'active')
    )
  order by s.created_at desc
  limit least(coalesce(p_limit, 100), 500);
$$;

revoke all on function public.admin_shops(text, text, int) from public, anon;
grant execute on function public.admin_shops(text, text, int) to authenticated, service_role;

/**
 * Activate a plan from a payment intent: extend the subscription, write
 * the payment row, and close the intent — all in one transaction, so an
 * intent can never be marked paid without the subscription moving.
 */
create or replace function public.admin_activate_intent(p_intent uuid, p_note text default null)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent  public.payment_intents;
  v_payment public.payments;
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select * into v_intent from public.payment_intents where id = p_intent for update;
  if not found then
    raise exception 'intent % not found', p_intent using errcode = 'P0002';
  end if;
  if v_intent.status <> 'open' then
    raise exception 'intent % is already %', p_intent, v_intent.status using errcode = '22023';
  end if;

  v_payment := public.admin_apply_payment(
    v_intent.shop_id, v_intent.plan, v_intent.amount, 'fib', p_intent::text, p_note);

  update public.payment_intents
     set status = 'paid', handled_at = now(), handled_by = auth.uid()
   where id = p_intent;

  return v_payment;
end;
$$;

revoke all on function public.admin_activate_intent(uuid, text) from public, anon;
grant execute on function public.admin_activate_intent(uuid, text) to authenticated, service_role;

-- ============================================================
-- cron
-- ============================================================

/**
 * The nightly sweep calls this with the service key, which carries no
 * JWT — hence the `auth.uid() is null` arm. anon has no EXECUTE grant,
 * so that arm is not reachable from a browser.
 */
create or replace function public.expire_lapsed_subscriptions()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if not (app.is_admin() or auth.uid() is null) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with updated as (
    update public.subscriptions
       set status = 'expired', updated_at = now()
     where status in ('trialing', 'active')
       and now() >= expires_at + make_interval(days => grace_days)
    returning 1
  )
  select count(*) into v_count from updated;

  delete from public.view_dedupe where day < current_date - 7;

  return v_count;
end;
$$;

revoke all on function public.expire_lapsed_subscriptions() from public, anon;
grant execute on function public.expire_lapsed_subscriptions() to authenticated, service_role;
