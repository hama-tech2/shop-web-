-- ============================================================
-- Shop Web — 0029: the trial is chosen, not given
--
-- Until now a shop got a month's trial the moment it was created, by a
-- trigger. Signing up, naming the shop and adding a WhatsApp number
-- spent it, whether or not the seller ever posted anything.
--
-- From here a new shop has no plan at all. The trial is 30 days, it
-- starts only when the seller says so, and it can be started once per
-- account for as long as the account exists. What stops a second one is
-- a row keyed on the owner's user id, not a flag on the shop: a shop
-- can be deleted and made again, a browser can be cleared, a session
-- can be replaced. auth.users.id survives all of that.
--
-- Nothing here deletes anything. A trial that runs out stops new
-- products being posted; the shop, its profile and every product it
-- already has stay exactly where they are.
-- ============================================================

-- ------------------------------------------------------------
-- 1. two new words for the state a shop can be in
--
--   plan   'none'      no plan has ever been chosen
--   status 'none'      the same, said where the code reads status
--
-- 'month_1' joins the plans for one reason only: the owner grants it by
-- hand from /admin. It is not for sale, has no price, and
-- wayl_start_intent refuses it, so no checkout can ever ask for it.
-- ------------------------------------------------------------
alter table public.subscriptions
  drop constraint subscriptions_plan_check,
  add constraint subscriptions_plan_check
    check (plan in ('none', 'trial', 'month_1', 'months_6', 'year_1')),
  drop constraint subscriptions_status_check,
  add constraint subscriptions_status_check
    check (status in ('none', 'trialing', 'active', 'expired', 'suspended'));

alter table public.payments
  drop constraint payments_plan_check,
  add constraint payments_plan_check
    check (plan in ('month_1', 'months_6', 'year_1'));

alter table public.payment_intents
  drop constraint payment_intents_plan_check,
  add constraint payment_intents_plan_check
    check (plan in ('month_1', 'months_6', 'year_1'));

-- ------------------------------------------------------------
-- 2. a new shop starts with nothing
--
-- The row is still created, because everything from the public shop
-- page to the RLS predicate joins it and a missing row would read as a
-- broken shop rather than an unstarted one. It just says 'none'.
--
-- Existing shops are not touched. A seller already on a trial keeps the
-- trial they were given under the old rule.
-- ------------------------------------------------------------
create or replace function app.start_trial_for_new_shop()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.subscriptions (shop_id, plan, status, started_at, expires_at, trial_used)
  values (new.id, 'none', 'none', now(), now(), false)
  on conflict (shop_id) do nothing;
  return new;
end;
$$;

comment on function app.start_trial_for_new_shop() is
  'Creates the subscription row a new shop needs, with no plan. The trial is started by public.start_trial, on purpose, by the seller.';

-- ------------------------------------------------------------
-- 3. a shop with no plan is not published
--
-- Without this, `now() < expires_at + grace_days` would make a brand
-- new shop public for three days on the strength of a grace period it
-- never earned.
-- ------------------------------------------------------------
create or replace function app.subscription_visible(
  p_status text, p_expires_at timestamptz, p_grace_days int
) returns boolean
language sql
stable
parallel safe
as $$
  select p_status not in ('suspended', 'none')
     and now() < p_expires_at + make_interval(days => p_grace_days);
$$;

