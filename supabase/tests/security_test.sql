-- ============================================================
-- Shop Web — RLS security test
--
-- Creates seller A and seller B, then, acting as seller A, attempts
-- six things that MUST fail:
--   1. read seller B's hidden products
--   2. edit seller B's product
--   3. insert a product under seller B's shop
--   4. make itself an admin
--   5. extend its own subscription expiry
--   6. attach images to seller B's product
--
-- "Fail" means either a permission error OR zero rows affected with the
-- data provably unchanged — both are a correct denial, so the test
-- verifies the data afterwards rather than trusting the error alone.
--
-- Run it in the Supabase SQL editor, or:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/security_test.sql
--
-- It cleans up after itself. Safe to run repeatedly.
-- ============================================================

create or replace function pg_temp.shop_web_security_test()
returns table (
  n         int,
  test      text,
  expected  text,
  outcome   text,
  passed    boolean
)
language plpgsql
as $fn$
declare
  a_user  uuid := '11111111-1111-4111-8111-111111111111';
  b_user  uuid := '22222222-2222-4222-8222-222222222222';
  a_shop  uuid;
  b_shop  uuid;
  b_prod  uuid;   -- seller B, status = hidden
  cat     uuid;
  v_rows  int;
  v_text  text;
  v_ts    timestamptz;
  v_before timestamptz;
  v_result text;
  v_ok    boolean;
begin
  -- ---------- clean slate ----------
  delete from auth.users where id in (a_user, b_user);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values
    ('00000000-0000-0000-0000-000000000000', a_user, 'authenticated', 'authenticated',
     'sectest-a@shop-web.test', extensions.crypt('never-used', extensions.gen_salt('bf')),
     now(), now(), now(), '{"provider":"email"}'::jsonb, '{"full_name":"Seller A"}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', b_user, 'authenticated', 'authenticated',
     'sectest-b@shop-web.test', extensions.crypt('never-used', extensions.gen_salt('bf')),
     now(), now(), now(), '{"provider":"email"}'::jsonb, '{"full_name":"Seller B"}'::jsonb);

  select id into cat from public.platform_categories order by sort_order limit 1;

  insert into public.shops (owner_id, slug, name, whatsapp)
  values (a_user, 'sectest-a', 'Seller A', '+9647500000001')
  returning id into a_shop;

  insert into public.shops (owner_id, slug, name, whatsapp)
  values (b_user, 'sectest-b', 'Seller B', '+9647500000002')
  returning id into b_shop;

  insert into public.products (shop_id, platform_category_id, title, description, price, status)
  values (b_shop, cat, 'B secret product', 'hidden from everyone but B', 25000, 'hidden')
  returning id into b_prod;

  -- =========================================================
  -- Everything below runs as seller A.
  -- =========================================================

  -- ---------- 1. read seller B's hidden products ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);

    select count(*) into v_rows
    from public.products
    where shop_id = b_shop and status = 'hidden';

    v_ok := (v_rows = 0);
    v_result := format('returned %s row(s)', v_rows);
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  n := 1; test := 'seller A reads seller B hidden products';
  expected := 'denied'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 2. edit seller B's product ----------
  select title into v_text from public.products where id = b_prod;
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);

    update public.products set title = 'HACKED BY A', price = 1 where id = b_prod;
    get diagnostics v_rows = row_count;
    v_result := format('updated %s row(s)', v_rows);
    v_ok := (v_rows = 0);
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  -- prove the row really is untouched
  perform 1 from public.products where id = b_prod and title = v_text and price = 25000;
  if not found then
    v_ok := false;
    v_result := v_result || ' — DATA CHANGED';
  end if;
  n := 2; test := 'seller A edits seller B product';
  expected := 'denied'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 3. insert a product under seller B's shop ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);

    insert into public.products (shop_id, platform_category_id, title, description, price)
    values (b_shop, cat, 'planted by A', 'should never exist', 999);
    v_ok := false;
    v_result := 'INSERT SUCCEEDED';
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  if exists (select 1 from public.products where shop_id = b_shop and title = 'planted by A') then
    v_ok := false;
    v_result := v_result || ' — ROW EXISTS';
  end if;
  n := 3; test := 'seller A inserts product under seller B shop';
  expected := 'denied'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 4. make itself an admin ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);

    insert into public.admins (user_id, role) values (a_user, 'superadmin');
    v_ok := false;
    v_result := 'INSERT SUCCEEDED';
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  if exists (select 1 from public.admins where user_id = a_user) then
    v_ok := false;
    v_result := v_result || ' — IS NOW ADMIN';
  end if;
  n := 4; test := 'seller A makes itself an admin';
  expected := 'denied'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 5. extend its own subscription expiry ----------
  select expires_at into v_before from public.subscriptions where shop_id = a_shop;
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);

    update public.subscriptions
       set expires_at = now() + interval '10 years',
           plan = 'year_1',
           status = 'active'
     where shop_id = a_shop;
    get diagnostics v_rows = row_count;
    v_result := format('updated %s row(s)', v_rows);
    v_ok := (v_rows = 0);
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  select expires_at into v_ts from public.subscriptions where shop_id = a_shop;
  if v_ts is distinct from v_before then
    v_ok := false;
    v_result := v_result || ' — EXPIRY CHANGED';
  end if;
  n := 5; test := 'seller A extends its own expiry';
  expected := 'denied'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- 6. attach images to seller B's product ----------
  begin
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims',
      json_build_object('sub', a_user, 'role', 'authenticated')::text, false);

    perform public.save_product_images(b_prod, jsonb_build_array(jsonb_build_object(
      'card', 'products/' || b_shop || '/' || b_prod || '/x-card.webp',
      'full', 'products/' || b_shop || '/' || b_prod || '/x-full.webp')));
    v_ok := false;
    v_result := 'SUCCEEDED';
  exception when others then
    v_ok := true;
    v_result := format('%s (%s)', sqlerrm, sqlstate);
  end;
  perform set_config('role', 'none', false);
  if exists (select 1 from public.product_images where product_id = b_prod) then
    v_ok := false;
    v_result := v_result || ' — ROWS EXIST';
  end if;
  n := 6; test := 'seller A attaches images to seller B product';
  expected := 'denied'; outcome := v_result; passed := v_ok;
  return next;

  -- ---------- cleanup ----------
  perform set_config('request.jwt.claims', '', false);
  delete from auth.users where id in (a_user, b_user);
  return;

exception when others then
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', '', false);
  delete from auth.users where id in (a_user, b_user);
  raise;
end;
$fn$;

select * from pg_temp.shop_web_security_test();
