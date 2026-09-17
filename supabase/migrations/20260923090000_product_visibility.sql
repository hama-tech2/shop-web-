-- ============================================================
-- Shop Web — a product is shown to everyone, or only on the shop.
--
-- A seller wants some products on their own profile without pushing
-- them into the marketplace feed: a variation, a size, a thing they
-- sell but do not want to advertise. Until now the only lever was
-- `status`, and hiding a product took it off the profile too.
--
-- This is a SECOND, INDEPENDENT axis. It does not touch `status`:
--   status     active / hidden / archived   — does this product exist
--                                             publicly at all
--   visibility everyone / profile           — and if it does, is it in
--                                             the feed as well as on
--                                             the shop page
--
-- Why a separate column rather than a fourth `status`:
--
--   * `app.enforce_free_product_limit` counts `status = 'active'`. A
--     profile-only product is still active, so it still counts toward
--     the Free plan's five, with no change to that trigger at all — a
--     seller cannot use this to hold six public products. A fourth
--     status value would have needed that trigger rewritten, and the
--     rewrite is exactly where a plan limit gets broken by accident.
--   * Every RLS policy keys off `status = 'active'`. Profile-only rows
--     stay active, so they stay readable by anon — the direct product
--     URL keeps working and the row is still public data. Nothing about
--     who may read what changes here.
--   * hidden and archived behave exactly as they did.
--
-- Existing rows become 'everyone', which is what they have always been.
-- NOT NULL DEFAULT does that in one pass with no backfill to get wrong,
-- and on PG11+ it rewrites nothing.
-- ============================================================

alter table public.products
  add column visibility text not null default 'everyone';

-- The allowed values, at the database, so a bug in the Worker cannot
-- write a third state that the feed would then have to guess about.
-- Named, so a violation says what it was.
alter table public.products
  add constraint products_visibility_allowed
    check (visibility in ('everyone', 'profile'));

-- The feed asks for active + everyone on every page load, ordered by
-- created_at. This is that query.
create index if not exists products_feed_visible_idx
  on public.products (created_at desc)
  where status = 'active' and visibility = 'everyone';

comment on column public.products.visibility is
  'everyone = marketplace feed and the shop page; profile = the shop page '
  'and the direct link only. Independent of status: a profile-only product '
  'is still active, still public, and still counts toward the Free limit.';
