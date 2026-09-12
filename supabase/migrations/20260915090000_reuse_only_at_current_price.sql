-- ============================================================
-- Shop Web — 0034: an attempt is reusable only at today's price
--
-- 0033 changed the prices and rewrote wayl_start_intent to reuse a
-- live attempt instead of cancelling it. Both reuse branches checked
-- the window and the environment. Neither checked the amount.
--
-- So an attempt created before the price change — amount 90,000, no
-- checkout_url — was reused after it, a fresh Wayl link was attached
-- to it, and Wayl was handed the old 90,000. The seller saw 72,000 on
-- the button and Wayl asked for 90,000. Proven live.
--
-- The rule now: reuse only an attempt that is recent, in this
-- environment, AND priced at app.plan_price(p_plan) as it stands
-- right now. Anything else is cancelled and replaced. A price change
-- therefore invalidates every open attempt the moment it lands, which
-- is the only safe reading — an attempt is a quote, and a quote at a
-- price we no longer charge is not one to honour.
-- ============================================================

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

  -- The authoritative price, read once, here. Everything below compares
  -- against this and nothing compares against the caller.
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
    -- A hand-made transfer waiting on the owner still wins.
    if v_live.status = 'pending' then
      raise exception 'a manual payment is already waiting' using errcode = 'SW003';
    end if;

    -- One test, applied to every open attempt whether or not Wayl ever
    -- issued a link for it: recent, this environment, today's price.
    v_usable := v_live.created_at > now() - v_window
            and v_live.env is not distinct from p_env
            and v_live.amount = v_price;

    if v_usable and v_live.checkout_url is not null then
      -- A checkout they can still finish, at the price it was made for.
      return query select v_live.id, v_live.shop_id, v_live.plan, v_live.amount,
                          v_live.reference_id, v_live.checkout_url, v_live.env,
                          v_live.status, true;
      return;
    end if;

    if v_usable then
      -- A retry of an attempt Wayl never issued a link for. Same row, a
      -- fresh reference, and the secret rotated to the one this retry
      -- signs with. Nothing was spent, because nothing reached Wayl.
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

    -- Stale, or made in the other environment, or priced at a number we
    -- no longer charge. No money has moved, so there is nothing to undo.
    update public.payment_intents pi
       set status = 'cancelled', handled_at = now()
     where pi.id = v_live.id;
  end if;

  -- The rate limit, counting only attempts that actually reached Wayl.
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

  -- amount 0 is a placeholder: app.set_intent_price() overwrites it from
  -- app.plan_price() before the row lands.
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
  'Starts or resumes one checkout attempt per shop per plan. Reusable only while recent, in the same env, and priced at the current app.plan_price(); anything else is cancelled and replaced.';
