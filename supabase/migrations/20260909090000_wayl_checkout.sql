-- ============================================================
-- Shop Web — 0028: Wayl hosted checkout
--
-- Wayl is the payment provider. The seller picks a plan, the server
-- creates a Wayl checkout link, and the seller pays inside Wayl's own
-- screens — FIB or SuperQi is chosen there, not here. Nothing in this
-- app renders a payment method, a QR code, a card form or a timer.
--
-- The rule the whole file exists to keep: a payment is real only when
-- the SERVER has asked Wayl and Wayl has said so. A webhook is a
-- knock at the door, never proof. A redirect back from Wayl carries no
-- proof at all.
--
-- Nothing here is a second subscription system. The date rule still
-- lives in exactly one place — admin_apply_payment, which moves
-- expires_at to max(now, current expiry) + the plan — and this file
-- calls it, the same way admin_activate_intent and the Telegram
-- webhook already do.
-- ============================================================

-- ------------------------------------------------------------
-- 1. what a Wayl payment adds to an intent
--
-- payment_intents is adapted rather than duplicated. A parallel table
-- would mean two places a shop can be "mid-payment", two things the
-- /admin screens have to read, and two ways for a plan to be granted.
--
-- Names asked for by the brief, and where they live:
--   plan_key    -> plan        (already 'months_6' | 'year_1')
--   amount_iqd  -> amount      (already IQD, set by app.plan_price)
--   webhook_secret -> public.payment_intent_secrets, see 2 below
-- ------------------------------------------------------------
alter table public.payment_intents
  add column if not exists user_id       uuid references auth.users (id) on delete set null,
  add column if not exists currency      text not null default 'IQD'
                                           check (currency = 'IQD'),
  add column if not exists reference_id  text
                                           check (reference_id is null
                                                  or reference_id ~ '^[A-Za-z0-9-]{6,64}$'),
  add column if not exists wayl_link_id  text,
  add column if not exists wayl_code     text,
  add column if not exists checkout_url  text
                                           check (checkout_url is null
                                                  or checkout_url ~ '^https://'),
  add column if not exists env           text
                                           check (env is null or env in ('test', 'live')),
  add column if not exists payment_method text
                                           check (payment_method is null
                                                  or payment_method ~ '^[A-Za-z0-9 _.-]{1,32}$'),
  add column if not exists paid_at       timestamptz,
  add column if not exists activated_at  timestamptz,
  add column if not exists updated_at    timestamptz not null default now();

-- The reference Wayl knows this payment by. Unique across every intent
-- ever made: the webhook and the status poll both find the intent
-- through it, so two intents behind one reference would mean one
-- payment could activate the wrong shop.
create unique index if not exists payment_intents_reference_id_key
  on public.payment_intents (reference_id);

comment on column public.payment_intents.reference_id is
  'The referenceId sent to Wayl. Unique. Never reused between intents.';
comment on column public.payment_intents.activated_at is
  'Set once, when the subscription was actually extended. The replay guard.';

drop trigger if exists payment_intents_touch_updated_at on public.payment_intents;
create trigger payment_intents_touch_updated_at
  before update on public.payment_intents
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------
-- 2. the per-payment webhook secret
--
-- Wayl signs each webhook with a secret we choose per payment, so the
-- secret has to be stored — and it must never be readable by the
-- seller whose payment it belongs to, or a seller could forge a
-- "paid" webhook for their own shop.
--
-- payment_intents is selectable by its owner, so the secret cannot
-- live there: a column-level revoke does not take back a table-level
-- grant. A separate table with RLS on and no policy at all is the
-- whole of the protection — only the service key and the SECURITY
-- DEFINER functions below ever see it.
-- ------------------------------------------------------------
create table if not exists public.payment_intent_secrets (
  intent_id      uuid primary key references public.payment_intents (id) on delete cascade,
  webhook_secret text not null check (length(webhook_secret) between 32 and 128),
  created_at     timestamptz not null default now()
);

alter table public.payment_intent_secrets enable row level security;
revoke all on table public.payment_intent_secrets from anon, authenticated;
grant all on table public.payment_intent_secrets to service_role;

