-- ============================================================
-- Shop Web — 0024: manual payment flow
--
-- There is no payment processor. A seller picks a plan, transfers the
-- money to the owner's FIB number with a short reference code in the
-- note, taps "I sent it", and the owner confirms it by hand.
--
-- The whole design point is that the manual confirmation step is ONE
-- function — admin_activate_intent — so that when FIB merchant
-- credentials arrive, a webhook calls the same function and nothing
-- else in the app changes.
--
-- Five states the seller can be in:
--   trial    subscriptions.status = 'trialing'
--   pending  a payment_intent in 'pending' — said they paid, unconfirmed
--   active   subscriptions.status = 'active'
--   grace    expired, inside grace_days, products still visible
--   expired  past grace, products hidden
--
-- Only the first three are stored. `grace` and `expired` are derived
-- from expires_at + grace_days, which is what makes "paying restores
-- everything immediately" true without touching a single product row:
-- app.shop_is_public() is in the RLS predicate for products, so moving
-- expires_at forward republishes the whole shop in the same statement.
-- ============================================================

-- ------------------------------------------------------------
-- 1. the price list lives in the database too
--
-- worker/config.js PLANS is what a seller is shown; this is what is
-- actually stored. A seller posting their own payment_intent row could
-- otherwise name their own amount — RLS only checked that they own the
-- shop. The trigger below overwrites whatever arrives.
--
-- IMMUTABLE so it can be inlined; changing a price means a new
-- migration, which is correct — old rows keep the amount they were
-- created with, so an early seller keeps their price.
-- ------------------------------------------------------------
create or replace function app.plan_price(p_plan text)
returns numeric
language sql
immutable
as $$
  select case p_plan
           when 'months_6' then 55000::numeric
           when 'year_1'   then 90000::numeric
         end;
$$;

-- This is authoritative for what a seller is charged. PLANS in
-- worker/config.js is the same two numbers for display only, and
-- nothing enforces that the two agree: changing a price means editing
-- both, in one commit. A seller shown one number and billed another is
-- the failure this comment exists to prevent.
comment on function app.plan_price(text) is
  'IQD price per plan, authoritative. PLANS in worker/config.js must be edited to match.';

-- ------------------------------------------------------------
-- 2. the reference code
--
-- Short enough to type into a bank transfer note on a phone: SW-4821.
-- Unique across every intent ever made, so the owner reading a note
-- weeks later never finds two shops behind one code. That caps the app
-- at 9000 lifetime intents, which is far past the point where this
-- manual flow would have been replaced by the webhook.
-- ------------------------------------------------------------
alter table public.payment_intents
  add column if not exists reference text;

alter table public.payment_intents
  drop constraint if exists payment_intents_reference_fmt,
  add constraint payment_intents_reference_fmt
    check (reference is null or reference ~ '^SW-[0-9]{4}$');

create unique index if not exists payment_intents_reference_key
  on public.payment_intents (reference);

create or replace function app.next_intent_reference()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_ref text;
begin
  -- Random rather than sequential: two sellers paying the same evening
  -- should not get codes one apart, because the owner matches them by
  -- eye against a bank statement.
  for i in 1..200 loop
    v_ref := 'SW-' || lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    if not exists (select 1 from public.payment_intents where reference = v_ref) then
      return v_ref;
    end if;
  end loop;
  raise exception 'could not allocate a payment reference' using errcode = '53400';
end;
$$;

-- ------------------------------------------------------------
-- 3. 'pending' — the seller says they paid
-- ------------------------------------------------------------
alter table public.payment_intents
  drop constraint if exists payment_intents_status_check,
  add constraint payment_intents_status_check
    check (status in ('open', 'pending', 'contacted', 'paid', 'cancelled'));

-- One live intent per shop and plan.
--
-- The brief says `where status = 'open'`. It covers 'pending' as well,
-- because a pending intent is still live: without it a seller who taps
-- "I sent it" can immediately file a second intent for the same plan
-- and the owner sees two rows for one transfer.
drop index if exists payment_intents_one_open_per_plan;
create unique index payment_intents_one_live_per_plan
  on public.payment_intents (shop_id, plan)
  where status in ('open', 'pending');

-- Existing open intents predate the reference column.
update public.payment_intents
   set reference = app.next_intent_reference()
 where reference is null
   and status in ('open', 'pending');

-- ------------------------------------------------------------
-- 4. the price is set by the server, never by the client
-- ------------------------------------------------------------
create or replace function app.set_intent_price()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
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

drop trigger if exists payment_intents_set_price on public.payment_intents;
create trigger payment_intents_set_price
  before insert on public.payment_intents
  for each row execute function app.set_intent_price();

-- ------------------------------------------------------------
-- 5. grace is 7 days
--
-- The column defaulted to 3. Every shop created so far got that, and
-- the rule is now 7 for everybody.
--
-- SUPERSEDED by 0025, which puts it back to 3. Left here as it ran.
-- ------------------------------------------------------------
alter table public.subscriptions alter column grace_days set default 7;
update public.subscriptions set grace_days = 7 where grace_days = 3;

