-- ============================================================
-- Shop Web — 0013
--   * An R2 key must live under the prefix of the row that owns it.
--     Without this a seller can point their own image row at another
--     shop's object, and deleting their row would queue someone
--     else's file for deletion.
--   * Reserved slugs: names the router needs for itself.
-- ============================================================

-- ------------------------------------------------------------
-- R2 key prefixes. `..` is banned outright so nothing can climb
-- back out of its own prefix.
-- ------------------------------------------------------------
alter table public.product_images
  add constraint product_images_key_prefix check (
    r2_key like 'products/' || shop_id::text || '/%'
    and r2_key not like '%..%'
  );

alter table public.shops
  add constraint shops_logo_key_prefix check (
    logo_key is null
    or (logo_key like 'shops/' || id::text || '/%' and logo_key not like '%..%')
  );

alter table public.shops
  add constraint shops_cover_key_prefix check (
    cover_key is null
    or (cover_key like 'shops/' || id::text || '/%' and cover_key not like '%..%')
  );

comment on column public.product_images.r2_key is
  'R2 object key. Must be products/<shop_id>/<product_id>/<name> — enforced by CHECK.';
comment on column public.shops.logo_key is
  'R2 object key. Must be shops/<shop_id>/<name> — enforced by CHECK. Never a URL.';

-- ------------------------------------------------------------
-- Reserved slugs. The public profile lives at /@slug, but these
-- names are wanted by the router, the asset paths, or are just
-- traps (null, undefined).
-- ------------------------------------------------------------
alter table public.shops
  add constraint shops_slug_not_reserved check (
    slug not in (
      'admin', 'api', 'login', 'signup', 'img', 'app', 'www', 'shop', 'store',
      'search', 'saved', 'help', 'support', 'about', 'terms', 'privacy',
      'sitemap', 'robots', 'assets', 'static', 'cdn', 'null', 'undefined'
    )
  );
