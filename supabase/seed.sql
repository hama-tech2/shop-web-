-- ============================================================
-- Shop Web — development seed: 4 fake shops, 8 fake products.
--
-- Fixed UUIDs, so re-running replaces the seed rather than duplicating
-- it. Every r2_key points at a bundled image in public/seed/ — the
-- Worker's /img/<key> route falls back to those files until real
-- uploads to R2 exist.
--
-- NOT part of the migrations. Run by hand:
--   psql "$SUPABASE_DB_URL" -f supabase/seed.sql
-- ============================================================

begin;

-- ---------- clean slate ----------
delete from public.payments where shop_id in (
  '11111111-aaaa-4aaa-8aaa-000000000001','11111111-aaaa-4aaa-8aaa-000000000002',
  '11111111-aaaa-4aaa-8aaa-000000000003','11111111-aaaa-4aaa-8aaa-000000000004');

delete from auth.users where id in (
  '11111111-bbbb-4bbb-8bbb-000000000001','11111111-bbbb-4bbb-8bbb-000000000002',
  '11111111-bbbb-4bbb-8bbb-000000000003','11111111-bbbb-4bbb-8bbb-000000000004');

delete from public.deleted_objects where shop_id in (
  '11111111-aaaa-4aaa-8aaa-000000000001','11111111-aaaa-4aaa-8aaa-000000000002',
  '11111111-aaaa-4aaa-8aaa-000000000003','11111111-aaaa-4aaa-8aaa-000000000004');

-- ---------- sellers ----------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, extensions.crypt('seed-only-never-used', extensions.gen_salt('bf')),
       now(), now(), now(), '{"provider":"email"}'::jsonb,
       jsonb_build_object('full_name', u.full_name)
from (values
  ('11111111-bbbb-4bbb-8bbb-000000000001'::uuid, 'seed-scent@shop-web.test',   'Hewlêr Scent'),
  ('11111111-bbbb-4bbb-8bbb-000000000002'::uuid, 'seed-nafin@shop-web.test',   'Nafin Boutique'),
  ('11111111-bbbb-4bbb-8bbb-000000000003'::uuid, 'seed-hazar@shop-web.test',   'Mall Hazar'),
  ('11111111-bbbb-4bbb-8bbb-000000000004'::uuid, 'seed-shirini@shop-web.test', 'Shirini Dayk')
) as u(id, email, full_name);

-- ---------- shops (each gets a 1 month trial from the shops trigger) ----------
-- cover_key points at the bundled public/seed/banner.jpg through the
-- /img fallback, so the shop page and its OG preview have a real banner.
insert into public.shops (id, owner_id, slug, name, bio, whatsapp, city,
                          cover_key, instagram, tiktok, facebook, phone) values
  ('11111111-aaaa-4aaa-8aaa-000000000001', '11111111-bbbb-4bbb-8bbb-000000000001',
   'hewler-scent', 'HEWLÊR SCENT', 'عەتری ئەسڵی بۆ ژنان و پیاوان. گەیاندن بۆ هەموو هەولێر.',
   '+9647510000001', 'erbil',
   'shops/11111111-aaaa-4aaa-8aaa-000000000001/banner.jpg', 'hewlerscent', 'hewlerscent', null, '+9647510000001'),
  ('11111111-aaaa-4aaa-8aaa-000000000002', '11111111-bbbb-4bbb-8bbb-000000000002',
   'nafin-boutique', 'بۆتیکی نافین', 'جل و بەرگ و چانتای ژنانە، هەڵبژاردەی تازە هەموو هەفتەیەک.',
   '+9647510000002', 'erbil',
   'shops/11111111-aaaa-4aaa-8aaa-000000000002/banner.jpg', 'nafinboutique', 'nafin.boutique', 'nafinboutique', null),
  ('11111111-aaaa-4aaa-8aaa-000000000003', '11111111-bbbb-4bbb-8bbb-000000000003',
   'mall-hazar', 'ماڵی هەزار', 'کەلوپەلی ماڵەوە و ئامێری بچووک بە نرخێکی گونجاو.',
   '+9647510000003', 'erbil',
   'shops/11111111-aaaa-4aaa-8aaa-000000000003/banner.jpg', 'mallhazar', null, null, null),
  ('11111111-aaaa-4aaa-8aaa-000000000004', '11111111-bbbb-4bbb-8bbb-000000000004',
   'shirini-dayk', 'شیرینی خانەی دایک', 'شیرینی ماڵەوەی تازە، ڕۆژانە دروستدەکرێت.',
   '+9647510000004', 'erbil',
   'shops/11111111-aaaa-4aaa-8aaa-000000000004/banner.jpg', 'shirinidayk', null, null, null);

-- ---------- products ----------
-- created_at is staggered so the feed's first page matches the mockup order.
insert into public.products (id, shop_id, platform_category_id, title, description, price, created_at)
select p.id, p.shop_id, (select id from public.platform_categories where slug = p.cat),
       p.title, p.description, p.price, now() - (p.age || ' minutes')::interval
