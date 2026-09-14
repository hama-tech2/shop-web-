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
  v_price   numeric;
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
  -- Read from the price list, never pinned to a number here: this test
  -- went stale and silently stopped running the moment the year changed
  -- from 90,000 to 72,000.
  v_price := app.plan_price_for('year_1', 'test');
  if v_row.amount <> v_price then
    raise exception 'FAIL price % is not %', v_row.amount, v_price;
  end if;
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

  -- 3. an open intent Wayl never issued a link for is retried on the
  --    same row — a fresh reference and a rotated secret. Nothing was
  --    spent, because nothing reached Wayl. (This was a cancel until
  --    20260914_checkout_retry_and_prices; the retry is the contract
  --    scripts/checkout-retry-db-test.sql pins in full.)
  select * into v_row from public.wayl_start_intent(v_shop, 'year_1', v_ref || 'B', 'test', v_secret);
  if not v_row.reused then raise exception 'FAIL a link-less attempt was not retried'; end if;
  if v_row.id <> v_intent then raise exception 'FAIL the retry made a second row'; end if;
  select status into v_method from public.payment_intents where id = v_intent;
  if v_method <> 'open' then raise exception 'FAIL the retried intent is %', v_method; end if;
  v_ref := v_ref || 'B';
  raise notice 'PASS an attempt Wayl never linked is retried, not duplicated';

  -- 4. one with a link comes back, so a second tap is not a second payment
  perform public.wayl_attach_link(v_intent, 'lnk_1', 'CODE1', 'https://checkout.example.invalid/x');
  select * into v_row from public.wayl_start_intent(v_shop, 'year_1', v_ref || 'C', 'test', v_secret);
  if not v_row.reused or v_row.id <> v_intent then
    raise exception 'FAIL a live checkout was not reused';
  end if;
  raise notice 'PASS a live checkout is reused, not paid for twice';

  -- 5. a seller cannot file an intent by hand at all
  --
  -- Every intent comes from wayl_start_intent, which is where the rate
  -- limit, the reference and the webhook secret are decided. A direct
  -- insert would go around all three.
  begin
    insert into public.payment_intents(shop_id, plan, amount, reference_id)
      values (v_shop, 'year_1', 0, 'BZ-HANDMADE-0001');
    raise exception 'FAIL a seller inserted a payment intent directly';
  exception when insufficient_privilege then
    raise notice 'PASS a seller cannot insert a payment intent';
  end;

  -- 6. and cannot activate their own payment
  begin
    perform public.wayl_apply_payment(v_intent, v_ref, v_price, 'FIB', 'seller');
    raise exception 'FAIL a seller activated their own payment';
  exception when insufficient_privilege then
    raise notice 'PASS a seller cannot activate their own payment';
  end;

  -- the service key from here: the webhook and the status poll both
  set local role none;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;

  -- 7. the amount is the plan price or nothing
  --
  -- Derived, not a literal: 1,000 used to be a safely wrong number and
  -- is now exactly what a test checkout costs, which made this pass by
  -- activating the very thing it was meant to refuse.
  begin
    perform public.wayl_apply_payment(v_intent, v_ref, v_price - 1, 'FIB', 'wayl');
    raise exception 'FAIL a smaller amount activated a plan';
  exception when invalid_parameter_value then
    raise notice 'PASS an amount that is not the plan price is refused';
  end;

  -- 8. and the reference is this payment's or nothing
  begin
    perform public.wayl_apply_payment(v_intent, 'BZ-SOMEONE-ELSE', v_price, 'FIB', 'wayl');
    raise exception 'FAIL another reference activated this plan';
  exception when invalid_parameter_value then
    raise notice 'PASS another payment''s reference is refused';
  end;

  select count(*) into v_count from public.payments where shop_id = v_shop;
  if v_count <> 0 then raise exception 'FAIL % payments recorded by refusals', v_count; end if;

  -- 9. the activation itself, and the one date rule
  v_now := now();
  select * into v_row from public.wayl_apply_payment(v_intent, v_ref, v_price, 'FIB', 'wayl');
  if not v_row.activated then raise exception 'FAIL the payment did not activate'; end if;
  select expires_at into v_after from public.subscriptions where shop_id = v_shop;
  if date_trunc('day', v_after)
     <> date_trunc('day', greatest(v_now, v_before) + interval '12 months') then
    raise exception 'FAIL the expiry is % rather than the carried-over year', v_after;
  end if;
  raise notice 'PASS the plan extends from max(now, current expiry)';

  -- As the owner: this shim's service_role has no BYPASSRLS, so the
  -- payments policy hides the row and the count would read 0.
  set local role none;
  select count(*) into v_count from public.payments
   where shop_id = v_shop and method = 'wayl' and amount = v_price;
  if v_count <> 1 then raise exception 'FAIL % wayl payments recorded', v_count; end if;
  set local role service_role;
  select payment_method, activated_at is not null into v_method, v_active
    from public.payment_intents where id = v_intent;
  if not v_active then raise exception 'FAIL activated_at was not set'; end if;
  if v_method <> 'FIB' then raise exception 'FAIL the stored method is %', v_method; end if;
  raise notice 'PASS the payment, and the method Wayl supplied, are recorded';

  -- 10. the same payment again: a webhook retry, or a browser still polling
  select * into v_row from public.wayl_apply_payment(v_intent, v_ref, v_price, 'FIB', 'wayl');
  if v_row.activated or not v_row.already_active then
    raise exception 'FAIL a repeat activated a second time';
  end if;
  set local role none;
  select count(*) into v_count from public.payments where shop_id = v_shop;
  if v_count <> 1 then raise exception 'FAIL % payments after a repeat', v_count; end if;
  set local role service_role;
  select expires_at into v_before from public.subscriptions where shop_id = v_shop;
  if v_before <> v_after then raise exception 'FAIL the expiry moved twice'; end if;
  raise notice 'PASS a repeated activation grants nothing';

  -- 11. a replayed webhook event is taken exactly once
  if not public.wayl_record_event(v_intent, 'evt_' || v_intent, null, 'paid') then
    raise exception 'FAIL a new event was not recorded';
  end if;
  if public.wayl_record_event(v_intent, 'evt_' || v_intent, null, 'paid') then
    raise exception 'FAIL a replayed event was recorded twice';
  end if;
  raise notice 'PASS a replayed event id is refused';

  -- 12. a transfer the owner has not found yet is never overtaken
  set local role none;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- Built the only way a seller can build one now: through the
  -- function, then through their own one-way "I sent it" door.
  select id into v_intent
    from public.wayl_start_intent(v_shop, 'months_6', v_ref || 'M', 'test', v_secret);
  perform public.mark_intent_sent(v_intent);
  begin
    perform public.wayl_start_intent(v_shop, 'months_6', v_ref || 'D', 'test', v_secret);
    raise exception 'FAIL a Wayl checkout was started over a waiting transfer';
  exception when sqlstate 'SW003' then
    raise notice 'PASS a manual transfer awaiting the owner is not overtaken';
  end;

  -- 13. tapping again costs a seller nothing
  --
  -- Since 20260914_checkout_retry_and_prices the rate limit counts only
  -- attempts Wayl actually issued a link for, so a seller whose network
  -- drops eight times is not locked out of paying. The limit itself —
  -- six linked attempts in ten minutes, twenty rows in an hour — is
  -- pinned in full by scripts/checkout-retry-db-test.sql.
  for i in 1..8 loop
    perform public.wayl_start_intent(v_shop, 'year_1', v_ref || '-R' || i, 'test', v_secret);
  end loop;
  select count(*) into v_count
    from public.payment_intents
   where shop_id = v_shop and plan = 'year_1' and status in ('open', 'pending');
  if v_count <> 1 then
    raise exception 'FAIL eight taps left % live year attempts, not one', v_count;
  end if;
  raise notice 'PASS eight taps Wayl never linked stay one row and are not rate limited';

  set local role none;
  raise notice 'ALL WAYL DATABASE CHECKS PASSED';
end;
$$;
rollback;
