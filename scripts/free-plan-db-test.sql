-- Run against the migrated database. Every fixture rolls back.
--
-- The rule being pinned: Free is a plan, not a countdown. Five products
-- in the account at once, one image each, a slot back when one is
-- deleted, and none of it expiring. Paying lifts both limits; a paid
-- plan running out falls back here rather than falling off.
begin;
do $$
declare
  v_seller  uuid := gen_random_uuid();
  v_shop    uuid := gen_random_uuid();
  v_state   record;
  v_product uuid;
  v_count   int;
  v_slug    text := 'free-' || replace(v_shop::text, '-', '');
begin
  insert into auth.users(id, email, aud, role)
    values(v_seller, 'free-rollback-' || v_seller || '@example.invalid', 'authenticated', 'authenticated');
  insert into public.shops(id, owner_id, slug, name, whatsapp)
    values(v_shop, v_seller, v_slug, 'Free rollback test', '+9647500000005');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. a new shop is on Free, and Free is public
  select * into v_state from public.subscription_state(v_shop);
  if v_state.plan <> 'free' or v_state.status <> 'free' then
    raise exception 'FAIL a new shop is on % / %', v_state.plan, v_state.status;
  end if;
  if v_state.tier <> 'free' then raise exception 'FAIL tier is %', v_state.tier; end if;
  if not v_state.can_publish then raise exception 'FAIL a new Free shop cannot publish'; end if;
  if v_state.slots_left <> 5 then raise exception 'FAIL % slots on a new shop', v_state.slots_left; end if;
  if not v_state.publicly_visible then raise exception 'FAIL a Free shop is not public'; end if;
  raise notice 'PASS a new shop is on Free, public, with five slots';

  -- 2. zero to four, then the fifth
  for i in 1..4 loop
    insert into public.products(shop_id, title, price, status)
      values(v_shop, 'Free product ' || i, 1000, 'active');
    select * into v_state from public.subscription_state(v_shop);
    if not v_state.can_publish then raise exception 'FAIL blocked at % products', i; end if;
    if v_state.slots_left <> 5 - i then
      raise exception 'FAIL % slots after % products', v_state.slots_left, i;
    end if;
  end loop;
  raise notice 'PASS a Free shop with four products may still post';

  insert into public.products(id, shop_id, title, price, status)
    values(gen_random_uuid(), v_shop, 'The fifth', 1000, 'active')
    returning id into v_product;
  select * into v_state from public.subscription_state(v_shop);
  if v_state.can_publish or v_state.slots_left <> 0 then
    raise exception 'FAIL after five: publish=% slots=%', v_state.can_publish, v_state.slots_left;
  end if;
  raise notice 'PASS the fifth product is allowed, and fills the plan';

  -- 3. the sixth is refused by the database
  begin
    insert into public.products(shop_id, title, price, status)
      values(v_shop, 'The sixth', 1000, 'active');
    raise exception 'FAIL a sixth product was created on Free';
  exception when sqlstate 'SW001' then
    raise notice 'PASS the sixth product is refused';
  end;

  -- 4. deleting one gives the slot back
  delete from public.products where id = v_product;
  select * into v_state from public.subscription_state(v_shop);
  if not v_state.can_publish or v_state.slots_left <> 1 then
    raise exception 'FAIL after deleting: publish=% slots=%', v_state.can_publish, v_state.slots_left;
  end if;
  insert into public.products(id, shop_id, title, price, status)
    values(gen_random_uuid(), v_shop, 'The replacement', 1000, 'active')
    returning id into v_product;
  raise notice 'PASS deleting one product returns one slot';

  -- 5. a hidden product still occupies its slot
  update public.products set status = 'hidden' where id = v_product;
  select * into v_state from public.subscription_state(v_shop);
  if v_state.can_publish or v_state.slots_left <> 0 then
    raise exception 'FAIL hiding a product freed a slot';
  end if;
  raise notice 'PASS hiding a product does not free a slot';

  -- 6. one image on a Free product
  insert into public.product_images(product_id, shop_id, r2_key, position)
    values(v_product, v_shop, 'products/' || v_shop || '/one.webp', 1);
  raise notice 'PASS a Free product takes its one image';

  begin
    insert into public.product_images(product_id, shop_id, r2_key, position)
      values(v_product, v_shop, 'products/' || v_shop || '/two.webp', 2);
    raise exception 'FAIL a second image was added on Free';
  exception when check_violation then
    raise notice 'PASS a second image is refused on Free';
  end;

  -- and through the gallery save, which is how the app writes them
  begin
    perform public.save_product_images(v_product, jsonb_build_array(
      jsonb_build_object('card', 'products/' || v_shop || '/a.webp', 'full', 'products/' || v_shop || '/a-full.webp'),
      jsonb_build_object('card', 'products/' || v_shop || '/b.webp', 'full', 'products/' || v_shop || '/b-full.webp')));
    raise exception 'FAIL save_product_images accepted two images on Free';
  exception when check_violation then
    raise notice 'PASS save_product_images holds the Free image limit too';
  end;

  -- 7. paying lifts both limits
  set local role none;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform public.admin_apply_payment(v_shop, 'year_1', 90000, 'wayl', 'REF-FREE', 'test');
  set local role none;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into v_state from public.subscription_state(v_shop);
  if v_state.tier <> 'paid' then raise exception 'FAIL tier after paying is %', v_state.tier; end if;
  if not v_state.can_publish then raise exception 'FAIL a paid shop cannot publish'; end if;
  if v_state.slots_left is not null then
    raise exception 'FAIL a paid shop reports % slots', v_state.slots_left;
  end if;
  raise notice 'PASS paying lifts the product limit';

  insert into public.products(shop_id, title, price, status)
    values(v_shop, 'A sixth, now paid for', 1000, 'active');
  insert into public.product_images(product_id, shop_id, r2_key, position)
    values(v_product, v_shop, 'products/' || v_shop || '/paid-two.webp', 2);
  raise notice 'PASS a paid shop passes both the sixth product and the second image';

  -- 8. a paid plan that runs out falls back to Free, losing nothing
  set local role none;
  update public.subscriptions
     set expires_at = now() - interval '10 days'
   where shop_id = v_shop;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform public.expire_lapsed_subscriptions();
  set local role none;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into v_state from public.subscription_state(v_shop);
  if v_state.tier <> 'free' or v_state.status <> 'free' then
    raise exception 'FAIL a lapsed plan became % / %', v_state.tier, v_state.status;
  end if;
  select count(*) into v_count from public.products where shop_id = v_shop;
  if v_count <> 6 then raise exception 'FAIL % products survived the lapse', v_count; end if;
  select count(*) into v_count from public.product_images where product_id = v_product;
  if v_count <> 2 then raise exception 'FAIL % images survived the lapse', v_count; end if;
  if v_state.can_publish then
    raise exception 'FAIL a lapsed shop over the Free limit may still post';
  end if;
  raise notice 'PASS a lapsed plan falls back to Free, keeping every product and image';

  -- what it may not do is grow
  begin
    insert into public.products(shop_id, title, price, status)
      values(v_shop, 'A seventh, after lapsing', 1000, 'active');
    raise exception 'FAIL a lapsed shop over the limit created another product';
  exception when sqlstate 'SW001' then
    raise notice 'PASS a lapsed shop over the Free limit cannot add more';
  end;

  -- 9. suspension outranks the plan
  set local role none;
  update public.subscriptions set status = 'suspended' where shop_id = v_shop;
  set local role authenticated;
  begin
    insert into public.products(shop_id, title, price, status)
      values(v_shop, 'While suspended', 1000, 'active');
    raise exception 'FAIL a suspended shop created a product';
  exception when sqlstate 'SW005' then
    raise notice 'PASS a suspended shop cannot post at all';
  end;

  -- 10. the trial is gone
  set local role none;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'start_trial') then
    raise exception 'FAIL public.start_trial still exists';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'app' and p.proname in ('trial_days', 'trial_product_limit')) then
    raise exception 'FAIL app.trial_days or app.trial_product_limit still exists';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'trial_grants') then
    raise exception 'FAIL trial_grants was dropped; it is history worth keeping';
  end if;
  raise notice 'PASS the trial functions are gone and its history is kept';

  raise notice 'ALL FREE PLAN DATABASE CHECKS PASSED';
end;
$$;
rollback;
