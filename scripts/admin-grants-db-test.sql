-- Run against the migrated database. Every fixture, grant and audit row rolls back.
-- Uses an existing active admin; never creates or grants another admin account.
begin;
do $$
declare
  v_admin uuid;
  v_seller uuid := gen_random_uuid();
  v_shop uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_intent uuid;
  v_request uuid;
  v_paid public.payments;
  v_grant public.payments;
  v_again public.payments;
  v_start timestamptz;
  v_paid_sub public.subscriptions;
  v_grant_sub public.subscriptions;
  v_plan text;
  v_days int;
begin
  select user_id into strict v_admin from public.admins where is_active order by created_at limit 1;
  insert into auth.users(id, email, aud, role)
    values(v_seller, 'grant-rollback-' || v_seller || '@example.invalid', 'authenticated', 'authenticated');
  insert into public.shops(id, owner_id, slug, name, whatsapp)
    values(v_shop, v_seller, 'grant-' || replace(v_shop::text, '-', ''), 'Grant rollback test', '+9647500000001');
  insert into public.products(id, shop_id, title, price, status)
    values(v_product, v_shop, 'Grant rollback product', 1000, 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_grant_plan(v_shop, 'months_6', 'not an admin', gen_random_uuid());
    raise exception 'FAIL: non-admin granted a plan';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payment_intents(shop_id, plan, amount, source, note)
      values(v_shop, 'months_6', 0, 'manual_grant', 'seller spoof');
    raise exception 'FAIL: seller inserted a manual grant';
  exception when insufficient_privilege then null;
  end;
  reset role;

  foreach v_plan in array array['months_6', 'year_1'] loop
    foreach v_days in array array[-10, 0, 40] loop
      v_start := now() + make_interval(days => v_days);
      update public.subscriptions set plan='trial', status='trialing', expires_at=v_start where shop_id=v_shop;
      v_intent := gen_random_uuid();
      insert into public.payment_intents(id, shop_id, plan, amount)
        values(v_intent, v_shop, v_plan, 0);
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_paid := public.admin_activate_intent(v_intent, 'paid rollback test');
      select * into strict v_paid_sub from public.subscriptions where shop_id=v_shop;
      reset role;
      update public.subscriptions set plan='trial', status='trialing', expires_at=v_start where shop_id=v_shop;
      if v_days = -10 and app.shop_is_public(v_shop) then raise exception 'FAIL: expired fixture visible'; end if;
      set local role authenticated;
      v_request := gen_random_uuid();
      v_grant := public.admin_grant_plan(v_shop, v_plan, '  first seller free  ', v_request);
      select * into strict v_grant_sub from public.subscriptions where shop_id=v_shop;
      if (v_paid_sub.plan, v_paid_sub.status, v_paid_sub.expires_at)
         is distinct from (v_grant_sub.plan, v_grant_sub.status, v_grant_sub.expires_at) then
        raise exception 'FAIL: paid/grant subscription mismatch for %, %', v_plan, v_days;
      end if;
      if not app.shop_is_public(v_shop) or not exists(select 1 from public.products where id=v_product) then
        raise exception 'FAIL: grant did not restore product visibility';
      end if;
      if v_grant.method <> 'manual_grant' or v_grant.amount <> 0
         or v_grant.note <> 'first seller free' or v_grant.recorded_by <> v_admin
         or v_grant.months_added <> v_paid.months_added or v_paid.method <> 'fib'
         or v_paid.amount <> app.plan_price(v_plan) then
        raise exception 'FAIL: payment/grant attribution';
      end if;
      v_again := public.admin_grant_plan(v_shop, v_plan, 'first seller free', v_request);
      if v_again.id <> v_grant.id or (select expires_at from public.subscriptions where shop_id=v_shop) <> v_grant_sub.expires_at then
        raise exception 'FAIL: duplicate request extended twice';
      end if;
      begin
        perform public.admin_grant_plan(v_shop, v_plan, 'changed reason', v_request);
        raise exception 'FAIL: changed request accepted';
      exception when invalid_parameter_value then null;
      end;
      reset role;
      if not exists(select 1 from public.audit_log where table_name='payments' and row_id=v_grant.id::text
          and actor_id=v_admin and new_data->>'method'='manual_grant') then
        raise exception 'FAIL: grant audit missing';
      end if;
    end loop;
  end loop;

  -- An existing real transfer survives a gift; it is never marked paid by the gift.
  v_intent := gen_random_uuid();
  insert into public.payment_intents(id, shop_id, plan, amount, status)
    values(v_intent, v_shop, 'months_6', 0, 'pending');
  set local role authenticated;
  perform public.admin_grant_plan(v_shop, 'months_6', 'independent gift', gen_random_uuid());
  if (select status from public.payment_intents where id=v_intent) <> 'pending' then
    raise exception 'FAIL: gift handled a real transfer';
  end if;
  begin
    perform public.admin_grant_plan(v_shop, 'months_6', '   ', gen_random_uuid());
    raise exception 'FAIL: blank reason accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_grant_plan(v_shop, 'trial', 'invalid plan', gen_random_uuid());
    raise exception 'FAIL: invalid plan accepted';
  exception when invalid_parameter_value then null;
  end;
  reset role;
  -- Existing service-role paid activation remains supported, without a new grant capability.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  v_paid := public.admin_activate_intent(v_intent, 'service paid rollback test');
  if v_paid.method <> 'fib' then raise exception 'FAIL: service paid activation changed'; end if;
  begin
    perform public.admin_grant_plan(v_shop, 'months_6', 'service grant forbidden', gen_random_uuid());
    raise exception 'FAIL: service role granted without human actor';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;
select 'PASS: database gates, 6 paid/grant equivalence scenarios, audit, retry, existing transfer and service paid activation' as result;
rollback;
