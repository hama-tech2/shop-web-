-- Run against the migrated database. Every fixture and payment rolls back.
--
-- What it pins is the half of the Wayl flow that lives in the database:
-- who may start a checkout, who may activate one, what an activation is
-- allowed to cost, and what happens when the same payment arrives twice.
-- The Worker's half is scripts/wayl-test.mjs.
begin;
do $$
declare
  v_seller  uuid := gen_random_uuid();
  v_shop    uuid := gen_random_uuid();
  v_intent  uuid;
  v_ref     text := 'BZ-DBTEST-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_secret  text := repeat('a', 64);
  v_row     record;
  v_before  timestamptz;
  v_after   timestamptz;
  v_now     timestamptz;
  v_count   int;
  v_method  text;
  v_active  boolean;
begin
  insert into auth.users(id, email, aud, role)
    values(v_seller, 'wayl-rollback-' || v_seller || '@example.invalid', 'authenticated', 'authenticated');
  insert into public.shops(id, owner_id, slug, name, whatsapp)
    values(v_shop, v_seller, 'wayl-' || replace(v_shop::text, '-', ''), 'Wayl rollback test', '+9647500000002');

  -- Really as the seller: the role as well as the claim, so RLS and
  -- every EXECUTE grant is in force exactly as it is for a browser.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select expires_at into v_before from public.subscriptions where shop_id = v_shop;

  -- 1. a checkout, priced by the server
  select * into v_row from public.wayl_start_intent(v_shop, 'year_1', v_ref, 'test', v_secret);
  v_intent := v_row.id;
  if v_row.amount <> 90000 then raise exception 'FAIL price % is not 90000', v_row.amount; end if;
  if v_row.reused then raise exception 'FAIL a fresh intent claimed to be reused'; end if;
  if v_row.status <> 'open' then raise exception 'FAIL a new intent is %', v_row.status; end if;
  raise notice 'PASS a checkout is created at the server price';

  -- 2. the secret is out of the seller's reach entirely
  begin
    perform 1 from public.payment_intent_secrets;
    raise exception 'FAIL a seller read the webhook secrets table';
  exception when insufficient_privilege then
    raise notice 'PASS a seller cannot read the webhook secret';
  end;

  set local role none;
  select count(*) into v_count from public.payment_intent_secrets where intent_id = v_intent;
  if v_count <> 1 then raise exception 'FAIL the secret was not stored'; end if;
  set local role authenticated;
  raise notice 'PASS the webhook secret is stored, in its own table';

  -- 3. an open intent with no link is stale, not reusable
  select * into v_row from public.wayl_start_intent(v_shop, 'year_1', v_ref || 'B', 'test', v_secret);
  if v_row.reused then raise exception 'FAIL reused an intent that has no checkout url'; end if;
  select status into v_method from public.payment_intents where id = v_intent;
  if v_method <> 'cancelled' then raise exception 'FAIL the stale intent is %', v_method; end if;
  v_intent := v_row.id;
  v_ref := v_ref || 'B';
  raise notice 'PASS a stale intent is cancelled, never left live';

  -- 4. one with a link comes back, so a second tap is not a second payment
  perform public.wayl_attach_link(v_intent, 'lnk_1', 'CODE1', 'https://checkout.example.invalid/x');
  select * into v_row from public.wayl_start_intent(v_shop, 'year_1', v_ref || 'C', 'test', v_secret);
  if not v_row.reused or v_row.id <> v_intent then
    raise exception 'FAIL a live checkout was not reused';
  end if;
  raise notice 'PASS a live checkout is reused, not paid for twice';

  -- 5. a seller cannot activate their own payment
  begin
    perform public.wayl_apply_payment(v_intent, v_ref, 90000, 'FIB', 'seller');
    raise exception 'FAIL a seller activated their own payment';
  exception when insufficient_privilege then
    raise notice 'PASS a seller cannot activate their own payment';
  end;

  -- the service key from here: the webhook and the status poll both
  set local role none;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;

  -- 6. the amount is the plan price or nothing
  begin
    perform public.wayl_apply_payment(v_intent, v_ref, 1000, 'FIB', 'wayl');
    raise exception 'FAIL a smaller amount activated a plan';
  exception when invalid_parameter_value then
    raise notice 'PASS an amount that is not the plan price is refused';
  end;

  -- 7. and the reference is this payment's or nothing
  begin
    perform public.wayl_apply_payment(v_intent, 'BZ-SOMEONE-ELSE', 90000, 'FIB', 'wayl');
    raise exception 'FAIL another reference activated this plan';
  exception when invalid_parameter_value then
    raise notice 'PASS another payment''s reference is refused';
  end;

  select count(*) into v_count from public.payments where shop_id = v_shop;
  if v_count <> 0 then raise exception 'FAIL % payments recorded by refusals', v_count; end if;

  -- 8. the activation itself, and the one date rule
  v_now := now();
  select * into v_row from public.wayl_apply_payment(v_intent, v_ref, 90000, 'FIB', 'wayl');
  if not v_row.activated then raise exception 'FAIL the payment did not activate'; end if;
  select expires_at into v_after from public.subscriptions where shop_id = v_shop;
  if date_trunc('day', v_after)
     <> date_trunc('day', greatest(v_now, v_before) + interval '12 months') then
    raise exception 'FAIL the expiry is % rather than the carried-over year', v_after;
  end if;
  raise notice 'PASS the plan extends from max(now, current expiry)';

  select count(*) into v_count from public.payments
   where shop_id = v_shop and method = 'wayl' and amount = 90000;
  if v_count <> 1 then raise exception 'FAIL % wayl payments recorded', v_count; end if;
  select payment_method, activated_at is not null into v_method, v_active
    from public.payment_intents where id = v_intent;
  if not v_active then raise exception 'FAIL activated_at was not set'; end if;
  if v_method <> 'FIB' then raise exception 'FAIL the stored method is %', v_method; end if;
  raise notice 'PASS the payment, and the method Wayl supplied, are recorded';

  -- 9. the same payment again: a webhook retry, or a browser still polling
  select * into v_row from public.wayl_apply_payment(v_intent, v_ref, 90000, 'FIB', 'wayl');
  if v_row.activated or not v_row.already_active then
    raise exception 'FAIL a repeat activated a second time';
  end if;
  select count(*) into v_count from public.payments where shop_id = v_shop;
  if v_count <> 1 then raise exception 'FAIL % payments after a repeat', v_count; end if;
  select expires_at into v_before from public.subscriptions where shop_id = v_shop;
  if v_before <> v_after then raise exception 'FAIL the expiry moved twice'; end if;
  raise notice 'PASS a repeated activation grants nothing';

  -- 10. a replayed webhook event is taken exactly once
  if not public.wayl_record_event(v_intent, 'evt_' || v_intent, null, 'paid') then
    raise exception 'FAIL a new event was not recorded';
  end if;
  if public.wayl_record_event(v_intent, 'evt_' || v_intent, null, 'paid') then
    raise exception 'FAIL a replayed event was recorded twice';
  end if;
  raise notice 'PASS a replayed event id is refused';

  -- 11. a transfer the owner has not found yet is never overtaken
  set local role none;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.payment_intents(shop_id, plan, amount) values (v_shop, 'months_6', 0)
    returning id into v_intent;
  perform public.mark_intent_sent(v_intent);
  begin
    perform public.wayl_start_intent(v_shop, 'months_6', v_ref || 'D', 'test', v_secret);
    raise exception 'FAIL a Wayl checkout was started over a waiting transfer';
  exception when sqlstate 'SW003' then
    raise notice 'PASS a manual transfer awaiting the owner is not overtaken';
  end;

  -- 12. and one shop cannot make checkouts in a loop
  begin
    for i in 1..8 loop
      perform public.wayl_start_intent(v_shop, 'year_1', v_ref || '-R' || i, 'test', v_secret);
    end loop;
    raise exception 'FAIL a shop made unlimited checkouts';
  exception when sqlstate 'SW002' then
    raise notice 'PASS a shop cannot make checkouts in a loop';
  end;

  set local role none;
  raise notice 'ALL WAYL DATABASE CHECKS PASSED';
end;
$$;
rollback;
