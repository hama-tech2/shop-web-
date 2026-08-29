-- ============================================================
-- Shop Web — 0010: seed the global category list
-- products.platform_category_id is NOT NULL, so the taxonomy has to
-- exist before any product can be created.
-- ============================================================

insert into public.platform_categories (slug, name_ckb, name_en, sort_order) values
  ('women-clothing',  'جل و بەرگی ژنانە',        'Women''s clothing',   10),
  ('men-clothing',    'جل و بەرگی پیاوانە',      'Men''s clothing',     20),
  ('kids',            'منداڵان',                  'Kids',                30),
  ('shoes-bags',      'پێڵاو و جانتا',            'Shoes & bags',        40),
  ('beauty',          'جوانکاری و بۆنوبەرام',     'Beauty & fragrance',  50),
  ('accessories',     'ئێکسسوار',                 'Accessories',         60),
  ('electronics',     'ئەلیکترۆنی',               'Electronics',         70),
  ('mobile',          'مۆبایل و ئامێر',           'Mobile & devices',    80),
  ('home',            'کەلوپەلی ماڵەوە',          'Home',                90),
  ('kitchen',         'چێشتخانە',                 'Kitchen',            100),
  ('furniture',       'مۆبیلیا',                  'Furniture',          110),
  ('food',            'خواردن و شیرینی',          'Food & sweets',      120),
  ('baby',            'کەلوپەلی ساوا',            'Baby',               130),
  ('sports',          'وەرزش',                    'Sports',             140),
  ('books',           'کتێب و نووسین',            'Books & stationery', 150),
  ('handmade',        'دەستکرد',                  'Handmade',           160),
  ('cars',            'ئۆتۆمبێل و پێداویستی',     'Cars & parts',       170),
  ('services',        'خزمەتگوزاری',              'Services',           180),
  ('other',           'هیتر',                     'Other',              999)
on conflict (slug) do nothing;