comment on table public.payment_intent_secrets is
  'Per-payment Wayl webhook secret. RLS on with no policy: nobody but the service key reads this.';

-- ------------------------------------------------------------
-- 3. replay protection
--
-- Wayl may deliver the same event more than once — a retry, or an
-- attacker replaying a body they captured. The event id is unique, so
-- the second delivery loses the insert and is answered with a 200 and
-- nothing else.
--
-- This is a second line only. activated_at is the first: even an event
-- that gets past this cannot extend a plan twice.
-- ------------------------------------------------------------
create table if not exists public.wayl_webhook_events (
  id          uuid primary key default gen_random_uuid(),
  intent_id   uuid references public.payment_intents (id) on delete cascade,
  event_id    text not null unique,
  event_type  text,
  wayl_status text,
  received_at timestamptz not null default now()
);

alter table public.wayl_webhook_events enable row level security;
revoke all on table public.wayl_webhook_events from anon, authenticated;
grant all on table public.wayl_webhook_events to service_role;

create index if not exists wayl_webhook_events_intent_idx
  on public.wayl_webhook_events (intent_id, received_at desc);

-- ------------------------------------------------------------
-- 4. 'wayl' is a payment method
--
-- Which app the seller paid with inside Wayl — FIB, SuperQi, anything
-- Wayl adds later — is kept on the intent as payment_method, and only
-- when Wayl itself supplied it. payments.method says how the money
-- reached us, and that is Wayl.
-- ------------------------------------------------------------
alter table public.payments
  drop constraint payments_method_check,
  add constraint payments_method_check check (
    method in ('cash', 'fib', 'fastpay', 'zaincash', 'nasspay',
               'transfer', 'other', 'manual_grant', 'wayl')
  );

-- ------------------------------------------------------------
-- 5. starting a checkout
--
-- Called as the seller. app.owns_shop is the ownership check and the
-- amount is never accepted from the caller — the BEFORE INSERT trigger
-- sets it from app.plan_price, which is the only price this app bills.
--
-- Three things it will not do:
--   * touch a 'pending' intent. That is the retained manual flow, a
--     transfer the owner may already be looking at.
--   * make a second Wayl link when a usable one is minutes old.
--   * let one shop make checkouts in a loop.
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
  v_live   public.payment_intents;
  v_intent public.payment_intents;
  v_recent int;
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

  -- Rate limit, per shop. Tapping Pay twice is normal; ten checkouts in
  -- ten minutes is not, and each one is a link Wayl has to keep.
  select count(*) into v_recent
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.source = 'payment'
     and pi.created_at > now() - interval '10 minutes';
  if v_recent >= 6 then
    raise exception 'too many checkouts for shop %', p_shop using errcode = 'SW002';
  end if;

  select * into v_live
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.plan = p_plan
     and pi.source = 'payment'
     and pi.status in ('open', 'pending')
   for update;

  if found then
    -- The seller says they transferred by hand and the owner has not
    -- answered yet. Sending them to Wayl now risks paying twice.
    if v_live.status = 'pending' then
      raise exception 'a manual payment is already waiting' using errcode = 'SW003';
    end if;

    -- A checkout they started minutes ago and can still finish.
    if v_live.checkout_url is not null
       and v_live.env is not distinct from p_env
       and v_live.created_at > now() - interval '25 minutes' then
      return query select v_live.id, v_live.shop_id, v_live.plan, v_live.amount,
                          v_live.reference_id, v_live.checkout_url, v_live.env,
                          v_live.status, true;
      return;
    end if;

    -- Anything else open is stale. Cancelling it frees the one-live-per
    -- plan index; no money has moved, so there is nothing to undo.
    update public.payment_intents pi
       set status = 'cancelled', handled_at = now()
     where pi.id = v_live.id;
  end if;

  insert into public.payment_intents (shop_id, plan, amount, user_id, reference_id, env, currency)
       values (p_shop, p_plan, 0, auth.uid(), p_reference_id, p_env, 'IQD')
    returning * into v_intent;

  insert into public.payment_intent_secrets (intent_id, webhook_secret)
       values (v_intent.id, p_secret);

  return query select v_intent.id, v_intent.shop_id, v_intent.plan, v_intent.amount,
                      v_intent.reference_id, v_intent.checkout_url, v_intent.env,
                      v_intent.status, false;
