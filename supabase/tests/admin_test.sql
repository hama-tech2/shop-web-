-- ============================================================
-- Shop Web — admin, view counting and cron test
--
-- Creates one seller and one admin, then checks:
--   1. record_view counts once per token per day
--   2. record_view counts a different token again
--   3. record_view ignores a missing / short token
--   4. record_view ignores a shop that is not publicly visible
--   5. admin_shops returns nothing to a seller
--   6. admin_shops returns the shop to an admin
--   7. admin_stats returns nothing to a seller
--   8. admin_activate_intent is refused for a seller
--   9. admin_activate_intent moves the subscription and closes the
--      intent in one go, for an admin
--  10. a second activation of the same intent is refused
--  11. suspending a shop through the admin path writes to audit_log
--  12. shop_notes is invisible to the seller
--
-- Run it in the Supabase SQL editor, or:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/admin_test.sql
--
-- It cleans up after itself. Safe to run repeatedly.
-- ============================================================

create or replace function pg_temp.shop_web_admin_test()
returns table (
  n        int,
  test     text,
  expected text,
  outcome  text,
  passed   boolean
)
language plpgsql
as $fn$
declare
  s_user   uuid := '33333333-3333-4333-8333-333333333333';
  a_user   uuid := '44444444-4444-4444-8444-444444444444';
  s_shop   uuid;
  s_prod   uuid;
  cat      uuid;
  v_intent uuid;
  v_rows   int;
  v_views  int;
  v_status text;
  v_before timestamptz;
  v_after  timestamptz;
  v_result text;
  v_ok     boolean;
  tok_a    text := 'admintest-token-aaaaaaaaaaaa';
  tok_b    text := 'admintest-token-bbbbbbbbbbbb';