from (values
  ('11111111-cccc-4ccc-8ccc-000000000001'::uuid, '11111111-aaaa-4aaa-8aaa-000000000002'::uuid,
   'clothing',    'کراسی کوردی سەوز',   'کراسێکی سووکی سەوز بۆ بۆنە و جەژن.',        35000, 1),
  ('11111111-cccc-4ccc-8ccc-000000000002'::uuid, '11111111-aaaa-4aaa-8aaa-000000000001'::uuid,
   'beauty',      'عەتری هەولێر',        'عەتری ژنانە – 100ml.',                       28000, 2),
  ('11111111-cccc-4ccc-8ccc-000000000003'::uuid, '11111111-aaaa-4aaa-8aaa-000000000003'::uuid,
   'home',        'سێتی گوڵدان و مۆم',   'سێتی ڕازاندنەوەی ماڵەوە، سێ پارچە.',        22000, 3),
  ('11111111-cccc-4ccc-8ccc-000000000004'::uuid, '11111111-aaaa-4aaa-8aaa-000000000003'::uuid,
   'electronics', 'هێدسێتی بلوتوس',      'دەنگێکی ڕوون و باتریی درێژخایەن.',           18500, 4),
  ('11111111-cccc-4ccc-8ccc-000000000005'::uuid, '11111111-aaaa-4aaa-8aaa-000000000004'::uuid,
   'food',        'بەقلاوای خانەوادە',   'بەقلاوای تازەی ماڵەوە بە فستق.',             16000, 5),
  ('11111111-cccc-4ccc-8ccc-000000000006'::uuid, '11111111-aaaa-4aaa-8aaa-000000000002'::uuid,
   'clothing',    'چانتای دەستی قاوەیی', 'چانتایەکی چەرمی بە کوالێتی باش.',            65000, 6),
  ('11111111-cccc-4ccc-8ccc-000000000007'::uuid, '11111111-aaaa-4aaa-8aaa-000000000001'::uuid,
   'beauty',      'عەتری یاسەمین',       'بۆنی یاسەمینی سروشتی – 100ml.',              26000, 7),
  ('11111111-cccc-4ccc-8ccc-000000000008'::uuid, '11111111-aaaa-4aaa-8aaa-000000000001'::uuid,
   'beauty',      'عەتری عوود',          'بۆنی عوودی خۆراوی – 100ml.',                 30000, 8)
) as p(id, shop_id, cat, title, description, price, age);

-- ---------- images ----------
-- Two products carry several images, so the feed's auto-slide has
-- something to slide; the rest are single-image and never slide.
insert into public.product_images (product_id, shop_id, r2_key, position, width, height, content_type)
select i.product_id, i.shop_id,
       'products/' || i.shop_id || '/' || i.product_id || '/' || i.file,
       i.position, 360, 450, 'image/jpeg'
from (values
  ('11111111-cccc-4ccc-8ccc-000000000001'::uuid, '11111111-aaaa-4aaa-8aaa-000000000002'::uuid, 'dress.jpg',   1),
  ('11111111-cccc-4ccc-8ccc-000000000002'::uuid, '11111111-aaaa-4aaa-8aaa-000000000001'::uuid, 'perfume.jpg', 1),
  ('11111111-cccc-4ccc-8ccc-000000000002'::uuid, '11111111-aaaa-4aaa-8aaa-000000000001'::uuid, 'jasmine.jpg', 2),
  ('11111111-cccc-4ccc-8ccc-000000000002'::uuid, '11111111-aaaa-4aaa-8aaa-000000000001'::uuid, 'oud.jpg',     3),
  ('11111111-cccc-4ccc-8ccc-000000000003'::uuid, '11111111-aaaa-4aaa-8aaa-000000000003'::uuid, 'home.jpg',    1),
  ('11111111-cccc-4ccc-8ccc-000000000004'::uuid, '11111111-aaaa-4aaa-8aaa-000000000003'::uuid, 'earbuds.jpg', 1),
  ('11111111-cccc-4ccc-8ccc-000000000005'::uuid, '11111111-aaaa-4aaa-8aaa-000000000004'::uuid, 'baklava.jpg', 1),
  ('11111111-cccc-4ccc-8ccc-000000000006'::uuid, '11111111-aaaa-4aaa-8aaa-000000000002'::uuid, 'bag.jpg',     1),
  ('11111111-cccc-4ccc-8ccc-000000000007'::uuid, '11111111-aaaa-4aaa-8aaa-000000000001'::uuid, 'jasmine.jpg', 1),
  ('11111111-cccc-4ccc-8ccc-000000000007'::uuid, '11111111-aaaa-4aaa-8aaa-000000000001'::uuid, 'perfume.jpg', 2),
  ('11111111-cccc-4ccc-8ccc-000000000008'::uuid, '11111111-aaaa-4aaa-8aaa-000000000001'::uuid, 'oud.jpg',     1)
) as i(product_id, shop_id, file, position);

commit;