end;
$$;

revoke all on function public.wayl_start_intent(uuid, text, text, text, text) from public, anon;
grant execute on function public.wayl_start_intent(uuid, text, text, text, text)
  to authenticated, service_role;

-- ------------------------------------------------------------
-- 6. remembering the link Wayl made
--
-- Only ever the first time, and only on an intent still open: a link
-- that changed under a payment already in flight is not something to
-- accept quietly.
-- ------------------------------------------------------------
create or replace function public.wayl_attach_link(
  p_intent uuid, p_link_id text, p_code text, p_url text
)
returns public.payment_intents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.payment_intents;
begin
  select * into v_intent from public.payment_intents pi where pi.id = p_intent for update;
  if not found then
    raise exception 'intent % not found', p_intent using errcode = 'P0002';
  end if;
  if not (app.owns_shop(v_intent.shop_id) or app.is_service_role()) then
    raise exception 'not your shop' using errcode = '42501';
  end if;
  if v_intent.status <> 'open' then
    raise exception 'intent % is %', p_intent, v_intent.status using errcode = '22023';
  end if;
  if p_url is null or p_url !~ '^https://' then
    raise exception 'bad checkout url' using errcode = '22023';
  end if;

  update public.payment_intents pi
     set wayl_link_id = coalesce(p_link_id, pi.wayl_link_id),
         wayl_code    = coalesce(p_code, pi.wayl_code),
         checkout_url = p_url
   where pi.id = p_intent
  returning * into v_intent;

  return v_intent;
end;
$$;

revoke all on function public.wayl_attach_link(uuid, text, text, text) from public, anon;
grant execute on function public.wayl_attach_link(uuid, text, text, text)
  to authenticated, service_role;

-- ------------------------------------------------------------
-- 7. the one place a Wayl payment turns into a subscription
--
-- Reached only by the service key, and only after the Worker has asked
-- Wayl directly and been told the payment is complete. Everything this
-- function does beyond that is refusing:
--
--   * the reference must be the one on this intent
--   * the amount must be the plan's price, from app.plan_price, not
--     from the caller and not from the row
--   * the currency must be IQD
--   * activated_at must be null, or nothing happens at all
--
-- The subscription itself is moved by admin_apply_payment — the same
-- function /admin, the Telegram button and every free grant go
-- through, so max(now, expiry) + the plan is written once in this
-- database and read from here.
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

  -- Already done. Not an error: a webhook retry and a browser poll
  -- landing together is the normal case, and both must be able to read
  -- the answer without a second month being granted.
  if v_intent.activated_at is not null then
    select s.expires_at into v_expires
      from public.subscriptions s where s.shop_id = v_intent.shop_id;
    return query select false, true, v_expires;
    return;
  end if;

  if v_intent.status not in ('open', 'pending') then
    raise exception 'intent % is already %', p_intent, v_intent.status using errcode = '22023';
  end if;

  -- Only a value Wayl actually supplied, and only in a shape worth
  -- printing on a receipt screen.
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
  'Server-verified Wayl payment -> admin_apply_payment. Idempotent: activated_at is the guard.';

-- ------------------------------------------------------------
-- 8. was this webhook event already seen?
--
-- Returns true the first time an event id arrives and false every time
-- after, so the caller can stop without deciding anything itself.
-- ------------------------------------------------------------
create or replace function public.wayl_record_event(
  p_intent uuid, p_event_id text, p_event_type text default null, p_status text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_written int := 0;
begin
  if not app.is_service_role() then
    raise exception 'service only' using errcode = '42501';
  end if;
  if p_event_id is null or length(btrim(p_event_id)) = 0 then
    raise exception 'event id required' using errcode = '22023';
  end if;

  insert into public.wayl_webhook_events (intent_id, event_id, event_type, wayl_status)
       values (p_intent, btrim(p_event_id), p_event_type, p_status)
  on conflict (event_id) do nothing;

  get diagnostics v_written = row_count;
  return v_written > 0;
end;
$$;

revoke all on function public.wayl_record_event(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.wayl_record_event(uuid, text, text, text) to service_role;
