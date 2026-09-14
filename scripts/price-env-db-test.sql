-- ============================================================
-- Shop Web — what a plan costs, per Wayl environment
--
--   su postgres -c 'psql -d <db> -v ON_ERROR_STOP=1 -f scripts/price-env-db-test.sql'
--
-- What has to hold before a test checkout is worth running and a live
-- one is worth trusting:
--
--   * in test, both plans cost 1,000
--   * in live, six months costs 38,000 and a year 72,000 — untouched
--   * an env that is neither is priced live, not cheap
--   * the intent the database writes carries that price, so it is what
--     Wayl is asked for and no mismatch is possible
--   * wayl_apply_payment re-derives it from the intent's own env and
--     refuses every other number, including the other env's price
--   * the months come from the plan, so 1,000 in test still buys six
--     months — the thing the rehearsal is meant to prove
--   * a brand-new account carries no expiry, so six months means six
--     months from now
--   * replay protection is untouched
--   * the per-shop override is gone
--
-- Runs inside one transaction and rolls back.
-- ============================================================

begin;

do $$
declare
  v_seller   uuid := gen_random_uuid();
  v_shop     uuid := gen_random_uuid();
  v_ref      text := 'BZ-ENVTEST-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_ref2     text := 'BZ-ENVLIVE-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_secret   text := repeat('c', 64);
  v_row      record;
  v_intent   uuid;
  v_live     uuid;
  v_start    timestamptz;
  v_expires  timestamptz;
  v_months   int;
  v_amount   numeric;
  v_count    int;
