-- ============================================================
-- What a plan costs depends on which Wayl it is being bought from
--
-- A test checkout says "This checkout is pretending" and moves no
-- money, but it still has to move a number, and rehearsing the flow
-- should not involve 38,000 or 72,000 of anything. So in the test
-- environment both plans cost 1,000 IQD, and in the live one they cost
-- exactly what they have always cost.
--
-- This replaces app.price_overrides, which did the same job for one
-- named shop. A shop is the wrong thing to hang it on: the question was
-- never "who is buying" but "is this real money". The table and
-- app.plan_price_for(text, uuid) are dropped here, which also removes
-- the live-test row that was in it.
--
-- Three properties this rests on, none of them new:
--
--   * p_env reaches the database only from wayl_start_intent, which is
--     given it by the Worker from WAYL_ENV. A browser cannot send it,
--     and wayl_start_intent rejects anything but 'test' or 'live'.
--   * the amount is still written by the database, on insert, by
--     app.set_intent_price. The browser still sends only a plan name.
--   * wayl_apply_payment still re-derives the expected amount from
--     here, against the intent's own env, before a day is granted.
--
-- Anything that is not exactly 'test' — including null — is priced
-- live. A missing or mangled environment charges the real price rather
-- than the token one; the failure has to land on the safe side.
-- ============================================================

-- ------------------------------------------------------------
-- 1. the price, given the environment
--
-- app.plan_price keeps the live price list and is still the one place
-- the real numbers are written. PLANS in worker/config.js carries them
-- for display, and scripts/plan-limits-test.mjs fails if they drift.
-- ------------------------------------------------------------
create or replace function app.plan_price_for(p_plan text, p_env text)
returns numeric
language sql
immutable
as $$
  select case
    when p_env = 'test' then
      case p_plan
        when 'months_6' then 1000::numeric
        when 'year_1'   then 1000::numeric
      end
    else app.plan_price(p_plan)
  end;
$$;

revoke all on function app.plan_price_for(text, text) from public, anon;
grant execute on function app.plan_price_for(text, text) to authenticated, service_role;

comment on function app.plan_price_for(text, text) is
  'IQD price for a plan in one Wayl environment: 1,000 in test, app.plan_price in live. Authoritative. Anything but ''test'' is priced live.';

-- ------------------------------------------------------------
-- 2. the three places a price is decided, each given the environment
--    it already had in scope
-- ------------------------------------------------------------

-- 2a. what an intent costs, written by the database on insert.
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

  new.amount := app.plan_price_for(new.plan, new.env);
  if new.amount is null then
    raise exception 'unknown plan %', new.plan using errcode = '22023';
  end if;
  if new.reference is null then
    new.reference := app.next_intent_reference();
  end if;
  return new;
end;
$$;

-- 2b. the reuse test. An attempt made against the other Wayl was
--     already unusable because the env had to match; now its price
--     would not match either, which is the same answer twice.
create or replace function public.wayl_start_intent(
  p_shop uuid, p_plan text, p_reference_id text, p_env text, p_secret text
)
returns table (
  id uuid, shop_id uuid, plan text, amount numeric,
  reference_id text, checkout_url text, env text, status text, reused boolean
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

  -- The authoritative price in this environment, read once, here.
  v_price := app.plan_price_for(p_plan, p_env);
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

    -- Stale, the other environment, or a price we no longer charge there.
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

  -- The amount is 0 here and always has been: app.set_intent_price
  -- overwrites it from the price list before the row lands, using the
  -- env on this very insert.
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

revoke all on function public.wayl_start_intent(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.wayl_start_intent(uuid, text, text, text, text)
  to authenticated, service_role;

comment on function public.wayl_start_intent(uuid, text, text, text, text) is
  'Starts or resumes one checkout attempt per shop per plan. Reusable only while recent, in the same env, and at that env''s price; anything else is cancelled and replaced.';

-- 2c. the money check, re-derived independently before a day is added.
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

  -- Three numbers that must agree, none of them from the caller: what
  -- this plan costs in the environment this intent was made in, what
  -- the intent says, and what Wayl was asked for.
  v_price := app.plan_price_for(v_intent.plan, v_intent.env);
  if v_price is null or p_amount is null
     or p_amount <> v_price or v_intent.amount <> v_price then
    raise exception 'amount % is not the price of %', p_amount, v_intent.plan
      using errcode = '22023';
  end if;

  if v_intent.activated_at is not null then
    select s.expires_at into v_expires
      from public.subscriptions s where s.shop_id = v_intent.shop_id;
    return query select false, true, v_expires;
    return;
  end if;

  if v_intent.status not in ('open', 'pending') then
    raise exception 'intent % is already %', p_intent, v_intent.status using errcode = '22023';
  end if;

  v_method := case when p_method ~ '^[A-Za-z0-9 _.-]{1,32}$' then p_method else null end;

  -- The plan decides the months. The amount never has and never does,
  -- so a 1,000 IQD test payment grants the same six months as a real
  -- one — which is the whole point of rehearsing with it.
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
-- 3. the per-shop override goes away
--
-- Nothing reads it now, and a second place a price can come from is a
-- second place to have to check. Dropping the table drops the live-test
-- row with it, so every shop is back on the price list for its env.
-- ------------------------------------------------------------
drop function if exists app.plan_price_for(text, uuid);
drop table if exists app.price_overrides;
