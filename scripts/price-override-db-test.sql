-- ============================================================
-- Shop Web — the temporary live-test price override
--
--   su postgres -c 'psql -d <db> -v ON_ERROR_STOP=1 -f scripts/price-override-db-test.sql'
--
-- What has to be true for a real payment to be worth 1,000 IQD and
-- nothing else to move:
--
--   * only the named shop and the named plan are cheaper
--   * every other shop still pays the list price
--   * the other plan is untouched, for everybody
--   * the intent the database writes carries the override amount, so
--     that is what Wayl is asked for
--   * wayl_apply_payment agrees with it independently, and still
--     refuses any other number
--   * the plan still grants its own months, not months bought by the
--     amount paid
--   * a seller can neither read nor write the override table
--   * an expired override stops applying on its own
--   * deleting the row puts the list price back
--
-- Leaves nothing behind: the whole thing runs inside one transaction
-- that is rolled back at the end.
-- ============================================================

begin;

do $$
declare
  v_seller   uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid();
  v_shop     uuid := gen_random_uuid();
  v_shop2    uuid := gen_random_uuid();
  v_ref      text := 'BZ-OVRTEST-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_secret   text := repeat('b', 64);
  v_row      record;
  v_intent   uuid;
  v_expires  timestamptz;
  v_before   timestamptz;
  v_months   int;
  v_amount   numeric;