begin
  -- ---------- clean slate ----------
  delete from public.payments  where shop_id in (select id from public.shops where owner_id in (s_user, a_user));
  delete from auth.users where id in (s_user, a_user);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values
    ('00000000-0000-0000-0000-000000000000', s_user, 'authenticated', 'authenticated',
     'admintest-seller@shop-web.test', extensions.crypt('never-used', extensions.gen_salt('bf')),
     now(), now(), now(), '{"provider":"email"}'::jsonb, '{"full_name":"Admin Test Seller"}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', a_user, 'authenticated', 'authenticated',
     'admintest-admin@shop-web.test', extensions.crypt('never-used', extensions.gen_salt('bf')),
     now(), now(), now(), '{"provider":"email"}'::jsonb, '{"full_name":"Admin Test Admin"}'::jsonb);

  insert into public.admins (user_id, role) values (a_user, 'superadmin');

  select id into cat from public.platform_categories order by sort_order limit 1;

  insert into public.shops (owner_id, slug, name, whatsapp)
  values (s_user, 'admintest-shop', 'Admin Test Shop', '+9647500000003')
  returning id into s_shop;

  insert into public.products (shop_id, platform_category_id, title, price, status)
  values (s_shop, cat, 'Admin test product', 25000, 'active')
  returning id into s_prod;

  -- ---------- 1. same token, twice ----------
  perform public.record_view(s_shop, null, tok_a);
  perform public.record_view(s_shop, null, tok_a);
  select views into v_views from public.daily_views
   where shop_id = s_shop and product_id is null and day = current_date;
  v_ok := (v_views = 1);
  n := 1; test := 'record_view: same token twice';
  expected := '1 view'; outcome := format('%s view(s)', coalesce(v_views, 0)); passed := v_ok;
  return next;

  -- ---------- 2. a second token ----------
  perform public.record_view(s_shop, null, tok_b);
  select views into v_views from public.daily_views
   where shop_id = s_shop and product_id is null and day = current_date;
  v_ok := (v_views = 2);
  n := 2; test := 'record_view: a different token';
  expected := '2 views'; outcome := format('%s view(s)', coalesce(v_views, 0)); passed := v_ok;
  return next;

  -- ---------- 3. no token / short token ----------
  perform public.record_view(s_shop, null, null);
  perform public.record_view(s_shop, null, 'short');
  select views into v_views from public.daily_views
   where shop_id = s_shop and product_id is null and day = current_date;
  v_ok := (v_views = 2);
  n := 3; test := 'record_view: null and short tokens ignored';
  expected := 'still 2 views'; outcome := format('%s view(s)', coalesce(v_views, 0)); passed := v_ok;
  return next;

  -- ---------- 4. a suspended shop is not counted ----------
  update public.shops set status = 'suspended' where id = s_shop;
  perform public.record_view(s_shop, null, 'admintest-token-cccccccccccc');
  select views into v_views from public.daily_views
   where shop_id = s_shop and product_id is null and day = current_date;
  v_ok := (v_views = 2);
  n := 4; test := 'record_view: suspended shop not counted';
  expected := 'still 2 views'; outcome := format('%s view(s)', coalesce(v_views, 0)); passed := v_ok;
  return next;
  update public.shops set status = 'active' where id = s_shop;

  -- ---------- 5. admin_shops as the seller ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', s_user, 'role', 'authenticated')::text, false);
    select count(*) into v_rows from public.admin_shops(null, 'all', 100);
    v_ok := (v_rows = 0);
    v_result := format('returned %s row(s)', v_rows);
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  n := 5; test := 'seller calls admin_shops';
  expected := 'no rows'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 6. admin_shops as the admin ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);
    select count(*) into v_rows from public.admin_shops('admintest', 'all', 100);
    v_ok := (v_rows = 1);
    v_result := format('returned %s row(s)', v_rows);
  exception when others then
    v_ok := false;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  n := 6; test := 'admin searches admin_shops';
  expected := '1 row'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 7. admin_stats as the seller ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', s_user, 'role', 'authenticated')::text, false);
    select count(*) into v_rows from public.admin_stats();
    v_ok := (v_rows = 0);
    v_result := format('returned %s row(s)', v_rows);
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  n := 7; test := 'seller calls admin_stats';
  expected := 'no rows'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- an open intent to activate ----------
  insert into public.payment_intents (shop_id, plan, amount, status)
  values (s_shop, 'year_1', 90000, 'open')
  returning id into v_intent;

  select expires_at into v_before from public.subscriptions where shop_id = s_shop;

  -- ---------- 8. seller activates it ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', s_user, 'role', 'authenticated')::text, false);
    perform public.admin_activate_intent(v_intent, 'by the seller');
    v_ok := false;
    v_result := 'SUCCEEDED';
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  select status into v_status from public.payment_intents where id = v_intent;
  select expires_at into v_after from public.subscriptions where shop_id = s_shop;
  if v_status <> 'open' or v_after is distinct from v_before then
    v_ok := false;
    v_result := v_result || ' — STATE CHANGED';
  end if;
  n := 8; test := 'seller activates a payment intent';
  expected := 'denied'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 9. admin activates it ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);
    perform public.admin_activate_intent(v_intent, 'paid in cash');
    v_ok := true;
    v_result := 'ok';
  exception when others then
    v_ok := false;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  select status into v_status from public.payment_intents where id = v_intent;
  select expires_at into v_after from public.subscriptions where shop_id = s_shop;
  if v_status <> 'paid' then
    v_ok := false;
    v_result := v_result || format(' — intent is %s', v_status);
  end if;
  if v_after <= v_before then
    v_ok := false;
    v_result := v_result || ' — EXPIRY DID NOT MOVE';
  end if;
  if not exists (select 1 from public.payments where reference = v_intent::text) then
    v_ok := false;
    v_result := v_result || ' — NO PAYMENT ROW';
  end if;
  n := 9; test := 'admin activates a payment intent';
  expected := 'paid, expiry moved, payment written'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 10. activating the same intent twice ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);
    perform public.admin_activate_intent(v_intent, 'again');
    v_ok := false;
    v_result := 'SUCCEEDED';
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  n := 10; test := 'admin activates the same intent twice';
  expected := 'denied'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 11. suspending writes an audit row ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);
    update public.shops set status = 'suspended' where id = s_shop;
    insert into public.shop_notes (shop_id, note, updated_by)
    values (s_shop, 'suspended during the test', a_user)
    on conflict (shop_id) do update set note = excluded.note, updated_at = now();
    v_result := 'ok';
    v_ok := true;
  exception when others then
    v_ok := false;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  select count(*) into v_rows from public.audit_log
   where shop_id = s_shop and actor_id = a_user;
  if v_rows = 0 then
    v_ok := false;
    v_result := v_result || ' — NO AUDIT ROWS';
  end if;
  n := 11; test := 'admin suspend + note writes audit_log';
  expected := 'audit rows exist'; outcome := format('%s, %s audit row(s)', v_result, v_rows);
  passed := v_ok;
  return next;
  update public.shops set status = 'active' where id = s_shop;

  -- ---------- 12. the seller cannot read the note ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', s_user, 'role', 'authenticated')::text, false);
    select count(*) into v_rows from public.shop_notes where shop_id = s_shop;
    v_ok := (v_rows = 0);
    v_result := format('returned %s row(s)', v_rows);
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  n := 12; test := 'seller reads its own shop_notes';
  expected := 'no rows'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- cleanup ----------
  perform set_config('request.jwt.claims', '', false);
  delete from public.payments where shop_id = s_shop;
  delete from auth.users where id in (s_user, a_user);
  return;

exception when others then
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', '', false);
  delete from public.payments where shop_id in (select id from public.shops where owner_id in (s_user, a_user));
  delete from auth.users where id in (s_user, a_user);
  raise;
end;
$fn$;

select * from pg_temp.shop_web_admin_test();
