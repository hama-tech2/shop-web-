-- ============================================================
-- Shop Web — 0004: subscriptions, payments, visibility rules
--
-- Rules encoded here (all in the database, none in the frontend):
--   * a new shop gets a 1 month free trial
--   * paid plans are 6 months or 1 year
--   * paying while still on trial adds 2 bonus months (once)
--   * after expiry there are 3 grace days, then the shop's products
--     stop being visible to the public. Nothing is ever deleted.
--   * a seller can never change plan / expires_at / status
-- ============================================================

create table public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null unique references public.shops (id) on delete cascade,
  plan                  text not null default 'trial'
                          check (plan in ('trial', 'months_6', 'year_1')),
  status                text not null default 'trialing'
                          check (status in ('trialing', 'active', 'expired', 'suspended')),
  started_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  grace_days            int not null default 3 check (grace_days between 0 and 60),
  trial_used            boolean not null default true,
  bonus_months_granted  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.subscriptions is
  'Current subscription state per shop. Seller-readable, admin-writable only.';
comment on column public.subscriptions.bonus_months_granted is
  'True once the "paid during trial" +2 months bonus has been used. Granted at most once.';

create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------
-- payments — an append-only record of money received. Admin written.
-- ------------------------------------------------------------
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops (id) on delete restrict,
  plan          text not null check (plan in ('months_6', 'year_1')),
  amount        numeric(12, 2) not null check (amount >= 0),
  currency      text not null default 'IQD' check (currency in ('IQD', 'USD')),
  method        text not null default 'cash'
                  check (method in ('cash', 'fib', 'fastpay', 'zaincash', 'nasspay', 'transfer', 'other')),
  months_added  int not null default 0 check (months_added >= 0),
  bonus_months  int not null default 0 check (bonus_months >= 0),
  status        text not null default 'confirmed'
                  check (status in ('pending', 'confirmed', 'refunded', 'rejected')),
  reference     text,
  note          text,
  recorded_by   uuid references auth.users (id) on delete set null,
  paid_at       timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.payments is 'Payment history. Sellers read their own; only admins write.';

-- ------------------------------------------------------------
-- Effective state + public visibility.
-- ------------------------------------------------------------
create or replace function app.subscription_visible(
  p_status text, p_expires_at timestamptz, p_grace_days int
) returns boolean
language sql
stable
parallel safe
as $$
  select p_status <> 'suspended'
     and now() < p_expires_at + make_interval(days => p_grace_days);
$$;

create or replace function public.subscription_state(p_shop uuid)
returns table (
  plan            text,
  status          text,
  expires_at      timestamptz,
  grace_ends_at   timestamptz,
  days_left       int,
  in_grace        boolean,
  publicly_visible boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    sub.plan,
    sub.status,
    sub.expires_at,
    sub.expires_at + make_interval(days => sub.grace_days) as grace_ends_at,
    greatest(0, ceil(extract(epoch from (sub.expires_at - now())) / 86400))::int as days_left,
    (now() >= sub.expires_at
      and now() < sub.expires_at + make_interval(days => sub.grace_days)) as in_grace,
    (s.status = 'active'
      and app.subscription_visible(sub.status, sub.expires_at, sub.grace_days)) as publicly_visible
  from public.shops s
  join public.subscriptions sub on sub.shop_id = s.id
  where s.id = p_shop
    and (s.owner_id = auth.uid() or app.is_admin());
$$;

comment on function public.subscription_state(uuid) is
  'Read-only subscription summary for the shop owner or an admin.';

revoke all on function public.subscription_state(uuid) from public;
grant execute on function public.subscription_state(uuid) to authenticated, service_role;

-- Is this shop's content visible to the anonymous public right now?
create or replace function app.shop_is_public(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.shops s
    join public.subscriptions sub on sub.shop_id = s.id
    where s.id = p_shop
      and s.status = 'active'
      and app.subscription_visible(sub.status, sub.expires_at, sub.grace_days)
  );
$$;

revoke all on function app.shop_is_public(uuid) from public;
grant execute on function app.shop_is_public(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- New shop => 1 month free trial, created by the system.
-- ------------------------------------------------------------
create or replace function app.start_trial_for_new_shop()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.subscriptions (shop_id, plan, status, started_at, expires_at)
  values (new.id, 'trial', 'trialing', now(), now() + interval '1 month')
  on conflict (shop_id) do nothing;
  return new;
end;
$$;

create trigger shops_start_trial
  after insert on public.shops
  for each row execute function app.start_trial_for_new_shop();

-- ------------------------------------------------------------
-- Admin-only: record a payment and extend the subscription.
-- This is the single place the plan maths lives.
-- ------------------------------------------------------------
create or replace function public.admin_apply_payment(
  p_shop      uuid,
  p_plan      text,
  p_amount    numeric,
  p_currency  text default 'IQD',
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
    shop_id, plan, amount, currency, method,
    months_added, bonus_months, status, reference, note, recorded_by
  ) values (
    p_shop, p_plan, p_amount, p_currency, p_method,
    v_months, v_bonus, 'confirmed', p_reference, p_note, auth.uid()
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function public.admin_apply_payment(uuid, text, numeric, text, text, text, text) from public;
grant execute on function public.admin_apply_payment(uuid, text, numeric, text, text, text, text)
  to authenticated, service_role;

-- ------------------------------------------------------------
-- Housekeeping: flip lapsed subscriptions to 'expired'.
-- Visibility does not depend on this running — app.shop_is_public()
-- is time-based — it only keeps the stored status tidy for admins.
-- ------------------------------------------------------------
create or replace function public.expire_lapsed_subscriptions()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if not app.is_admin() then
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

  return v_count;
end;
$$;

revoke all on function public.expire_lapsed_subscriptions() from public;
grant execute on function public.expire_lapsed_subscriptions() to authenticated, service_role;
