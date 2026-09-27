-- ============================================================
-- Shop Web — 0044: the first month is free, and then you pay
--
-- Free stops being a plan and becomes a beginning. Every shop gets
-- thirty days with the product working properly, and after that a shop
-- stays public only if somebody paid for it.
--
-- This is close to what the app did before migration 0031 made Free
-- permanent, and it deliberately reuses what 0031 left standing rather
-- than building a second calendar beside it:
--
--   * public.trial_grants   already one row per user, for good. It is
--                           what stops a second trial, and it survives
--                           deleting the shop, clearing the browser,
--                           changing the email and replacing the
--                           session, because it is keyed on
--                           auth.users.id.
--   * admin_apply_payment   already writes greatest(now(), expires_at)
--                           + the plan. That one line is exactly the
--                           rule "a plan bought during the free month
--                           starts when the free month ends", and it is
--                           not touched here.
--   * subscription_visible  already hides an expired shop's products
--                           through RLS, without writing to any product
--                           row. That is what makes paying restore a
--                           shop instantly.
--
-- What is genuinely new is one column and one rule.
--
-- The column is subscriptions.trial_ends_at: when the free month ends.
-- It is set once and a purchase never moves it, which is what lets a
-- screen say "your six months is ready and starts when the free month
-- ends" instead of showing one blurred date. expires_at keeps its old
-- meaning — when entitlement ends, whatever the entitlement is — so
-- there is still exactly one date that decides whether a shop is
-- public, and still only one place that moves it.
--
-- The rule is that a shop may hold one paid entitlement at a time. Six
-- months bought twice was six months added twice, which made a year
-- cost 76,000 instead of 72,000 by accident and was reachable by
-- posting the checkout form again.
--
-- NOTHING IS DELETED BY THIS MIGRATION. No product, no image, no R2
-- key, no shop, no account. Existing paid subscriptions keep their
-- exact expiry date. Suspended and non-active shops are not given a
-- trial and are not touched at all.
-- ============================================================

-- ------------------------------------------------------------
-- 1. when the free month ends
--
-- Nullable, and null means "no free month": a shop that was already
-- paying when this landed never had one, and reading null as "the
-- trial ended at the epoch" would be true but useless. Every function
-- below asks `now() < trial_ends_at`, which is false for null, so null
-- behaves as "not on a trial" everywhere without a special case.
-- ------------------------------------------------------------
alter table public.subscriptions
  add column if not exists trial_ends_at timestamptz;

comment on column public.subscriptions.trial_ends_at is
  'End of this shop''s one free month, or null if it never had one. Set once; a purchase never moves it. expires_at is still the single date that decides whether the shop is public.';

-- 'free' stays in both CHECKs. No new row will carry it, and the rows
-- that do are history — the months when Free was a permanent plan.
-- Rewriting them would be falsifying a record, and the functions below
-- read the dates, not the word.

-- ------------------------------------------------------------
-- 2. how long the free month is
--
-- Restored from migration 0029, which 0031 dropped. Named here rather
-- than written into each expression so the Worker can be checked
-- against it — scripts/plan-limits-test.mjs reads this definition and
-- fails if TRIAL_DAYS in worker/config.js disagrees.
-- ------------------------------------------------------------
create or replace function app.trial_days()
returns int language sql immutable as $$ select 30; $$;

comment on function app.trial_days() is
  'Days in the free month. Must match TRIAL_DAYS in worker/config.js.';

-- ------------------------------------------------------------
-- 3. the three questions everything else is built from
--
-- One definition each, in one place. A screen, an RLS predicate and a
-- trigger that disagree about whether a shop is on its free month is
-- the failure this shape exists to make impossible.
-- ------------------------------------------------------------

-- Is the free month running right now?
create or replace function app.on_trial(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.subscriptions sub
     where sub.shop_id = p_shop
       and sub.status <> 'suspended'
       and sub.trial_ends_at is not null
       and now() < sub.trial_ends_at
  );
$$;

revoke all on function app.on_trial(uuid) from public, anon;
grant execute on function app.on_trial(uuid) to authenticated, service_role;

