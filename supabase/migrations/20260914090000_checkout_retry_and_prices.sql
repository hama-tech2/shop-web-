-- ============================================================
-- Shop Web — 0033: one attempt per seller, and the new prices
--
-- Two things, both about what a seller meets when a payment does not
-- go through the first time.
--
-- THE RETRY BUG
--
-- wayl_start_intent counted the rate limit before it looked for an
-- attempt to reuse, and it only reused an attempt that already had a
-- checkout_url. So when Wayl failed to make a link — which is exactly
-- when a seller taps again — the reuse branch was skipped, the open
-- intent was cancelled as stale, and a fresh row was inserted. Six
-- ordinary taps and the seller was rate-limited out of paying at all.
--
-- The order is now the other way round: find the attempt first, reuse
-- it, and only count what actually reached Wayl. A retry costs nothing
-- because nothing about it was ever spent.
--
-- Reusing a link-less attempt takes a FRESH reference. No payment can
-- have been made against an attempt Wayl never issued a link for, and
-- a reference Wayl may already have seen is not one to send twice.
-- The row is what the seller has one of; the reference is what Wayl
-- has one of.
--
-- The webhook secret is rotated to the one the retry will sign with.
-- It is never returned to the caller: wayl_start_intent is callable by
-- any signed-in seller, and a seller who could read their own webhook
-- secret could forge a paid webhook for their own shop.
--
-- THE PRICES
--
-- 6 months  55,000 -> 38,000 IQD   (displayed as $29)
-- 1 year    90,000 -> 72,000 IQD   (displayed as $55)
--
-- This function is authoritative. The browser never sends an amount and
-- wayl_apply_payment re-derives the price from here before a single day
-- is added, so a stale page cannot buy a year at the old number.
-- ============================================================

-- ------------------------------------------------------------
-- 1. what a plan costs
--
-- PLANS in worker/config.js carries the same two numbers for display.
-- scripts/plan-limits-test.mjs fails if they drift apart.
-- ------------------------------------------------------------
create or replace function app.plan_price(p_plan text)
returns numeric
language sql
immutable
as $$
  select case p_plan
           when 'months_6' then 38000::numeric
           when 'year_1'   then 72000::numeric
         end;
$$;

comment on function app.plan_price(text) is
  'IQD price per plan, authoritative. PLANS in worker/config.js must be edited to match.';

-- ------------------------------------------------------------
-- 2. starting — or resuming — a checkout
--
-- Ordering matters and is the whole fix:
--
--   1. find this shop's live attempt for this plan
--   2. a hand-made transfer waiting on the owner wins (SW003)
--   3. a usable link -> hand back the same one, nothing spent
--   4. an attempt with no link -> reuse the row, fresh reference,
--      rotated secret, nothing spent
--   5. only a genuinely stale attempt is cancelled
--   6. only now, and only counting attempts that reached Wayl, the
--      rate limit
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
  v_linked  int;
  v_rows    int;
  v_window  interval := interval '25 minutes';
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

  -- 1. The attempt this seller already has for this plan, if any.
  select * into v_live
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.plan = p_plan
     and pi.source = 'payment'
     and pi.status in ('open', 'pending')
   for update;

  if found then
    -- 2. They say they transferred by hand and the owner has not
    -- answered yet. Sending them to Wayl now risks paying twice.
    if v_live.status = 'pending' then
      raise exception 'a manual payment is already waiting' using errcode = 'SW003';
    end if;

    -- 3. A checkout they started minutes ago and can still finish.
    -- The same link, so a second tap is not a second payment.
    if v_live.checkout_url is not null
       and v_live.env is not distinct from p_env
       and v_live.created_at > now() - v_window then
      return query select v_live.id, v_live.shop_id, v_live.plan, v_live.amount,
                          v_live.reference_id, v_live.checkout_url, v_live.env,
                          v_live.status, true;
      return;
    end if;

    -- 4. An attempt Wayl never issued a link for. This is the retry
    -- that used to cost a row and, six taps later, the ability to pay.
    -- Reuse the row. Take a fresh reference, because Wayl may already
    -- have seen the old one, and rotate the secret so the retry signs
    -- with what this database will verify. Nothing was spent, because
    -- nothing ever reached Wayl.
    if v_live.checkout_url is null then
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

    -- 5. A link that has aged out, or one made for the other
    -- environment. No money has moved, so there is nothing to undo.
    update public.payment_intents pi
       set status = 'cancelled', handled_at = now()
     where pi.id = v_live.id;
  end if;

  -- 6. The rate limit, counting only attempts that actually reached
  -- Wayl. A seller whose checkouts keep failing is not abusing
  -- anything and must not be locked out of paying; a seller making
  -- real links in a loop is, and each one is a link Wayl has to keep.
  select count(*) into v_linked
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.source = 'payment'
     and pi.checkout_url is not null
     and pi.created_at > now() - interval '10 minutes';
  if v_linked >= 6 then
    raise exception 'too many checkouts for shop %', p_shop using errcode = 'SW002';
  end if;

  -- The backstop, well above anything a person does by tapping. With
  -- reuse in place a normal seller adds one row per plan and retries on
  -- it, so reaching this means something automated is at work.
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
  'Starts or resumes one checkout attempt per shop per plan. Retries reuse the row and cost no rate limit; only attempts that reached Wayl are counted.';