-- ------------------------------------------------------------
-- 6. the date rule, and only the date rule
--
--   new_end = max(current_end, today) + plan duration
--
-- admin_apply_payment already did the max(). What it also did was grant
-- two free months to anyone paying during their trial, which is a
-- different rule and contradicts this one: a seller paying on day 10 of
-- the trial got 6 + 2 months plus the remaining 20 days. The remaining
-- days are the whole of what carrying over means, so the bonus goes.
--
-- bonus_months and bonus_months_granted stay as columns: they hold the
-- history of payments already made under the old rule.
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

  -- The one line the whole plan calendar rests on. A seller still in
  -- trial keeps the days they have not used; an expired one starts from
  -- today rather than being charged for the time they were away.
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

-- ------------------------------------------------------------
-- 7. the seller says they paid
--
-- The only transition a seller may make, on their own intent, in one
-- direction. payment_intents UPDATE is still admin-only in RLS; this is
-- the single hole, and it is exactly one column moving open -> pending.
-- ------------------------------------------------------------
create or replace function public.mark_intent_sent(p_intent uuid)
returns payment_intents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.payment_intents;
begin
  update public.payment_intents
     set status = 'pending'
   where id = p_intent
     and status = 'open'
     and app.owns_shop(shop_id)
  returning * into v_intent;

  if not found then
    raise exception 'intent % is not an open intent of yours', p_intent
      using errcode = '22023';
  end if;

  return v_intent;
end;
$$;

revoke all on function public.mark_intent_sent(uuid) from public;
grant execute on function public.mark_intent_sent(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 8. the owner confirms
--
-- Unchanged except that it now accepts a pending intent, which is the
-- normal path, and records the human reference code on the payment
-- rather than the intent's uuid — the owner matches that code against
-- the transfer note.
--
-- This is the seam. A FIB webhook that verifies a transfer calls this
-- one function and the rest of the app does not change.
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
  if not app.is_admin() then
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

-- ------------------------------------------------------------
-- 9. the owner cannot find the transfer
--
-- Not a rejection, and not a new state: the intent goes back to where
-- it was before the seller tapped the button, and the owner follows up
-- on WhatsApp. The subscription was never touched by a pending intent,
-- so there is nothing to undo there.
-- ------------------------------------------------------------
create or replace function public.admin_intent_not_found(p_intent uuid, p_note text default null)
returns payment_intents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.payment_intents;
begin
  if not app.is_admin() then
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

revoke all on function public.admin_intent_not_found(uuid, text) from public;
grant execute on function public.admin_intent_not_found(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- 10. who is about to expire
--
-- The owner sends the reminder himself on WhatsApp, so this returns the
-- number rather than doing anything with it. Shops already past grace
-- are excluded: they are not "expiring soon", they are gone, and the
-- shops list already shows them.
-- ------------------------------------------------------------
create or replace function public.admin_expiring_soon(p_days int default 7)
returns table (
  shop_id uuid, name text, slug text, whatsapp text,
  plan text, status text, expires_at timestamptz, days_left int, in_grace boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.id, s.name, s.slug, s.whatsapp,
    sub.plan, sub.status, sub.expires_at,
    ceil(extract(epoch from (sub.expires_at - now())) / 86400)::int,
    (now() >= sub.expires_at
      and now() < sub.expires_at + make_interval(days => sub.grace_days))
  from public.shops s
  join public.subscriptions sub on sub.shop_id = s.id
  where app.is_admin()
    and s.status = 'active'
    and sub.expires_at < now() + make_interval(days => p_days)
    and now() < sub.expires_at + make_interval(days => sub.grace_days)
  order by sub.expires_at asc
  limit 200;
$$;

revoke all on function public.admin_expiring_soon(int) from public;
grant execute on function public.admin_expiring_soon(int) to authenticated, service_role;

-- ------------------------------------------------------------
-- 11. the payments the owner has to look at
--
-- Everything not yet resolved, newest first, with the shop's name and
-- number so the list is one query rather than a join per row.
-- ------------------------------------------------------------
create or replace function public.admin_open_intents()
returns table (
  id uuid, shop_id uuid, name text, slug text, whatsapp text,
  plan text, amount numeric, reference text, status text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    i.id, i.shop_id, s.name, s.slug, s.whatsapp,
    i.plan, i.amount, i.reference, i.status, i.created_at
  from public.payment_intents i
  join public.shops s on s.id = i.shop_id
  where app.is_admin()
    and i.status in ('open', 'pending')
  -- Pending first: somebody is waiting on the owner for those.
  order by (i.status = 'pending') desc, i.created_at asc
  limit 200;
$$;

revoke all on function public.admin_open_intents() from public;
grant execute on function public.admin_open_intents() to authenticated, service_role;
