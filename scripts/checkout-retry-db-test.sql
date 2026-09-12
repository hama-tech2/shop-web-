-- Run against the migrated database. Every fixture rolls back.
--
-- The rule being pinned: a seller has ONE checkout attempt per plan,
-- and retrying it costs nothing. Tapping Pay again after Wayl failed
-- must reuse the same attempt, take a fresh reference, rotate the
-- webhook secret, and never count against the rate limit — because
-- nothing ever reached Wayl to be spent.
--
-- What must still hold: a manual transfer waiting on the owner blocks
-- a checkout, a usable link is handed back unchanged, and a shop making
-- real links in a loop is still stopped.
begin;
do $$
declare
  v_seller uuid := gen_random_uuid();
  v_shop   uuid := gen_random_uuid();
  v_slug   text := 'retry-' || replace(v_shop::text, '-', '');
  v_a      record;
  v_b      record;
  v_c      record;
  v_secret text;
  v_count  int;
  v_ref    text;
begin
  insert into auth.users(id, email, aud, role)
    values(v_seller, 'retry-' || v_seller || '@example.invalid', 'authenticated', 'authenticated');
  insert into public.shops(id, owner_id, slug, name, whatsapp)
    values(v_shop, v_seller, v_slug, 'Retry test', '+9647500000007');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. the first tap makes one attempt, priced by the database
  select * into v_a from public.wayl_start_intent(
    v_shop, 'year_1', 'BZ-RETRY-000001', 'test', repeat('a', 64));
  if v_a.reused then raise exception 'FAIL the first tap reported a reuse'; end if;
  if v_a.amount <> 72000 then
    raise exception 'FAIL the first attempt is priced %, not 72000', v_a.amount;
  end if;
  if v_a.checkout_url is not null then
    raise exception 'FAIL a fresh attempt already has a checkout url';
  end if;
  raise notice 'PASS the first tap makes one attempt at the database price';

  -- 2. Wayl failed: no link was attached. The seller taps again.
  select * into v_b from public.wayl_start_intent(
    v_shop, 'year_1', 'BZ-RETRY-000002', 'test', repeat('b', 64));
  if not v_b.reused then raise exception 'FAIL the retry did not reuse the attempt'; end if;
  if v_b.id <> v_a.id then
    raise exception 'FAIL the retry made a second attempt (% then %)', v_a.id, v_b.id;
  end if;
  raise notice 'PASS a retry after a failed link reuses the same attempt';

  -- The reference is fresh, because Wayl may already have seen the old
  -- one, and there is still exactly one row.
  if v_b.reference_id <> 'BZ-RETRY-000002' then
    raise exception 'FAIL the retry kept the old reference %', v_b.reference_id;
  end if;
  select count(*) into v_count from public.payment_intents
   where shop_id = v_shop and source = 'payment';
  if v_count <> 1 then raise exception 'FAIL % rows after two taps', v_count; end if;
  raise notice 'PASS the retry takes a fresh reference and adds no row';

  -- The secret the retry will sign with is the one stored for it.
  -- Read with the role dropped, because a seller may not read it at
  -- all — which is check 7 below.
  set local role none;
  select webhook_secret into v_secret
    from public.payment_intent_secrets where intent_id = v_b.id;
  set local role authenticated;
  if v_secret <> repeat('b', 64) then
    raise exception 'FAIL the stored secret was not rotated to the retry''s';
  end if;
  raise notice 'PASS the stored webhook secret is rotated to the retry';

  -- 3. ten more ordinary taps. This is what used to lock a seller out.
  for i in 3..12 loop
    select * into v_c from public.wayl_start_intent(
      v_shop, 'year_1', 'BZ-RETRY-' || lpad(i::text, 6, '0'), 'test', repeat('c', 64));
    if not v_c.reused or v_c.id <> v_a.id then
      raise exception 'FAIL tap % stopped reusing the attempt', i;
    end if;
  end loop;
  select count(*) into v_count from public.payment_intents
   where shop_id = v_shop and source = 'payment';
  if v_count <> 1 then raise exception 'FAIL % rows after twelve taps', v_count; end if;
  raise notice 'PASS twelve ordinary taps stay one attempt and never hit the rate limit';

  -- 4. Wayl finally answers. The link is attached and handed back.
  perform public.wayl_attach_link(v_a.id, 'link-1', 'CODE1', 'https://pay.thewayl.test/abc');
  select * into v_c from public.wayl_start_intent(
    v_shop, 'year_1', 'BZ-RETRY-000013', 'test', repeat('d', 64));
  if not v_c.reused or v_c.checkout_url <> 'https://pay.thewayl.test/abc' then
    raise exception 'FAIL a usable link was not handed back: %', v_c.checkout_url;
  end if;
  if v_c.reference_id <> 'BZ-RETRY-000012' then
    raise exception 'FAIL a usable link had its reference changed to %', v_c.reference_id;
  end if;
  raise notice 'PASS a usable link is handed back unchanged, reference and all';

  -- 5. the rate limit still stops real links being made in a loop
  set local role none;
  update public.payment_intents set status = 'cancelled' where shop_id = v_shop;
  for i in 1..6 loop
    insert into public.payment_intents
      (shop_id, plan, amount, source, reference_id, env, checkout_url, status, created_at)
    values (v_shop, 'year_1', 72000, 'payment', 'BZ-LINKED-' || lpad(i::text, 6, '0'),
            'test', 'https://pay.thewayl.test/' || i, 'cancelled', now());
  end loop;
  set local role authenticated;
  begin
    perform public.wayl_start_intent(
      v_shop, 'year_1', 'BZ-RETRY-000020', 'test', repeat('e', 64));
    raise exception 'FAIL six real links in ten minutes were not rate limited';
  exception when sqlstate 'SW002' then
    raise notice 'PASS six real links in ten minutes is still refused';
  end;

  -- 6. a manual transfer waiting on the owner still wins
  set local role none;
  delete from public.payment_intents where shop_id = v_shop;
  insert into public.payment_intents (shop_id, plan, amount, source, status)
    values (v_shop, 'months_6', 38000, 'payment', 'pending');
  set local role authenticated;
  begin
    perform public.wayl_start_intent(
      v_shop, 'months_6', 'BZ-RETRY-000030', 'test', repeat('f', 64));
    raise exception 'FAIL a checkout was started over a waiting transfer';
  exception when sqlstate 'SW003' then
    raise notice 'PASS a manual transfer waiting on the owner still blocks checkout';
  end;

  -- 7. the seller cannot read the webhook secret they just caused
  set local role none;
  delete from public.payment_intents where shop_id = v_shop;
  set local role authenticated;
  select * into v_a from public.wayl_start_intent(
    v_shop, 'year_1', 'BZ-RETRY-000040', 'test', repeat('g', 64));
  begin
    select webhook_secret into v_secret
      from public.payment_intent_secrets where intent_id = v_a.id;
    if v_secret is not null then
      raise exception 'FAIL a seller read their own webhook secret';
    end if;
    raise notice 'PASS a seller cannot read their own webhook secret';
  exception when insufficient_privilege then
    raise notice 'PASS a seller cannot read their own webhook secret';
  end;

  -- 8. the price is the database's, not the caller's
  if v_a.amount <> 72000 then
    raise exception 'FAIL the attempt is priced %, not 72000', v_a.amount;
  end if;
  select * into v_b from public.wayl_start_intent(
    v_shop, 'months_6', 'BZ-RETRY-000050', 'test', repeat('h', 64));
  if v_b.amount <> 38000 then
    raise exception 'FAIL six months is priced %, not 38000', v_b.amount;
  end if;
  raise notice 'PASS both plans are priced by the database';

  raise notice 'ALL CHECKOUT RETRY DATABASE CHECKS PASSED';
end;
$$;
rollback;