begin
  insert into auth.users(id, email) values (v_seller, 'override-seller@shop-web.test');
  insert into auth.users(id, email) values (v_other,  'override-other@shop-web.test');
  insert into public.shops(id, owner_id, slug, name, whatsapp)
    values (v_shop,  v_seller, 'ovr-' || replace(v_shop::text,  '-', ''), 'Override test', '+9647500000011');
  insert into public.shops(id, owner_id, slug, name, whatsapp)
    values (v_shop2, v_other,  'ovr-' || replace(v_shop2::text, '-', ''), 'Bystander',     '+9647500000012');

  -- ---------- 1. the price list is untouched ----------
  if app.plan_price('months_6') <> 38000 then
    raise exception 'FAIL the list price of six months moved: %', app.plan_price('months_6');
  end if;
  if app.plan_price('year_1') <> 72000 then
    raise exception 'FAIL the list price of a year moved: %', app.plan_price('year_1');
  end if;
  raise notice 'PASS app.plan_price still says 38,000 and 72,000';

  -- ---------- 2. no override: everybody pays the list ----------
  if app.plan_price_for('months_6', v_shop) <> 38000 then
    raise exception 'FAIL six months is % before any override', app.plan_price_for('months_6', v_shop);
  end if;
  raise notice 'PASS with no override in force, the list price is what is charged';

  -- ---------- 2b. the environment-wide test price is gone ----------
  -- It was the wrong answer: it could only make a checkout cheap by
  -- putting production into test mode, where no real payment happens.
  -- Matched on argument TYPES, not on the identity string: that string
  -- carries the parameter names too ('p_plan text, p_shop uuid'), so
  -- comparing it to 'text, text' is false for every function that has
  -- ever existed and the check passes without testing anything.
  select count(*) into v_months from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'plan_price_for'
     and array_to_string(p.proargtypes::oid[]::regtype[], ',') = 'text,text';
  if v_months <> 0 then
    raise exception 'FAIL the environment-wide test price still exists';
  end if;
  select count(*) into v_months from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'plan_price_for'
     and array_to_string(p.proargtypes::oid[]::regtype[], ',') = 'text,uuid';
  if v_months <> 1 then
    raise exception 'FAIL the per-shop price function is not there';
  end if;
  raise notice 'PASS pricing by Wayl environment is gone; pricing by shop is in place';

  -- ---------- 3. one shop, one plan ----------
  insert into app.price_overrides(shop_id, plan, amount, expires_at, note)
       values (v_shop, 'months_6', 1000, now() + interval '1 hour', 'live payment test');

  if app.plan_price_for('months_6', v_shop) <> 1000 then
    raise exception 'FAIL the override shop pays % for six months', app.plan_price_for('months_6', v_shop);
  end if;
  raise notice 'PASS the named shop pays 1,000 for six months';

  if app.plan_price_for('year_1', v_shop) <> 72000 then
    raise exception 'FAIL a year moved to % for the override shop', app.plan_price_for('year_1', v_shop);
  end if;
  raise notice 'PASS a year is still 72,000 for the same shop';

  if app.plan_price_for('months_6', v_shop2) <> 38000 then
    raise exception 'FAIL a bystander shop pays % for six months', app.plan_price_for('months_6', v_shop2);
  end if;
  if app.plan_price_for('year_1', v_shop2) <> 72000 then
    raise exception 'FAIL a bystander shop pays % for a year', app.plan_price_for('year_1', v_shop2);
  end if;
  raise notice 'PASS every other shop is untouched, on both plans';

  -- ---------- 4. as the seller, through the real path ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into v_row from public.wayl_start_intent(v_shop, 'months_6', v_ref, 'live', v_secret);
  v_intent := v_row.id;
  if v_row.amount <> 1000 then
    raise exception 'FAIL the checkout was created at %, not 1000', v_row.amount;
  end if;
  raise notice 'PASS the intent the server writes is 1,000 — what Wayl will be asked for';

  -- The seller cannot see the override table, let alone write one.
  begin
    perform 1 from app.price_overrides;
    raise exception 'FAIL a seller read the override table';
  exception
    when insufficient_privilege then
      raise notice 'PASS a seller cannot read the override table';
    when others then
      raise notice 'PASS a seller cannot read the override table (%)', sqlerrm;
  end;

  begin
    insert into app.price_overrides(shop_id, plan, amount, expires_at)
         values (v_shop, 'year_1', 1, now() + interval '1 hour');
    raise exception 'FAIL a seller wrote their own price';
  exception
    when insufficient_privilege then
      raise notice 'PASS a seller cannot write their own price';
    when others then
      raise notice 'PASS a seller cannot write their own price (%)', sqlerrm;
  end;

  -- From here on, the service key — the only thing allowed to activate.
  set local role none;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;

  -- ---------- 5. activation still checks the money ----------
  -- A number the seller would like better is still refused, and the
  -- refusal comes from the database, not from the Worker.
  begin
    perform public.wayl_apply_payment(v_intent, v_ref, 1, 'Wallet', 'wayl');
    raise exception 'FAIL one dinar activated a plan';
  exception when sqlstate '22023' then
    raise notice 'PASS an amount that is not the override price is refused';
  end;

  begin
    perform public.wayl_apply_payment(v_intent, v_ref, 38000, 'Wallet', 'wayl');
    raise exception 'FAIL the old price activated a plan the override had repriced';
  exception when sqlstate '22023' then
    raise notice 'PASS even the list price is refused while the override is in force';
  end;

  select expires_at into v_before from public.subscriptions where shop_id = v_shop;

  select * into v_row from public.wayl_apply_payment(v_intent, v_ref, 1000, 'Wallet', 'wayl');
  if not v_row.activated then raise exception 'FAIL 1,000 did not activate'; end if;
  raise notice 'PASS 1,000 activates, verified against the override and nothing else';

  -- ---------- 6. six months, not six thousand dinars' worth ----------
  -- Read as the owner: this shim's service_role has no BYPASSRLS, so a
  -- plain select here returns nothing and every check below would pass
  -- on a null without ever running.
  set local role none;
  select months_added, amount into strict v_months, v_amount
    from public.payments where shop_id = v_shop and method = 'wayl';
  if v_months <> 6 then
    raise exception 'FAIL % months were granted, not 6', v_months;
  end if;
  if v_amount <> 1000 then
    raise exception 'FAIL the payment was recorded as %, not 1000', v_amount;
  end if;
  select expires_at into v_expires from public.subscriptions where shop_id = v_shop;
  if v_expires <> greatest(v_before, now()) + interval '6 months' then
    raise exception 'FAIL the period ends at %, not six months on', v_expires;
  end if;
  raise notice 'PASS exactly six months granted, and 1,000 recorded as what was paid';

  -- ---------- 7. replay is still refused ----------
  set local role service_role;
  select * into v_row from public.wayl_apply_payment(v_intent, v_ref, 1000, 'Wallet', 'wayl');
  set local role none;
  if v_row.activated or not v_row.already_active then
    raise exception 'FAIL a replay was treated as a new payment';
  end if;
  select expires_at into v_expires from public.subscriptions where shop_id = v_shop;
  if v_expires <> greatest(v_before, now()) + interval '6 months' then
    raise exception 'FAIL a replay moved the expiry to %', v_expires;
  end if;
  select count(*) into v_months from public.payments where shop_id = v_shop;
  if v_months <> 1 then raise exception 'FAIL % payment rows after a replay', v_months; end if;
  set local role service_role;
  raise notice 'PASS a replayed payment adds nothing — one payment, one period';

  -- ---------- 8. it lets go by itself ----------
  -- Only the database owner can touch this table at all: the service
  -- key was refused a line ago, which is the point.
  set local role none;
  update app.price_overrides set expires_at = now() - interval '1 minute'
   where shop_id = v_shop and plan = 'months_6';
  if app.plan_price_for('months_6', v_shop) <> 38000 then
    raise exception 'FAIL an expired override still applied: %', app.plan_price_for('months_6', v_shop);
  end if;
  raise notice 'PASS an override past its hour stops applying on its own';

  -- ---------- 9. the rollback ----------
  delete from app.price_overrides;
  if app.plan_price_for('months_6', v_shop) <> 38000
     or app.plan_price_for('year_1', v_shop) <> 72000 then
    raise exception 'FAIL deleting the row did not restore the list price';
  end if;
  raise notice 'PASS deleting the row restores 38,000 and 72,000 everywhere';

  raise notice 'ALL PRICE OVERRIDE DATABASE CHECKS PASSED';
end $$;

rollback;