-- ------------------------------------------------------------
-- 4. the ledger that makes the trial once per account
--
-- One row per user, for good. The primary key is the whole mechanism:
-- a second start loses the insert and is refused, including two taps
-- arriving at the same moment.
--
-- RLS on with no policy, so a seller cannot read, edit or delete their
-- own row. public.start_trial is security definer and writes it.
-- ------------------------------------------------------------
create table if not exists public.trial_grants (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  shop_id    uuid references public.shops (id) on delete set null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.trial_grants enable row level security;
revoke all on table public.trial_grants from anon, authenticated;
grant all on table public.trial_grants to service_role;

comment on table public.trial_grants is
  'One row per user, ever: the free trial has been taken. Survives deleting the shop, the session and the browser.';

-- Shops already on a trial under the old rule have used theirs.
insert into public.trial_grants (user_id, shop_id, started_at, expires_at)
select s.owner_id, s.id, sub.started_at, sub.expires_at
  from public.subscriptions sub
  join public.shops s on s.id = sub.shop_id
 where sub.plan = 'trial'
on conflict (user_id) do nothing;

-- ------------------------------------------------------------
-- 5. how long a trial is
--
-- Named here rather than written into the update, so the Worker and the
-- database can be checked against each other.
-- ------------------------------------------------------------
create or replace function app.trial_days()
returns int
language sql
immutable
as $$ select 30; $$;

comment on function app.trial_days() is
  'Days in the free trial. Must match TRIAL_DAYS in worker/config.js — scripts/plan-limits-test.mjs asserts it.';

-- ------------------------------------------------------------
-- 6. starting it
--
-- The seller's own decision, taken once. Everything that could make it
-- twice is refused here rather than in a screen: another shop, another
-- browser, a replayed form post, two taps at once.
-- ------------------------------------------------------------
create or replace function public.start_trial(p_shop uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_sub   public.subscriptions;
begin
  select s.owner_id into v_owner from public.shops s where s.id = p_shop;
  if v_owner is null then
    raise exception 'shop % not found', p_shop using errcode = 'P0002';
  end if;
  if not (app.owns_shop(p_shop) or app.is_service_role()) then
    raise exception 'not your shop' using errcode = '42501';
  end if;

  select * into v_sub from public.subscriptions sub
   where sub.shop_id = p_shop for update;
  if not found then
    raise exception 'shop % has no subscription row', p_shop using errcode = 'P0002';
  end if;

  -- Already paid for, or already on the trial. Not an error worth
  -- shouting about, but it must not reset anybody's dates.
  if v_sub.status in ('trialing', 'active') and now() < v_sub.expires_at then
    raise exception 'shop % already has a plan', p_shop using errcode = 'SW006';
  end if;

  -- The guard. A row here means this account has had its trial, whatever
  -- shop it was on and however long ago.
  insert into public.trial_grants (user_id, shop_id, expires_at)
       values (v_owner, p_shop, now() + make_interval(days => app.trial_days()))
  on conflict (user_id) do nothing;

  if not found then
    raise exception 'the free trial has already been used' using errcode = 'SW004';
  end if;

  update public.subscriptions sub
     set plan       = 'trial',
         status     = 'trialing',
         started_at = now(),
         expires_at = now() + make_interval(days => app.trial_days()),
         trial_used = true,
         updated_at = now()
   where sub.shop_id = p_shop
  returning * into v_sub;

  return v_sub;
end;
$$;

revoke all on function public.start_trial(uuid) from public, anon;
grant execute on function public.start_trial(uuid) to authenticated, service_role;

comment on function public.start_trial(uuid) is
  'Starts the one free trial this account may ever have. Guarded by trial_grants, not by anything the browser can clear.';

-- ------------------------------------------------------------
-- 7. may this shop post a product right now?
--
-- A running trial or a paid plan, and not past its date. Grace is
-- deliberately not enough: during grace what is already posted stays
-- visible, which is not the same as being able to post more.
-- ------------------------------------------------------------
create or replace function app.can_publish(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.subscriptions sub
     where sub.shop_id = p_shop
       and sub.status in ('trialing', 'active')
       and now() < sub.expires_at
  );
$$;

revoke all on function app.can_publish(uuid) from public;
grant execute on function app.can_publish(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 8. the database refuses a product from a shop with no plan
--
-- The Worker checks first, so the seller gets a screen with a way out
-- instead of a failed save. This is what makes that a courtesy rather
-- than the only thing standing there.
--
-- SW005 is "no plan", SW001 is "trial full". Two sentences, two codes.
-- ------------------------------------------------------------
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
  if not app.can_publish(new.shop_id) then
    raise exception 'shop % has no active plan', new.shop_id using errcode = 'SW005';
  end if;

  select plan into v_plan from public.subscriptions where shop_id = new.shop_id;

  -- A paid plan: nothing to count.
  if v_plan is distinct from 'trial' then
    return new;
  end if;

  select count(*) into v_count from public.products where shop_id = new.shop_id;

  if v_count >= v_max then
    raise exception 'trial product limit of % reached', v_max using errcode = 'SW001';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- 9. what the seller's screens are told
--
-- Two columns added: whether posting is allowed at all, and whether
-- this account still has its free trial to take. Both are read
-- straight off the server; neither is anything the browser decides.
-- ------------------------------------------------------------
drop function if exists public.subscription_state(uuid);

create or replace function public.subscription_state(p_shop uuid)
returns table (
  plan              text,
  status            text,
  started_at        timestamptz,
  expires_at        timestamptz,
  grace_ends_at     timestamptz,
  days_left         int,
  total_days        int,
  in_grace          boolean,
  publicly_visible  boolean,
  can_publish       boolean,
  trial_available   boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    sub.plan,
    sub.status,
    sub.started_at,
    sub.expires_at,
    sub.expires_at + make_interval(days => sub.grace_days),
    greatest(0, ceil(extract(epoch from (sub.expires_at - now())) / 86400))::int,
    greatest(1, ceil(extract(epoch from (sub.expires_at - sub.started_at)) / 86400))::int,
    (now() >= sub.expires_at
      and now() < sub.expires_at + make_interval(days => sub.grace_days)),
    (s.status = 'active'
      and app.subscription_visible(sub.status, sub.expires_at, sub.grace_days)),
    app.can_publish(sub.shop_id),
    not exists (select 1 from public.trial_grants t where t.user_id = s.owner_id)
  from public.shops s
  join public.subscriptions sub on sub.shop_id = s.id
  where s.id = p_shop
    and (s.owner_id = auth.uid() or app.is_admin());
$$;

revoke all on function public.subscription_state(uuid) from public, anon;
grant execute on function public.subscription_state(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 10. one month, granted by hand
--
-- The owner can already give six months or a year from /admin. This
-- adds one month to the same audited path — same admin check, same
-- confirmation, same payments row marked 'manual_grant' so it is never
-- mistaken for money that arrived.
-- ------------------------------------------------------------
create or replace function public.admin_apply_payment(
  p_shop uuid, p_plan text, p_amount numeric,
  p_method text default 'cash', p_reference text default null, p_note text default null
)
returns payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub     public.subscriptions;
  v_months  int;
  v_base    timestamptz;
  v_payment public.payments;
begin
  if not (app.is_admin() or app.is_service_role()) then
    raise exception 'only an admin can record payments' using errcode = '42501';
  end if;

  if p_plan not in ('month_1', 'months_6', 'year_1') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions where shop_id = p_shop for update;
  if not found then
    raise exception 'shop % has no subscription row', p_shop using errcode = 'P0002';
  end if;

  v_months := case p_plan when 'month_1' then 1 when 'months_6' then 6 else 12 end;

  -- The one line the whole plan calendar rests on, unchanged. A seller
  -- who pays in the middle of their trial keeps the days they have not
  -- used; one who pays after lapsing starts from today.
  v_base := greatest(now(), v_sub.expires_at);

  update public.subscriptions
     set plan       = p_plan,
         status     = 'active',
         expires_at = v_base + make_interval(months => v_months),
         updated_at = now()
   where shop_id = p_shop;

  insert into public.payments (
    shop_id, plan, amount, method,
    months_added, bonus_months, status, reference, note, recorded_by
  ) values (
    p_shop, p_plan, p_amount, p_method,
    v_months, 0, 'confirmed', p_reference, p_note, auth.uid()
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke execute on function public.admin_apply_payment(uuid, text, numeric, text, text, text)
  from anon, public;

-- A granted month is not a price, so the price lookup must not run for
-- one. It was raising 'unknown plan month_1' before the grant could set
-- the amount to zero.
create or replace function app.set_intent_price()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.source = 'manual_grant' then
    if not app.is_admin() then
      raise exception 'admin only' using errcode = '42501';
    end if;
    new.amount := 0;
    new.reference := null;
    return new;
  end if;

  new.amount := app.plan_price(new.plan);
  if new.amount is null then
    raise exception 'unknown plan %', new.plan using errcode = '22023';
  end if;
  if new.reference is null then
    new.reference := app.next_intent_reference();
  end if;
  return new;
end;
$$;

create or replace function public.admin_grant_plan(p_shop uuid, p_plan text, p_reason text, p_request uuid)
returns payments language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_intent  public.payment_intents;
  v_payment public.payments;
  v_reason  text := btrim(p_reason);
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_plan is null or p_plan not in ('month_1', 'months_6', 'year_1') or p_request is null
      or v_reason is null or length(v_reason) not between 1 and 500 then
    raise exception 'plan, reason and request id required' using errcode = '22023';
  end if;

  insert into public.payment_intents(id, shop_id, plan, amount, source, note)
    values (p_request, p_shop, p_plan, 0, 'manual_grant', v_reason)
    on conflict (id) do nothing;
  select * into v_intent from public.payment_intents where id = p_request for update;
  if not found or v_intent.source <> 'manual_grant' or v_intent.shop_id <> p_shop
      or v_intent.plan <> p_plan or v_intent.note is distinct from v_reason then
    raise exception 'request details changed' using errcode = '22023';
  end if;
  if v_intent.status = 'paid' then
    select * into v_payment from public.payments
      where method = 'manual_grant' and reference = p_request::text and recorded_by = auth.uid();
    if not found then
      raise exception 'request belongs to another admin' using errcode = '42501';
    end if;
    return v_payment;
  end if;
  return public.admin_activate_intent(p_request, v_reason);
end;
$$;

revoke all on function public.admin_grant_plan(uuid, text, text, uuid) from public, anon, service_role;
grant execute on function public.admin_grant_plan(uuid, text, text, uuid) to authenticated;
