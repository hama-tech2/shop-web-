-- Run against the migrated database. Every fixture rolls back.
--
-- The rule being pinned: a trial is something a seller chooses once,
-- not something an account is given for existing. Everything else here
-- is about what happens when it runs out, which is that posting stops
-- and nothing is lost.
begin;
do $$
declare
  v_seller  uuid := gen_random_uuid();
  v_shop    uuid := gen_random_uuid();
  v_second  uuid := gen_random_uuid();
  v_admin   uuid;
  v_state   record;
  v_sub     public.subscriptions;
  v_expires timestamptz;
  v_before  timestamptz;
  v_count   int;
  v_slug    text := 'trial-' || replace(v_shop::text, '-', '');
begin
  insert into auth.users(id, email, aud, role)
    values(v_seller, 'trial-rollback-' || v_seller || '@example.invalid', 'authenticated', 'authenticated');
  insert into public.shops(id, owner_id, slug, name, whatsapp)
    values(v_shop, v_seller, v_slug, 'Trial rollback test', '+9647500000003');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. signing up and building the shop spends nothing
  select * into v_state from public.subscription_state(v_shop);
  if v_state.plan <> 'none' or v_state.status <> 'none' then
    raise exception 'FAIL a new shop is on % / %', v_state.plan, v_state.status;
  end if;
  if v_state.can_publish then raise exception 'FAIL a new shop may publish'; end if;
  if not v_state.trial_available then raise exception 'FAIL the trial was spent by signing up'; end if;
  raise notice 'PASS a new shop has no plan and still has its trial';

  -- the shop is not published either, grace or no grace
  if v_state.publicly_visible then raise exception 'FAIL a shop with no plan is public'; end if;
  raise notice 'PASS a shop with no plan is not published';

  -- profile work still goes on normally
  update public.shops set bio = 'still editable', city = 'erbil' where id = v_shop;
  raise notice 'PASS shop and profile edits need no plan';

  -- 2. but posting a product does
  begin
    insert into public.products(shop_id, title, price, status)
      values(v_shop, 'Too early', 1000, 'active');
    raise exception 'FAIL a product was posted with no plan';
  exception when sqlstate 'SW005' then
    raise notice 'PASS posting is refused until a plan is chosen';
  end;

  -- 3. the seller chooses the trial
  v_before := now();
  v_sub := public.start_trial(v_shop);
  if v_sub.status <> 'trialing' or v_sub.plan <> 'trial' then
    raise exception 'FAIL after starting: % / %', v_sub.plan, v_sub.status;
  end if;
  if date_trunc('day', v_sub.expires_at)
     <> date_trunc('day', v_before + make_interval(days => app.trial_days())) then
    raise exception 'FAIL the trial ends %, not in % days', v_sub.expires_at, app.trial_days();
  end if;
  if app.trial_days() <> 30 then raise exception 'FAIL the trial is % days', app.trial_days(); end if;
  raise notice 'PASS the trial starts when the seller says so, and lasts 30 days';

  select * into v_state from public.subscription_state(v_shop);
  if not v_state.can_publish then raise exception 'FAIL a trial cannot publish'; end if;
  if v_state.trial_available then raise exception 'FAIL the trial still reads as available'; end if;
  raise notice 'PASS a running trial may publish, and is marked as taken';

  -- 4. starting it again, in every way it could be tried
  begin
    perform public.start_trial(v_shop);
    raise exception 'FAIL the trial restarted while running';
  exception when sqlstate 'SW006' then
    raise notice 'PASS a second start while it runs is refused';
  end;

  -- 5. five products, then no more
  for i in 1..app.trial_product_limit() loop
    insert into public.products(shop_id, title, price, status)
      values(v_shop, 'Trial product ' || i, 1000, 'active');
  end loop;
  begin
    insert into public.products(shop_id, title, price, status)
      values(v_shop, 'One too many', 1000, 'active');
    raise exception 'FAIL the trial limit was exceeded';
  exception when sqlstate 'SW001' then
    raise notice 'PASS the trial product limit is still 5';
  end;

  -- 6. the trial runs out. Time passing, done the only way a test can.
  set local role none;
  update public.subscriptions
     set expires_at = now() - interval '1 day', started_at = now() - interval '31 days'
   where shop_id = v_shop;
  set local role authenticated;

  select * into v_state from public.subscription_state(v_shop);
  if v_state.can_publish then raise exception 'FAIL an expired trial may still publish'; end if;
  begin
    insert into public.products(shop_id, title, price, status)
      values(v_shop, 'After the trial', 1000, 'active');
    raise exception 'FAIL a product was posted after the trial ended';
  exception when sqlstate 'SW005' then
    raise notice 'PASS an expired trial blocks new products';
  end;

  -- and nothing was taken away
  select count(*) into v_count from public.products where shop_id = v_shop;
  if v_count <> app.trial_product_limit() then
    raise exception 'FAIL % products survive the expiry', v_count;
  end if;
  if (select bio from public.shops where id = v_shop) is null then
    raise exception 'FAIL the profile was cleared';
  end if;
  raise notice 'PASS an expired trial deletes nothing';

  -- 7. and it cannot be taken twice, even now that it is over
  begin
    perform public.start_trial(v_shop);
    raise exception 'FAIL the trial was restarted after it ended';
  exception when sqlstate 'SW004' then
    raise notice 'PASS a finished trial cannot be restarted';
  end;

  -- 8. nor by throwing the shop away and making another
  set local role none;
  delete from public.products where shop_id = v_shop;
  delete from public.shops where id = v_shop;
  set local role authenticated;
  insert into public.shops(id, owner_id, slug, name, whatsapp)
    values(v_second, v_seller, 'trial2-' || replace(v_second::text, '-', ''),
           'Second attempt', '+9647500000004');
  select * into v_state from public.subscription_state(v_second);
  if v_state.trial_available then raise exception 'FAIL a new shop restored the trial'; end if;
  begin
    perform public.start_trial(v_second);
    raise exception 'FAIL a new shop got a second trial';
  exception when sqlstate 'SW004' then
    raise notice 'PASS deleting the shop does not return the trial';
  end;

  -- 9. paying during a trial keeps the days that are left
  set local role none;
  update public.subscriptions
     set plan = 'trial', status = 'trialing', expires_at = now() + interval '20 days'
   where shop_id = v_second;
  select expires_at into v_expires from public.subscriptions where shop_id = v_second;
  -- As the service key, which is what a verified Wayl payment arrives as.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform public.admin_apply_payment(v_second, 'months_6', 55000, 'wayl', 'REF-TRIAL', 'test');
  set local role none;
  select expires_at into v_before from public.subscriptions where shop_id = v_second;
  if date_trunc('day', v_before) <> date_trunc('day', v_expires + interval '6 months') then
    raise exception 'FAIL paying during a trial moved the end to %, losing the remaining days', v_before;
  end if;
  raise notice 'PASS paying during a trial adds to the days already left';

  -- 10. one month, granted by an admin, through the audited path
  select user_id into v_admin from public.admins where is_active order by created_at limit 1;
  if v_admin is null then
    raise notice 'SKIP the admin grant checks: this database has no active admin';
  else
    set local role none;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select expires_at into v_expires from public.subscriptions where shop_id = v_second;
    perform public.admin_grant_plan(v_second, 'month_1', 'one month, on the house', gen_random_uuid());
    select expires_at into v_before from public.subscriptions where shop_id = v_second;
    if date_trunc('day', v_before) <> date_trunc('day', v_expires + interval '1 month') then
      raise exception 'FAIL a granted month ended at %', v_before;
    end if;
    select count(*) into v_count from public.payments
     where shop_id = v_second and plan = 'month_1' and method = 'manual_grant' and amount = 0;
    if v_count <> 1 then raise exception 'FAIL % granted months recorded', v_count; end if;
    raise notice 'PASS an admin can grant one month, recorded as a grant and not as a payment';

    -- and the seller cannot do it for themselves
    set local role none;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.admin_grant_plan(v_second, 'year_1', 'I would like a year', gen_random_uuid());
      raise exception 'FAIL a seller granted themselves a plan';
    exception when insufficient_privilege then
      raise notice 'PASS a seller cannot grant themselves anything';
    end;
  end if;

  set local role none;
  raise notice 'ALL TRIAL DATABASE CHECKS PASSED';
end;
$$;
rollback;