begin
  -- ---------- 1. the price list, per environment ----------
  if app.plan_price_for('months_6', 'test') <> 1000
     or app.plan_price_for('year_1', 'test') <> 1000 then
    raise exception 'FAIL test prices are % and %',
      app.plan_price_for('months_6', 'test'), app.plan_price_for('year_1', 'test');
  end if;
  raise notice 'PASS in test, both plans cost 1,000';

  if app.plan_price_for('months_6', 'live') <> 38000
     or app.plan_price_for('year_1', 'live') <> 72000 then
    raise exception 'FAIL live prices are % and %',
      app.plan_price_for('months_6', 'live'), app.plan_price_for('year_1', 'live');
  end if;
  raise notice 'PASS in live, six months is 38,000 and a year is 72,000';

  -- The live prices are still the ones in app.plan_price, unchanged.
  if app.plan_price('months_6') <> 38000 or app.plan_price('year_1') <> 72000 then
    raise exception 'FAIL the live price list moved';
  end if;
  raise notice 'PASS app.plan_price — the live list — is untouched';

  -- ---------- 2. anything else is priced live, never cheap ----------
  if app.plan_price_for('months_6', null) <> 38000
     or app.plan_price_for('months_6', 'TEST') <> 38000
     or app.plan_price_for('months_6', '') <> 38000
     or app.plan_price_for('months_6', 'sandbox') <> 38000 then
    raise exception 'FAIL an unrecognised env was priced as test';
  end if;
  raise notice 'PASS null, empty, mis-cased and unknown envs are priced live';

  if app.plan_price_for('nonsense', 'test') is not null
     or app.plan_price_for('nonsense', 'live') is not null then
    raise exception 'FAIL an unknown plan has a price';
  end if;
  raise notice 'PASS an unknown plan has no price in either env';

  -- ---------- 3. the override mechanism is gone ----------
  if to_regclass('app.price_overrides') is not null then
    raise exception 'FAIL app.price_overrides still exists';
  end if;
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'plan_price_for'
     and pg_get_function_identity_arguments(p.oid) = 'text, uuid';
  if v_count <> 0 then raise exception 'FAIL the per-shop override function survives'; end if;
  raise notice 'PASS the per-shop override table and function are gone';

  -- ---------- 4. a brand-new account carries no time ----------
  insert into auth.users(id, email) values (v_seller, 'env-seller@shop-web.test');
  insert into public.shops(id, owner_id, slug, name, whatsapp)
    values (v_shop, v_seller, 'env-' || replace(v_shop::text, '-', ''), 'Env test', '+9647500000021');

  select plan, status, started_at, expires_at into v_row
    from public.subscriptions where shop_id = v_shop;
  if v_row.plan <> 'free' or v_row.status <> 'free' then
    raise exception 'FAIL a new shop starts on % / %', v_row.plan, v_row.status;
  end if;
  if v_row.expires_at > now() then
    raise exception 'FAIL a new shop already holds time until %', v_row.expires_at;
  end if;
  raise notice 'PASS a brand-new account starts free with no time on it';

  -- ---------- 5. a test checkout, through the real path ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into v_row from public.wayl_start_intent(v_shop, 'months_6', v_ref, 'test', v_secret);
  v_intent := v_row.id;
  if v_row.amount <> 1000 then
    raise exception 'FAIL a test checkout was created at %, not 1000', v_row.amount;
  end if;
  if v_row.env <> 'test' then
    raise exception 'FAIL the intent env is %', v_row.env;
  end if;
  raise notice 'PASS a test checkout is written at 1,000 — what Wayl is asked for';

  set local role none;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;

  -- ---------- 6. the money is still checked, against this env ----------
  begin
    perform public.wayl_apply_payment(v_intent, v_ref, 38000, 'Wallet', 'wayl');
    raise exception 'FAIL the live price activated a test intent';
  exception when sqlstate '22023' then
    raise notice 'PASS the live price is refused on a test intent';
  end;

  begin
    perform public.wayl_apply_payment(v_intent, v_ref, 1, 'Wallet', 'wayl');
    raise exception 'FAIL one dinar activated a test intent';
  exception when sqlstate '22023' then
    raise notice 'PASS an amount that is not this env''s price is refused';
  end;

  -- ---------- 7. 1,000 in test still buys six whole months ----------
  v_start := now();
  select * into v_row from public.wayl_apply_payment(v_intent, v_ref, 1000, 'Wallet', 'wayl');
  if not v_row.activated then raise exception 'FAIL 1,000 did not activate in test'; end if;

  set local role none;
  select months_added, amount into strict v_months, v_amount
    from public.payments where shop_id = v_shop and method = 'wayl';
  if v_months <> 6 then raise exception 'FAIL % months granted, not 6', v_months; end if;
  if v_amount <> 1000 then raise exception 'FAIL recorded as %, not 1000', v_amount; end if;

  select expires_at into v_expires from public.subscriptions where shop_id = v_shop;
  -- From now, not from a stale expiry: a fresh account has none, so the
  -- greatest(now, expires_at) in admin_apply_payment lands on now.
  if v_expires < v_start + interval '6 months'
     or v_expires > now() + interval '6 months' then
    raise exception 'FAIL the period ends at %, not six months from now', v_expires;
  end if;
  raise notice 'PASS a 1,000 test payment grants exactly six months from now';

  -- ---------- 8. replay is still refused ----------
  set local role service_role;
  select * into v_row from public.wayl_apply_payment(v_intent, v_ref, 1000, 'Wallet', 'wayl');
  if v_row.activated or not v_row.already_active then
    raise exception 'FAIL a replay was treated as a new payment';
  end if;
  set local role none;
  select count(*) into v_count from public.payments where shop_id = v_shop;
  if v_count <> 1 then raise exception 'FAIL % payment rows after a replay', v_count; end if;
  select expires_at into v_row from public.subscriptions where shop_id = v_shop;
  if v_row.expires_at <> v_expires then
    raise exception 'FAIL a replay moved the expiry to %', v_row.expires_at;
  end if;
  raise notice 'PASS a replayed test payment adds nothing';

  -- ---------- 9. the same shop, a live checkout ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into v_row from public.wayl_start_intent(v_shop, 'year_1', v_ref2, 'live', v_secret);
  v_live := v_row.id;
  if v_row.amount <> 72000 then
    raise exception 'FAIL a live year checkout was created at %, not 72000', v_row.amount;
  end if;
  raise notice 'PASS a live checkout on the same shop is written at 72,000';

  set local role none;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;

  begin
    perform public.wayl_apply_payment(v_live, v_ref2, 1000, 'Wallet', 'wayl');
    raise exception 'FAIL the test price activated a live intent';
  exception when sqlstate '22023' then
    raise notice 'PASS the test price cannot activate a live intent';
  end;

  set local role none;
  raise notice 'ALL PRICE ENVIRONMENT DATABASE CHECKS PASSED';
end $$;

rollback;
