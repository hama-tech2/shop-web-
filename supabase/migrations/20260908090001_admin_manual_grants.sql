-- Direct, free grants use the existing intent -> payment activation transaction.
-- Ordered after 20260908090000 because it extends that activation function.
alter table public.payment_intents
  add column source text not null default 'payment'
    check (source in ('payment', 'manual_grant')),
  add constraint payment_intents_manual_grant_check check (
    source <> 'manual_grant' or
    (amount = 0 and reference is null and note is not null and length(btrim(note)) between 1 and 500)
  );

alter table public.payments
  drop constraint payments_method_check,
  add constraint payments_method_check check (
    method in ('cash', 'fib', 'fastpay', 'zaincash', 'nasspay', 'transfer', 'other', 'manual_grant')
  ),
  add constraint payments_manual_grant_check check (
    method <> 'manual_grant' or
    (amount = 0 and note is not null and length(btrim(note)) between 1 and 500 and reference is not null)
  );
create unique index payments_manual_grant_request_key
  on public.payments(reference) where method = 'manual_grant';

-- A gift must not overwrite or block a real transfer already awaiting review.
drop index public.payment_intents_one_live_per_plan;
create unique index payment_intents_one_live_per_plan
  on public.payment_intents(shop_id, plan)
  where status in ('open', 'pending') and source = 'payment';

create or replace function app.set_intent_price()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.amount := app.plan_price(new.plan);
  if new.amount is null then
    raise exception 'unknown plan %', new.plan using errcode = '22023';
  end if;
  if new.source = 'manual_grant' then
    if not app.is_admin() then
      raise exception 'admin only' using errcode = '42501';
    end if;
    new.amount := 0;
    new.reference := null;
  elsif new.reference is null then
    new.reference := app.next_intent_reference();
  end if;
  return new;
end;
$$;

create policy payment_intents_insert_manual_admin on public.payment_intents
  for insert to authenticated
  with check (app.is_admin() and source = 'manual_grant' and status = 'open');

create or replace function public.admin_activate_intent(p_intent uuid, p_note text default null)
returns payments language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_intent public.payment_intents;
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

  if v_intent.source = 'manual_grant' then
    -- A free grant must have a real, active human admin as its actor.
    if not app.is_admin() then
      raise exception 'admin only' using errcode = '42501';
    end if;
    v_payment := public.admin_apply_payment(
      v_intent.shop_id, v_intent.plan, 0, 'manual_grant', p_intent::text, v_intent.note);
  else
    -- Existing paid activation (including the service caller) is unchanged.
    v_payment := public.admin_apply_payment(
      v_intent.shop_id, v_intent.plan, v_intent.amount, 'fib',
      coalesce(v_intent.reference, p_intent::text), p_note);
  end if;
  update public.payment_intents
     set status = 'paid', handled_at = now(), handled_by = auth.uid()
   where id = p_intent;
  return v_payment;
end;
$$;

-- Invoker: the authenticated admin's RLS and actor identity remain in force.
-- No date arithmetic or visibility writes here: activation owns both.
create function public.admin_grant_plan(p_shop uuid, p_plan text, p_reason text, p_request uuid)
returns payments language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_intent public.payment_intents;
  v_payment public.payments;
  v_reason text := btrim(p_reason);
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_plan is null or p_plan not in ('months_6', 'year_1') or p_request is null
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
comment on function public.admin_grant_plan(uuid, text, text, uuid) is
  'Audited free grant through admin_activate_intent. Same request UUID is safe to retry; never a FIB payment.';
