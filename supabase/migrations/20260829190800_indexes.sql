-- ============================================================
-- Shop Web — 0009: indexes
-- ============================================================

-- Shop slug: the public profile link (/@slug) — the hottest lookup.
-- The unique constraint already covers it; this one is for the
-- case-insensitive lookup the router actually performs.
create unique index shops_slug_lower_idx on public.shops (lower(slug));
create index shops_owner_idx  on public.shops (owner_id);
create index shops_status_idx on public.shops (status) where status = 'active';

-- Products by shop (the seller dashboard and the public shop page).
create index products_shop_idx
  on public.products (shop_id, status, sort_order, created_at desc);

create index products_shop_active_idx
  on public.products (shop_id, created_at desc)
  where status = 'active';

-- Products by category, both taxonomies.
create index products_platform_category_idx
  on public.products (platform_category_id, created_at desc)
  where status = 'active';

create index products_category_idx
  on public.products (category_id, sort_order)
  where category_id is not null;

create index products_price_idx on public.products (price) where status = 'active';

-- Sorani text search: full-text over the normalised vector, plus
-- trigrams so partial words and typos in Arabic script still match.
create index products_search_tsv_idx
  on public.products using gin (search_tsv);

create index products_title_trgm_idx
  on public.products using gin (title_norm extensions.gin_trgm_ops);

-- Images, categories, money, analytics.
create index product_images_product_idx on public.product_images (product_id, position);
create index product_images_shop_idx    on public.product_images (shop_id);

create index categories_shop_idx on public.categories (shop_id, sort_order);

create index platform_categories_active_idx
  on public.platform_categories (sort_order) where is_active;

create index subscriptions_expiry_idx on public.subscriptions (expires_at, status);

create index payments_shop_idx on public.payments (shop_id, paid_at desc);

create index audit_log_shop_idx  on public.audit_log (shop_id, created_at desc);
create index audit_log_table_idx on public.audit_log (table_name, created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

create index reports_status_idx on public.reports (status, created_at desc);
create index reports_product_idx on public.reports (product_id);

create index daily_views_shop_day_idx on public.daily_views (shop_id, day desc);
create index daily_views_product_idx  on public.daily_views (product_id, day desc)
  where product_id is not null;

create index favorites_product_idx on public.favorites (product_id);

-- ------------------------------------------------------------
-- Public search entry point. Normalises the query the same way the
-- index normalises the data, so ک/ك and ی/ي/ى all match.
-- Runs as the caller, so RLS still applies — anon only ever gets
-- active products of active, non-expired shops.
-- ------------------------------------------------------------
create or replace function public.search_products(
  p_query text,
  p_shop uuid default null,
  p_platform_category uuid default null,
  p_limit int default 30,
  p_offset int default 0
) returns setof public.products
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select p.*
  from public.products p
  where (p_shop is null or p.shop_id = p_shop)
    and (p_platform_category is null or p.platform_category_id = p_platform_category)
    and (
      coalesce(btrim(p_query), '') = ''
      or p.search_tsv @@ plainto_tsquery('simple', app.ku_normalize(p_query))
      or p.title_norm % app.ku_normalize(p_query)
      or p.title_norm like '%' || app.ku_normalize(p_query) || '%'
    )
  order by
    case when coalesce(btrim(p_query), '') = '' then 0
         else ts_rank(p.search_tsv, plainto_tsquery('simple', app.ku_normalize(p_query))) end desc,
    p.created_at desc
  limit least(coalesce(p_limit, 30), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_products(text, uuid, uuid, int, int) from public;
grant execute on function public.search_products(text, uuid, uuid, int, int)
  to anon, authenticated, service_role;
