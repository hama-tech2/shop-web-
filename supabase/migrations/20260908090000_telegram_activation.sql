-- ============================================================
-- Shop Web — 0026: activating a payment from Telegram
--
-- The owner gets a message when a seller says they have paid, with two
-- buttons. Tapping one has to end in exactly the same place as tapping
-- the button on /admin — so the webhook calls admin_activate_intent,
-- the same function, and this migration is only about letting it.
-- ============================================================

-- ------------------------------------------------------------
-- 1. telling the service key apart from everybody else
--
-- The Telegram webhook has no user session — nobody is signed in when
-- Telegram POSTs to it — so it reaches PostgREST with the service key
-- and app.is_admin() is false, because that reads auth.uid().
--
-- The existing idiom for this is `app.is_admin() or auth.uid() is null`
-- (see expire_lapsed_subscriptions), which works but is looser than it
-- looks: auth.uid() is also null for `anon`, so it leans entirely on
-- the EXECUTE grant to keep the public out. This says the thing it
-- means instead. Measured, on this database:
--
--   service key       auth.uid() null: true   is_service_role: true
--   anon              auth.uid() null: true   is_service_role: false
--   signed-in seller  auth.uid() null: false  is_service_role: false
--
-- It grants nothing new. The service key already bypasses RLS and could
-- write subscriptions directly; the point is that it should go through
-- the audited function rather than around it.
-- ------------------------------------------------------------
create or replace function app.is_service_role()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    ''
  ) = 'service_role';
$$;

comment on function app.is_service_role() is
  'True only for the Supabase service key. Not for anon, not for a signed-in user.';

-- ------------------------------------------------------------
-- 2. a grant that should never have been there
--
-- admin_intent_not_found came out of 0024 executable by `anon`. Supabase
-- default privileges grant EXECUTE on new functions in `public` to anon,
-- and `revoke all from public` does not take back an explicit grant to a
-- role. The function's own app.is_admin() check refused anon at runtime,
-- so nothing was exposed — but with the service arm added below, the
-- grant is the only thing standing between the public and this function,
-- and it should not be standing there at all.
-- ------------------------------------------------------------
revoke execute on function public.admin_intent_not_found(uuid, text) from anon, public;
revoke execute on function public.admin_activate_intent(uuid, text) from anon, public;

-- ------------------------------------------------------------
-- 3. the same two functions, reachable by the webhook
--
-- Everything else about them is unchanged: still the single place a
-- payment is confirmed, still raising 22023 on an intent that has
-- already been handled, which is what stops one payment being actioned
-- twice from two directions.
-- ------------------------------------------------------------
create or replace function public.admin_activate_intent(p_intent uuid, p_note text default null)
returns payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent  public.payment_intents;
  v_payment public.payments;
begin
  if not (app.is_admin() or app.is_service_role()) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select * into v_intent from public.payment_intents where id = p_intent for update;
  if not found then
    raise exception 'intent % not found', p_intent using errcode = 'P0002';
  end if;
  if v_intent.status not in ('open', 'pending') then
    raise exception 'intent % is already %', p_intent, v_intent.status using errcode = '22023';
  end if;

  v_payment := public.admin_apply_payment(
    v_intent.shop_id, v_intent.plan, v_intent.amount, 'fib',
    coalesce(v_intent.reference, p_intent::text), p_note);

  update public.payment_intents
     set status = 'paid', handled_at = now(), handled_by = auth.uid()
   where id = p_intent;

  return v_payment;
end;
$$;

create or replace function public.admin_intent_not_found(p_intent uuid, p_note text default null)
returns payment_intents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.payment_intents;
begin
  if not (app.is_admin() or app.is_service_role()) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  update public.payment_intents
     set status = 'open',
         handled_at = now(),
         handled_by = auth.uid(),
         note = coalesce(p_note, note)
   where id = p_intent and status = 'pending'
  returning * into v_intent;

  if not found then
    raise exception 'intent % is not pending', p_intent using errcode = '22023';
  end if;

  return v_intent;
end;
$$;

-- admin_apply_payment is only ever reached through the two above, but it
-- carries the same check, so it needs the same arm or the call chain
-- breaks one step in.
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

  if p_plan not in ('months_6', 'year_1') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions where shop_id = p_shop for update;
  if not found then
    raise exception 'shop % has no subscription row', p_shop using errcode = 'P0002';
  end if;

  v_months := case p_plan when 'months_6' then 6 else 12 end;

  -- The one line the whole plan calendar rests on, unchanged.
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

-- ------------------------------------------------------------
-- 4. where the Telegram message went
--
-- Kept so the webhook can edit the original message in place rather
-- than sending a second one: the owner should see the payment he tapped
-- turn into "چالاک کرا ✓" with its buttons gone, not a thread of
-- messages he has to read in order.
--
-- Only the service key ever writes these — the notification is sent
-- from the Worker, never from a browser — so no policy is added and
-- sellers cannot see them.
-- ------------------------------------------------------------
alter table public.payment_intents
  add column if not exists telegram_chat_id    text,
  add column if not exists telegram_message_id bigint;

comment on column public.payment_intents.telegram_message_id is
  'The notification sent to the owner, so the webhook can edit it in place.';
