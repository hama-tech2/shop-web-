-- ============================================================
-- Shop Web — remove the development seed data.
--
-- NOT A MIGRATION. Run once, by hand, before real sellers arrive:
--   psql "$SUPABASE_DB_URL" -f supabase/remove_seed_data.sql
--
-- ------------------------------------------------------------
-- How the rows were identified as fake
-- ------------------------------------------------------------
-- supabase/seed.sql creates four sellers with fixed UUIDs and
-- @shop-web.test email addresses, and hangs four shops off them. This
-- script selects by those four email addresses and follows the foreign
-- keys — it never guesses from a name, a slug or a date, so a real shop
-- cannot be caught by it even if a seller picks the same name.
--
--   seed-scent@shop-web.test    -> HEWLÊR SCENT       /@hewler-scent
--   seed-nafin@shop-web.test    -> بۆتیکی نافین        /@nafin-boutique
--   seed-hazar@shop-web.test    -> ماڵی هەزار          /@mall-hazar
--   seed-shirini@shop-web.test  -> شیرینی خانەی دایک   /@shirini-dayk
--
-- ------------------------------------------------------------
-- Rows this deletes (measured 2026-09-04)
-- ------------------------------------------------------------
--   auth.users        4      the four seed sellers
--   profiles          4      cascade from auth.users
--   shops             4      cascade from auth.users
--   products          8      cascade from shops
--   product_images   11      cascade from shops
--   subscriptions     4      cascade from shops
--   daily_views       3      cascade from shops
--   categories        0
--   payments          0
--   payment_intents   0
--   shop_notes        0
--   favorites         0
--                 ------
--   TOTAL            42 rows
--
-- ------------------------------------------------------------
-- What it deliberately does NOT touch
-- ------------------------------------------------------------
-- * The two real people who signed up on the live site on 2026-09-02:
--     kararahand@gmail.com   (email signup, never signed in)
--     charmy759@gmail.com    (Google, has signed in)
--   Neither owns a shop. Both are excluded by construction — the
--   script only ever selects the four @shop-web.test addresses — and
--   the guard below aborts if that stops being true.
--
-- * platform_categories (6 rows). Those are the real category list,
--   not seed data.
--
-- * deleted_objects. It holds 22 rows for two shops that no longer
--   exist; they are the R2 cleanup queue. Deleting them would strand
--   those objects in R2 for ever. The cron drains them.
--
-- * audit_log. It is an append-only record, and the deletes below add
--   to it rather than removing anything. See the optional block at the
--   bottom for the ~8,000 rows left by rules_test.sql.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Guard: refuse to run if the target set is not exactly the four
-- seed sellers. Better to abort than to delete a real account.
-- ------------------------------------------------------------
do $$
declare
  v_users int;
  v_shops int;
begin
  select count(*) into v_users from auth.users
   where email in ('seed-scent@shop-web.test','seed-nafin@shop-web.test',
                   'seed-hazar@shop-web.test','seed-shirini@shop-web.test');

  select count(*) into v_shops from public.shops
   where owner_id in (select id from auth.users
     where email in ('seed-scent@shop-web.test','seed-nafin@shop-web.test',
                     'seed-hazar@shop-web.test','seed-shirini@shop-web.test'));

  if v_users > 4 or v_shops > 4 then
    raise exception
      'refusing to run: expected at most 4 seed users and 4 seed shops, found % and %',
      v_users, v_shops;
  end if;

  raise notice 'deleting % seed seller(s) and % seed shop(s)', v_users, v_shops;
end $$;

-- ------------------------------------------------------------
-- The seed sellers, and everything hanging off them.
--
-- payments is ON DELETE RESTRICT from shops, so it goes first or the
-- cascade cannot complete. It is empty today; this is the belt.
-- Everything else — shops, products, product_images, subscriptions,
-- categories, daily_views, payment_intents, shop_notes, favorites,
-- profiles — is ON DELETE CASCADE and follows from the users.
-- ------------------------------------------------------------
create temporary table seed_users on commit drop as
select id from auth.users
 where email in ('seed-scent@shop-web.test','seed-nafin@shop-web.test',
                 'seed-hazar@shop-web.test','seed-shirini@shop-web.test');

create temporary table seed_shops on commit drop as
select id from public.shops where owner_id in (select id from seed_users);

delete from public.payments where shop_id in (select id from seed_shops);

delete from auth.users where id in (select id from seed_users);

-- ------------------------------------------------------------
-- The deletes above fire the R2 queue triggers, which enqueue every
-- seed image key into deleted_objects. Those keys were never uploaded
-- — /img/<key> falls back to the bundled files in public/seed/ — so
-- there is nothing in R2 to remove and the cron would only churn.
-- ------------------------------------------------------------
delete from public.deleted_objects
 where shop_id in (select id from seed_shops)
    or r2_key like 'shops/11111111-aaaa-4aaa-8aaa-%'
    or r2_key like 'products/11111111-aaaa-4aaa-8aaa-%';

-- ------------------------------------------------------------
-- Prove it. Every count must be zero.
-- ------------------------------------------------------------
do $$
declare v_left int;
begin
  -- The four addresses by name, not a @shop-web.test wildcard: a
  -- stranded row from security_test.sql shares that domain and would
  -- fail this check for the wrong reason.
  select (select count(*) from auth.users
           where email in ('seed-scent@shop-web.test','seed-nafin@shop-web.test',
                           'seed-hazar@shop-web.test','seed-shirini@shop-web.test'))
       + (select count(*) from public.shops
           where id::text like '11111111-aaaa-4aaa-8aaa-%')
       + (select count(*) from public.products
           where shop_id::text like '11111111-aaaa-4aaa-8aaa-%')
    into v_left;

  if v_left <> 0 then
    raise exception 'seed data still present after delete: % row(s)', v_left;
  end if;
  raise notice 'seed data removed; no seed users, shops or products remain';
end $$;

commit;

-- ============================================================
-- OPTIONAL — not part of the above, run separately if you want it.
--
-- rules_test.sql exercises the 1000-product limit, so it inserts and
-- deletes 1000 products per run. Four of those runs left ~8,000 rows
-- in audit_log for shops that no longer exist. They are harmless
-- history, but they will drown a real audit trail.
--
-- Read it first:
--
--   select count(*) from public.audit_log a
--    where a.table_name = 'products'
--      and not exists (select 1 from public.shops s where s.id = a.shop_id);
--
-- Then, only if that number looks right to you:
--
--   delete from public.audit_log a
--    where a.table_name = 'products'
--      and not exists (select 1 from public.shops s where s.id = a.shop_id);
-- ============================================================
