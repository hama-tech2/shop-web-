-- ============================================================
-- One shop, one plan, one temporary price — in the live environment
--
-- 20260917_test_env_pricing was the wrong answer. It priced by Wayl
-- environment, which meant the only way to rehearse cheaply was to put
-- production into test mode, where the checkout announces that it is
-- pretending and no real card, FIB or SuperQi payment happens. The
-- thing that needs proving is a real payment, so the environment must
-- stay live and the exception has to be about who is buying.
--
-- This drops that function and restores the per-shop override, which
-- does not care what environment it is in:
--
--   * exactly one named shop, on exactly one named plan, pays the
--     amount in the row
--   * every other shop pays app.plan_price, in live as always
--   * the other plan is untouched, for that shop too
--   * the row expires by itself, so a forgotten override cannot
--     outlive the test
--
-- Nothing is weakened. The browser still sends only a plan name. The
-- amount is still written by the database on insert and re-derived by
-- wayl_apply_payment before a day is granted. The months still come
-- from the plan, so 1,000 IQD buys the same six months 38,000 would.
-- Signature checking, the authoritative status read and the
-- activated_at guard are not touched by this file at all.
--
-- The table has RLS on and no policy and no grants, so neither a seller
-- nor the service key can read or write it — only the database owner,
-- deliberately, in SQL. Rolling back is one delete.
-- ============================================================

-- ------------------------------------------------------------
-- 1. the environment-wide test price goes away
--
-- Dropped before the callers are rewritten only so that a replay of
-- these migrations in order cannot leave both definitions reachable.
-- ------------------------------------------------------------
drop function if exists app.plan_price_for(text, text);

-- ------------------------------------------------------------
-- 2. the overrides
-- ------------------------------------------------------------
create table if not exists app.price_overrides (
  shop_id     uuid        not null references public.shops(id) on delete cascade,
  plan        text        not null check (plan in ('months_6', 'year_1')),
  amount      numeric     not null check (amount > 0),
  expires_at  timestamptz not null,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (shop_id, plan)
);

alter table app.price_overrides enable row level security;
revoke all on table app.price_overrides from public, anon, authenticated;

comment on table app.price_overrides is
  'Temporary per-shop, per-plan price, live environment included. For one supervised payment test. Expires by itself; delete the row to restore app.plan_price.';
comment on column app.price_overrides.expires_at is
  'After this moment the row is ignored, so a forgotten override cannot outlive the test.';

-- ------------------------------------------------------------
-- 3. what this shop pays for this plan
--
-- app.plan_price keeps the price list, unchanged, and is still what
-- every shop without a live override pays.
--
-- SECURITY DEFINER because the table is closed to everybody; the
-- function returns a single number and takes no text from the caller
-- beyond a plan name it looks up.
-- ------------------------------------------------------------
create or replace function app.plan_price_for(p_plan text, p_shop uuid)
returns numeric
language sql
stable
security definer
set search_path = app, public, pg_temp
as $$
  select coalesce(
    (select o.amount
       from app.price_overrides o
      where o.shop_id = p_shop
        and o.plan    = p_plan
        and now() < o.expires_at),
    app.plan_price(p_plan));
$$;

revoke all on function app.plan_price_for(text, uuid) from public, anon;
grant execute on function app.plan_price_for(text, uuid) to authenticated, service_role;

comment on function app.plan_price_for(text, uuid) is
  'IQD price for one shop and plan: a temporary override while one is in force, otherwise app.plan_price. Authoritative.';

-- ------------------------------------------------------------
-- 4. the three places a price is decided, each given the shop it
--    already had in scope
-- ------------------------------------------------------------

-- 4a. what an intent costs, written by the database on insert.
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

  new.amount := app.plan_price_for(new.plan, new.shop_id);
  if new.amount is null then
    raise exception 'unknown plan %', new.plan using errcode = '22023';
  end if;
  if new.reference is null then
    new.reference := app.next_intent_reference();
  end if;
  return new;
end;
$$;

-- 4b. the reuse test: an open attempt is only reusable at the price we
--     charge that shop today. This is also what retires an attempt made
--     before the override, or after it is deleted.
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

  -- The authoritative price for this shop, read once, here.
  v_price := app.plan_price_for(p_plan, p_shop);
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

    -- Stale, the other environment, or a price we no longer charge.
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

revoke all on function public.wayl_start_intent(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.wayl_start_intent(uuid, text, text, text, text)
  to authenticated, service_role;

comment on function public.wayl_start_intent(uuid, text, text, text, text) is
  'Starts or resumes one checkout attempt per shop per plan. Reusable only while recent, in the same env, and priced at what this shop pays today; anything else is cancelled and replaced.';

-- 4c. the money check, re-derived independently before a day is added.
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
  -- this shop pays, what the intent says, what Wayl was asked for.
  v_price := app.plan_price_for(v_intent.plan, v_intent.shop_id);
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
  -- so a 1,000 IQD payment grants the same six months 38,000 would.
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
