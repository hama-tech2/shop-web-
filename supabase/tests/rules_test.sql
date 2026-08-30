-- ============================================================
-- Shop Web — business-rule test (subscription maths + hard limits)
--
-- Proves, against the real database:
--   * a new shop gets a 1 month free trial
--   * paying during the trial adds 2 bonus months
--   * a product can be posted without a category
--   * day 1 after expiry (grace) is still public
--   * day 4 after expiry is hidden, and nothing is deleted
--   * max 10 images per product   (trigger, not frontend)
--   * max 1000 products per shop  (trigger, not frontend)
--   * deleting a product queues its R2 keys into deleted_objects
--
-- Cleans up after itself. Safe to run repeatedly.
--   psql "$SUPABASE_DB_URL" -f supabase/tests/rules_test.sql
-- ============================================================

create or replace function pg_temp.shop_web_rules_test()
returns table (check_name text, result text, ok boolean)
language plpgsql
as $fn$
declare
  u   uuid := '33333333-3333-4333-8333-333333333333';
  adm uuid := '44444444-4444-4444-8444-444444444444';
  s uuid; p uuid; cat uuid; i int;
  v_exp timestamptz; v_bonus int; v_cnt int; v_err text;
begin
  delete from public.payments where shop_id in (select id from public.shops where owner_id = u);
  delete from auth.users where id in (u, adm);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
          'rules@shop-web.test', extensions.crypt('x', extensions.gen_salt('bf')),
          now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
         ('00000000-0000-0000-0000-000000000000', adm, 'authenticated', 'authenticated',
          'rules-admin@shop-web.test', extensions.crypt('x', extensions.gen_salt('bf')),
          now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  insert into public.admins (user_id, role) values (adm, 'superadmin');
  select id into cat from public.platform_categories order by sort_order limit 1;

  insert into public.shops (owner_id, slug, name, whatsapp)
  values (u, 'rules-shop', 'Rules', '+9647500000003')
  returning id into s;

  -- ---------- 1 month free trial ----------
  select expires_at into v_exp from public.subscriptions where shop_id = s;
  check_name := 'new shop gets 1 month trial';
  result := format('plan=%s, expires in %s days',
                   (select plan from public.subscriptions where shop_id = s),
                   round(extract(epoch from v_exp - now()) / 86400));
  ok := (v_exp between now() + interval '29 days' and now() + interval '32 days');
  return next;

  -- ---------- paying during the trial => +2 months ----------
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated')::text, false);
  perform public.admin_apply_payment(s, 'months_6', 50000, 'fib', 'REF1', null);
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', '', false);

  select sub.expires_at, pay.bonus_months into v_exp, v_bonus
  from public.subscriptions sub
  join public.payments pay on pay.shop_id = sub.shop_id
  where sub.shop_id = s;
  check_name := 'paying during trial adds 2 bonus months';
  result := format('bonus_months=%s, expires in %s days',
                   v_bonus, round(extract(epoch from v_exp - now()) / 86400));
  ok := (v_bonus = 2 and v_exp > now() + interval '235 days');
  return next;

  -- ---------- a category is optional ----------
  begin
    insert into public.products (shop_id, title, description, price)
    values (s, 'no category', 'posted without picking a category', 5000);
    v_err := 'accepted';
  exception when others then
    v_err := sqlerrm;
  end;
  check_name := 'a product can be posted without a category';
  result := v_err;
  ok := (v_err = 'accepted');
  return next;

  -- ---------- 10 images per product ----------
  insert into public.products (shop_id, platform_category_id, title, description, price)
  values (s, cat, 'image limit', 'desc', 100) returning id into p;

  for i in 1..10 loop
    insert into public.product_images (product_id, shop_id, r2_key, position)
    values (p, s, 'products/' || s || '/' || p || '/' || i || '.webp', i);
  end loop;

  begin
    insert into public.product_images (product_id, shop_id, r2_key, position)
    values (p, s, 'products/' || s || '/' || p || '/overflow.webp', 10);
    v_err := 'NO ERROR';
  exception when others then
    v_err := sqlerrm;
  end;
  select count(*) into v_cnt from public.product_images where product_id = p;
  check_name := 'max 10 images per product';
  result := format('%s stored, 11th rejected: %s', v_cnt, v_err);
  ok := (v_cnt = 10 and v_err <> 'NO ERROR');
  return next;

  -- ---------- deleting a product queues its R2 keys ----------
  delete from public.products where id = p;
  select count(*) into v_cnt
  from public.deleted_objects where shop_id = s and processed_at is null;
  check_name := 'deleting a product queues its R2 keys';
  result := format('%s key(s) queued in deleted_objects', v_cnt);
  ok := (v_cnt = 10);
  return next;

  -- ---------- 1000 products per shop ----------
  -- the 'no category' row above already counts, so top up to exactly 1000
  insert into public.products (shop_id, platform_category_id, title, description, price)
  select s, cat, 'bulk ' || g, 'desc', 1000 from generate_series(1, 999) g;

  begin
    insert into public.products (shop_id, platform_category_id, title, description, price)
    values (s, cat, 'product 1001', 'desc', 1);
    v_err := 'NO ERROR';
  exception when others then
    v_err := sqlerrm;
  end;
  select count(*) into v_cnt from public.products where shop_id = s;
  check_name := 'max 1000 products per shop';
  result := format('%s stored, 1001st rejected: %s', v_cnt, v_err);
  ok := (v_cnt = 1000 and v_err <> 'NO ERROR');
  return next;

  -- ---------- expiry, grace, and "nothing is deleted" ----------
  update public.subscriptions set expires_at = now() - interval '1 day' where shop_id = s;
  check_name := 'day 1 after expiry (in grace) still public';
  result := app.shop_is_public(s)::text;
  ok := app.shop_is_public(s);
  return next;

  update public.subscriptions set expires_at = now() - interval '4 days' where shop_id = s;
  check_name := 'day 4 after expiry (grace over) hidden from public';
  result := app.shop_is_public(s)::text;
  ok := not app.shop_is_public(s);
  return next;

  select count(*) into v_cnt from public.products where shop_id = s;
  check_name := 'nothing is deleted after expiry';
  result := format('%s product(s) still stored', v_cnt);
  ok := (v_cnt = 1000);
  return next;

  -- ---------- cleanup ----------
  delete from public.deleted_objects where shop_id = s;
  delete from public.payments where shop_id = s;
  delete from auth.users where id in (u, adm);
  return;

exception when others then
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', '', false);
  delete from public.payments where shop_id in (select id from public.shops where owner_id = u);
  delete from public.deleted_objects
   where shop_id in (select id from public.shops where owner_id = u);
  delete from auth.users where id in (u, adm);
  raise;
end;
$fn$;

select * from pg_temp.shop_web_rules_test();