-- Is there a paid plan, bought and not yet run out? True while it is
-- still waiting for the free month to end as well as while it is
-- running: that is the whole point of the word "entitlement".
create or replace function app.has_paid_entitlement(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.subscriptions sub
     where sub.shop_id = p_shop
       and sub.plan in ('month_1', 'months_6', 'year_1')
       and sub.status in ('trialing', 'active')
       and now() < sub.expires_at
  );
$$;

revoke all on function app.has_paid_entitlement(uuid) from public, anon;
grant execute on function app.has_paid_entitlement(uuid) to authenticated, service_role;

-- Bought, and not started yet, because the free month is still running.
create or replace function app.paid_scheduled(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.on_trial(p_shop) and app.has_paid_entitlement(p_shop);
$$;

revoke all on function app.paid_scheduled(uuid) from public, anon;
grant execute on function app.paid_scheduled(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 4. which side of the line a shop is on
--
--   paid     somebody paid and the plan is running
--   trial    the free month, whether or not a plan is already bought
--   expired  neither
--
-- 'trial' replaces 'free' as the name of the unpaid tier. The limits it
-- carries are the same two numbers Free carried, unchanged by this
-- migration: five products, one image each.
--
-- A shop whose free month is still running reads 'trial' even when it
-- has already bought six months, because that is what it is entitled to
-- today and the limits that apply today are the trial's. The moment the
-- free month ends the same shop reads 'paid' with nothing to write.
-- ------------------------------------------------------------
create or replace function app.plan_tier(p_shop uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when app.on_trial(p_shop)                                       then 'trial'
           when exists (
             select 1 from public.subscriptions sub
              where sub.shop_id = p_shop
                and sub.status = 'active'
                and sub.plan in ('month_1', 'months_6', 'year_1')
                and now() < sub.expires_at
           )                                                               then 'paid'
           -- A row still stored as the old permanent Free plan, in the
           -- window between this migration and the Worker deploy.
           when exists (
             select 1 from public.subscriptions sub
              where sub.shop_id = p_shop and sub.status = 'free'
           )                                                               then 'trial'
           else 'expired'
         end;
$$;

revoke all on function app.plan_tier(uuid) from public, anon;
grant execute on function app.plan_tier(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 5. an expired shop is not a public shop
--
-- The 'free' branch 0031 added is gone: there is no plan that is
-- public forever. Everything else is as it was, including the grace
-- days a paid plan gets.
--
-- This is the only thing that hides a lapsed shop's products, and it
-- writes nothing. products.status is never touched, so the seller's
-- forty products are still forty active products with their images and
-- their order — invisible to the public until the date moves, and
-- visible again the moment it does.
-- ------------------------------------------------------------
create or replace function app.subscription_visible(
  p_status text, p_expires_at timestamptz, p_grace_days int
) returns boolean
language sql
stable
parallel safe
as $$
  select case
           when p_status in ('suspended', 'none') then false
           -- Legacy permanent-Free rows, until the one-time transition
           -- in section 10 has run. Kept so this migration is safe to
           -- apply before the Worker that goes with it.
           when p_status = 'free' then true
           else now() < p_expires_at + make_interval(days => p_grace_days)
         end;
$$;

-- ------------------------------------------------------------
-- 6. may this shop post right now?
--
-- During the free month: yes, up to the trial's product limit.
-- On a paid plan: yes.
-- Expired: no. The shop and every product stay exactly where they are
-- and stay editable; what stops is adding more while nobody is paying.
-- ------------------------------------------------------------
create or replace function app.can_publish(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when app.shop_suspended(p_shop)   then false
           when app.plan_tier(p_shop) = 'paid'   then true
           when app.plan_tier(p_shop) = 'trial'  then
             (select count(*) from public.products p where p.shop_id = p_shop)
               < app.free_product_limit()
           else false
         end;
$$;

revoke all on function app.can_publish(uuid) from public, anon;
grant execute on function app.can_publish(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 7. a new shop gets its free month, once per account
--
-- The insert into trial_grants is the whole guard, and it is deliberate
-- that the new shop then reads its dates back OUT of that table. A
-- seller who deletes their shop and makes another does not get another
-- thirty days: they get the window they were already given, which by
-- then may well be over, and the new shop is expired the moment it is
-- created. That is the honest answer and it needs no flag anywhere.
--
-- Nothing here can fail a signup. If the ledger insert somehow finds no
-- row to read back, the shop is created with no trial rather than with
-- an unbounded one.
-- ------------------------------------------------------------
create or replace function app.start_trial_for_new_shop()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ends timestamptz;
begin
  insert into public.trial_grants (user_id, shop_id, expires_at)
       values (new.owner_id, new.id, now() + make_interval(days => app.trial_days()))
  on conflict (user_id) do nothing;

  -- Either the row just written, or the one this account already had.
  select g.expires_at into v_ends
    from public.trial_grants g where g.user_id = new.owner_id;

  insert into public.subscriptions (
    shop_id, plan, status, started_at, expires_at, trial_ends_at, trial_used
  ) values (
    new.id,
    case when v_ends is null then 'none' else 'trial' end,
    case when v_ends is null then 'none'
         when now() < v_ends  then 'trialing'
         else 'expired' end,
    now(),
    coalesce(v_ends, now()),
    v_ends,
    v_ends is not null
  )
  on conflict (shop_id) do nothing;

  return new;
end;
$$;

comment on function app.start_trial_for_new_shop() is
  'Gives a new shop the account''s one free month, reading the window from public.trial_grants so a second shop cannot earn a second trial.';

-- ------------------------------------------------------------
-- 8. a lapsed plan expires, and takes nothing with it
--
-- Two changes from 0031's version, and they are the same change said
-- twice: a plan that runs out becomes 'expired', not 'free', and
-- nothing is demoted.
--
-- app.demote_to_free_limit still exists and is still correct for what
-- it does; it is simply no longer called from here. Under the permanent
-- Free plan a lapsed shop stayed public, so its products had to be
-- brought down to five. Now a lapsed shop is not public at all, so
-- flipping thirty-five products to 'hidden' would achieve nothing
-- except to make the seller restore them by hand, one at a time, after
-- paying. RLS already hides all of them, and paying already brings all
-- of them back.
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
  if not (app.is_admin() or app.is_service_role() or auth.uid() is null) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with updated as (
    update public.subscriptions
       set status     = 'expired',
           updated_at = now()
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

comment on function public.expire_lapsed_subscriptions() is
  'Nightly: marks lapsed subscriptions expired. Writes no product row — RLS hides a lapsed shop, and paying brings it back with one date.';

-- ------------------------------------------------------------
-- 9. one paid entitlement at a time
--
-- The seller's checkout refuses to start when a paid plan is already
-- held, whether it is running or waiting for the free month to end.
-- After it runs out, buying again is allowed and is the normal case.
--
-- This is a guard on wayl_start_intent and on wayl_apply_payment, NOT
-- on admin_apply_payment. The owner granting a plan by hand from /admin
-- is a different act with a different audit trail, it is how a refund
-- or a goodwill month is given, and taking that away would be a
-- regression dressed up as a fix.
--
--   SW008  a plan is already running or already scheduled
--
-- Everything else in this function is byte-for-byte migration 0034:
-- the ownership check, the two plans that may be bought, the
-- environment check, the reference and secret shapes, the authoritative
-- price, the reuse window, both rate limits. Only the guard is added.
-- ------------------------------------------------------------
create or replace function public.wayl_start_intent(
  p_shop uuid, p_plan text, p_reference_id text, p_env text, p_secret text
)
returns table (
  id uuid, shop_id uuid, plan text, amount numeric, reference_id text,
  checkout_url text, env text, status text, reused boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_live    public.payment_intents;
  v_intent  public.payment_intents;
  v_price   numeric;
  v_linked  int;
  v_rows    int;
  v_window  interval := interval '25 minutes';
  v_usable  boolean;
begin
  if not (app.owns_shop(p_shop) or app.is_service_role()) then
    raise exception 'not your shop' using errcode = '42501';
  end if;
  if p_plan not in ('months_6', 'year_1') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;
  if p_env not in ('test', 'live') then
    raise exception 'unknown env %', p_env using errcode = '22023';
  end if;
  if p_reference_id is null or p_reference_id !~ '^[A-Za-z0-9-]{6,64}$' then
    raise exception 'bad reference' using errcode = '22023';
  end if;
  if p_secret is null or length(p_secret) not between 32 and 128 then
    raise exception 'bad secret' using errcode = '22023';
  end if;

  -- One paid entitlement at a time. Before the price is read and before
  -- any row is written, so a stacking attempt costs nothing and reaches
  -- nothing — a disabled button is not what stops this.
  if app.has_paid_entitlement(p_shop) then
    raise exception 'shop % already holds a paid plan', p_shop using errcode = 'SW008';
  end if;

  v_price := app.plan_price(p_plan);
  if v_price is null then
    raise exception 'no price for plan %', p_plan using errcode = '22023';
  end if;

  select * into v_live
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.plan = p_plan
     and pi.source = 'payment'
     and pi.status in ('open', 'pending')
   for update;

  if found then
    if v_live.status = 'pending' then
      raise exception 'a manual payment is already waiting' using errcode = 'SW003';
    end if;

    v_usable := v_live.created_at > now() - v_window
            and v_live.env is not distinct from p_env
            and v_live.amount = v_price;

    if v_usable and v_live.checkout_url is not null then
      return query select v_live.id, v_live.shop_id, v_live.plan, v_live.amount,
                          v_live.reference_id, v_live.checkout_url, v_live.env,
                          v_live.status, true;
      return;
    end if;

    if v_usable then
      update public.payment_intents pi
         set reference_id = p_reference_id,
             env          = p_env,
             updated_at   = now()
       where pi.id = v_live.id
      returning * into v_intent;

      insert into public.payment_intent_secrets (intent_id, webhook_secret)
           values (v_intent.id, p_secret)
      on conflict (intent_id) do update set webhook_secret = excluded.webhook_secret;

      return query select v_intent.id, v_intent.shop_id, v_intent.plan, v_intent.amount,
                          v_intent.reference_id, v_intent.checkout_url, v_intent.env,
                          v_intent.status, true;
      return;
    end if;

    update public.payment_intents pi
       set status = 'cancelled', handled_at = now()
     where pi.id = v_live.id;
  end if;

  select count(*) into v_linked
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.source = 'payment'
     and pi.checkout_url is not null
     and pi.created_at > now() - interval '10 minutes';
  if v_linked >= 6 then
    raise exception 'too many checkouts for shop %', p_shop using errcode = 'SW002';
  end if;

  select count(*) into v_rows
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.source = 'payment'
     and pi.created_at > now() - interval '1 hour';
  if v_rows >= 20 then
    raise exception 'too many checkouts for shop %', p_shop using errcode = 'SW002';
  end if;

  insert into public.payment_intents (shop_id, plan, amount, user_id, reference_id, env, currency)
       values (p_shop, p_plan, 0, auth.uid(), p_reference_id, p_env, 'IQD')
    returning * into v_intent;

  insert into public.payment_intent_secrets (intent_id, webhook_secret)
       values (v_intent.id, p_secret)
  on conflict (intent_id) do update set webhook_secret = excluded.webhook_secret;

  return query select v_intent.id, v_intent.shop_id, v_intent.plan, v_intent.amount,
                      v_intent.reference_id, v_intent.checkout_url, v_intent.env,
                      v_intent.status, false;
end;
$$;

revoke all on function public.wayl_start_intent(uuid, text, text, text, text) from public, anon;
grant execute on function public.wayl_start_intent(uuid, text, text, text, text)
  to authenticated, service_role;

comment on function public.wayl_start_intent(uuid, text, text, text, text) is
  'Starts or resumes one checkout attempt per shop per plan, and refuses one at all while the shop already holds a paid plan (SW008). Reusable only while recent, in the same env, and priced at the current app.plan_price().';

-- ------------------------------------------------------------
-- 9b. and the same guard where the money lands
--
-- The order of the two checks in here is the important part.
--
-- activated_at is tested FIRST, so a duplicate webhook for an intent
-- that has already been applied still returns already_active and still
-- adds nothing. That is the existing idempotency and it is untouched.
--
-- The stacking guard is tested after it, so it can only ever refuse a
-- SECOND, DIFFERENT intent. It deliberately does not mark that intent
-- paid: money that arrived for a plan this shop may not stack is not
-- something to swallow quietly, and leaving the intent open is what
-- puts it in front of the owner in /admin, where it can be refunded or
-- granted by hand. wayl_start_intent is what stops it being created.
-- ------------------------------------------------------------
create or replace function public.wayl_apply_payment(
  p_intent uuid, p_reference_id text, p_amount numeric,
  p_method text default null, p_note text default null
)
returns table (activated boolean, already_active boolean, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent  public.payment_intents;
  v_price   numeric;
  v_method  text;
  v_expires timestamptz;
begin
  if not (app.is_service_role() or app.is_admin()) then
    raise exception 'service only' using errcode = '42501';
  end if;

  select * into v_intent from public.payment_intents pi where pi.id = p_intent for update;
  if not found then
    raise exception 'intent % not found', p_intent using errcode = 'P0002';
  end if;

  if v_intent.source <> 'payment' then
    raise exception 'intent % is not a payment', p_intent using errcode = '22023';
  end if;
  if v_intent.reference_id is null or v_intent.reference_id is distinct from p_reference_id then
    raise exception 'reference does not match intent %', p_intent using errcode = '22023';
  end if;
  if v_intent.currency <> 'IQD' then
    raise exception 'intent % is not IQD', p_intent using errcode = '22023';
  end if;

  v_price := app.plan_price(v_intent.plan);
  if v_price is null or p_amount is null
     or p_amount <> v_price or v_intent.amount <> v_price then
    raise exception 'amount % is not the price of %', p_amount, v_intent.plan
      using errcode = '22023';
  end if;

  -- Already done. A webhook retry and a browser poll landing together
  -- is the normal case, and both must be able to read the answer
  -- without a second plan being granted.
  if v_intent.activated_at is not null then
    select s.expires_at into v_expires
      from public.subscriptions s where s.shop_id = v_intent.shop_id;
    return query select false, true, v_expires;
    return;
  end if;

  if v_intent.status not in ('open', 'pending') then
    raise exception 'intent % is already %', p_intent, v_intent.status using errcode = '22023';
  end if;

  -- A different intent, for a shop that already holds a paid plan.
  if app.has_paid_entitlement(v_intent.shop_id) then
    raise exception 'shop % already holds a paid plan', v_intent.shop_id
      using errcode = 'SW008';
  end if;

  v_method := case when p_method ~ '^[A-Za-z0-9 _.-]{1,32}$' then p_method else null end;

  perform public.admin_apply_payment(
    v_intent.shop_id, v_intent.plan, v_intent.amount, 'wayl',
    v_intent.reference_id, coalesce(p_note, 'wayl'));

  update public.payment_intents pi
     set status         = 'paid',
         paid_at        = coalesce(pi.paid_at, now()),
         activated_at   = now(),
         payment_method = coalesce(v_method, pi.payment_method),
         handled_at     = now()
   where pi.id = p_intent;

  select s.expires_at into v_expires
    from public.subscriptions s where s.shop_id = v_intent.shop_id;

  return query select true, false, v_expires;
end;
$$;

revoke all on function public.wayl_apply_payment(uuid, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.wayl_apply_payment(uuid, text, numeric, text, text)
  to service_role;

comment on function public.wayl_apply_payment(uuid, text, numeric, text, text) is
  'Server-verified Wayl payment -> admin_apply_payment. Idempotent: activated_at is the guard, tested before the anti-stacking check so a duplicate webhook never raises and never adds a second plan.';

-- ------------------------------------------------------------
-- 10. the shops that already exist
--
-- Read this as three sentences, because it is three sentences.
--
-- A shop on the old permanent Free plan gets thirty days from today.
-- It loses nothing today, and payment is needed thirty days from now.
-- The trial_grants row is written too, so this transition month is the
-- one free month that account gets and not a fresh one on top of a
-- trial it may have taken back in September.
--
-- A shop with a live paid subscription is not touched. Its plan, its
-- status and its expires_at are exactly what they were a moment ago,
-- and trial_ends_at stays null: it never had a free month under this
-- model and pretending otherwise would move its paid expiry.
--
-- A suspended shop, a banned shop, or a shop whose own status is not
-- 'active' is not touched and is not given a trial. Suspension is the
-- owner's stop button; handing it a free month would be overruling
-- them from inside a migration.
-- ------------------------------------------------------------
do $$
declare
  v_ends timestamptz := now() + make_interval(days => app.trial_days());
  v_moved int;
begin
  -- The ledger first, and it is MOVED rather than left alone where a row
  -- already exists.
  --
  -- An account that took the old 30-day trial back before 0031 made
  -- Free permanent has a grant that expired months ago. Leaving it
  -- would expire that seller today, for something they did in the
  -- summer, which is the one thing this migration promises not to do.
  -- So every transitioning shop's grant is set to this transition
  -- month: the ledger and the subscription then say the same thing, and
  -- a seller who deletes their shop and makes another during the
  -- transition month inherits the days they can actually see.
  --
  -- It is still one free month per account. This moves a window; it
  -- does not add a second one, and after today the grant is once more
  -- the thing that refuses a second trial for good.
  insert into public.trial_grants (user_id, shop_id, expires_at)
  select s.owner_id, s.id, v_ends
    from public.subscriptions sub
    join public.shops s on s.id = sub.shop_id
   where sub.status = 'free'
     and s.status = 'active'
  on conflict (user_id) do update
    set shop_id    = excluded.shop_id,
        started_at = now(),
        expires_at = excluded.expires_at;

  with moved as (
    update public.subscriptions sub
       set plan          = 'trial',
           status        = 'trialing',
           started_at    = now(),
           expires_at    = v_ends,
           trial_ends_at = v_ends,
           trial_used    = true,
           updated_at    = now()
      from public.shops s
     where s.id = sub.shop_id
       and sub.status = 'free'
       and s.status = 'active'
    returning 1
  )
  select count(*) into v_moved from moved;

  raise notice 'first-month-free: % existing Free shop(s) given 30 days to %', v_moved, v_ends;
end;
$$;

-- Any Free row left behind belongs to a shop that is suspended, banned
-- or otherwise not active. It keeps the status it has; plan_tier and
-- subscription_visible both still answer for it.

-- ------------------------------------------------------------
-- 11. what the seller's screens are told
--
-- The same function, with the free month added to it. Everything a
-- screen needs to draw any of the five states is one row from here, and
-- nothing about a trial, a scheduled plan or an expiry is computed in a
-- browser.
--
--   trial_ends_at     when the free month ends, or null
--   trial_days_left   whole days left in it, 0 once it is over
--   on_trial          the free month is running
--   paid_scheduled    a plan is bought and waiting for it to end
--   tier              paid | trial | expired
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
  tier              text,
  slots_left        int,
  trial_ends_at     timestamptz,
  trial_days_left   int,
  on_trial          boolean,
  paid_scheduled    boolean
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
    app.plan_tier(sub.shop_id),
    case
      when app.plan_tier(sub.shop_id) = 'paid' then null
      else greatest(0, app.free_product_limit()
                       - (select count(*)::int from public.products p
                           where p.shop_id = sub.shop_id))
    end,
    sub.trial_ends_at,
    case
      when sub.trial_ends_at is null then 0
      else greatest(0, ceil(extract(epoch from (sub.trial_ends_at - now())) / 86400))::int
    end,
    app.on_trial(sub.shop_id),
    app.paid_scheduled(sub.shop_id)
  from public.shops s
  join public.subscriptions sub on sub.shop_id = s.id
  where s.id = p_shop
    and (s.owner_id = auth.uid() or app.is_admin());
$$;

revoke all on function public.subscription_state(uuid) from public, anon;
grant execute on function public.subscription_state(uuid) to authenticated, service_role;

comment on function public.subscription_state(uuid) is
  'The one authoritative answer for the seller''s screens: trial active, trial end, plan scheduled, paid active, paid expiry, expired, may publish, publicly visible.';
