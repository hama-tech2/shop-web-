-- ============================================================
-- Shop Web — 0008: Row Level Security. Default deny, everywhere.
--
-- Shape of the rules:
--   anon           -> only active products of active, non-expired shops
--   authenticated  -> that, plus full access to their OWN shop's rows
--   admins         -> everything, via the separate admins table
--   deleted_objects-> service_role only (no grants, no policies)
-- ============================================================

-- ------------------------------------------------------------
-- Step 1: strip the blanket grants, then re-grant deliberately.
-- RLS decides rows; grants decide whether the verb exists at all.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'admins', 'shops', 'platform_categories', 'categories',
    'products', 'product_images', 'subscriptions', 'payments',
    'audit_log', 'reports', 'deleted_objects', 'daily_views', 'favorites'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

-- read-only for the public side
grant select on public.shops, public.platform_categories, public.categories,
                public.products, public.product_images
  to anon, authenticated;

-- seller-owned data
grant select, insert, update, delete on public.shops, public.categories,
                                        public.products, public.product_images,
                                        public.favorites
  to authenticated;

-- read-only for the owner / admin
grant select on public.profiles, public.admins, public.subscriptions,
                public.payments, public.daily_views, public.audit_log
  to authenticated;
grant insert, update on public.profiles to authenticated;

-- admins manage these through the same role, gated by policy
grant insert, update, delete on public.platform_categories, public.subscriptions,
                                 public.payments, public.reports
  to authenticated;

-- abuse reports may be filed by anyone, read by nobody but admins
grant insert on public.reports to anon;

-- deleted_objects: no grants at all. service_role only.

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or app.is_admin());

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ------------------------------------------------------------
-- admins — read only, and NO write policy for any user role.
-- This is what stops a seller from making itself an admin.
-- ------------------------------------------------------------
create policy admins_select_self_or_admin on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_admin());

-- (intentionally no insert / update / delete policy)

-- ------------------------------------------------------------
-- shops
-- ------------------------------------------------------------
create policy shops_select_public on public.shops
  for select to anon
  using (app.shop_is_public(id));

create policy shops_select_auth on public.shops
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or app.shop_is_public(id)
    or app.is_admin()
  );

create policy shops_insert_own on public.shops
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and status = 'active');

create policy shops_update_own on public.shops
  for update to authenticated
  using (owner_id = (select auth.uid()) or app.is_admin())
  with check (owner_id = (select auth.uid()) or app.is_admin());

create policy shops_delete_admin on public.shops
  for delete to authenticated
  using (app.is_admin());

-- ------------------------------------------------------------
-- platform_categories
-- ------------------------------------------------------------
create policy platform_categories_select_active on public.platform_categories
  for select to anon, authenticated
  using (is_active or app.is_admin());

create policy platform_categories_write_admin on public.platform_categories
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ------------------------------------------------------------
-- categories (seller's own)
-- ------------------------------------------------------------
create policy categories_select_public on public.categories
  for select to anon
  using (app.shop_is_public(shop_id));

create policy categories_select_auth on public.categories
  for select to authenticated
  using (app.owns_shop(shop_id) or app.shop_is_public(shop_id) or app.is_admin());

create policy categories_insert_own on public.categories
  for insert to authenticated
  with check (app.owns_shop(shop_id) or app.is_admin());

create policy categories_update_own on public.categories
  for update to authenticated
  using (app.owns_shop(shop_id) or app.is_admin())
  with check (app.owns_shop(shop_id) or app.is_admin());

create policy categories_delete_own on public.categories
  for delete to authenticated
  using (app.owns_shop(shop_id) or app.is_admin());

-- ------------------------------------------------------------
-- products
-- Public sees ONLY active products of active, non-expired shops.
-- ------------------------------------------------------------
create policy products_select_public on public.products
  for select to anon
  using (status = 'active' and app.shop_is_public(shop_id));

create policy products_select_auth on public.products
  for select to authenticated
  using (
    app.owns_shop(shop_id)
    or (status = 'active' and app.shop_is_public(shop_id))
    or app.is_admin()
  );

create policy products_insert_own on public.products
  for insert to authenticated
  with check (app.owns_shop(shop_id) or app.is_admin());

create policy products_update_own on public.products
  for update to authenticated
  using (app.owns_shop(shop_id) or app.is_admin())
  with check (app.owns_shop(shop_id) or app.is_admin());

create policy products_delete_own on public.products
  for delete to authenticated
  using (app.owns_shop(shop_id) or app.is_admin());

-- ------------------------------------------------------------
-- product_images
-- ------------------------------------------------------------
create policy product_images_select_public on public.product_images
  for select to anon
  using (app.product_is_public(product_id));

create policy product_images_select_auth on public.product_images
  for select to authenticated
  using (
    app.owns_shop(shop_id)
    or app.product_is_public(product_id)
    or app.is_admin()
  );

create policy product_images_insert_own on public.product_images
  for insert to authenticated
  with check (app.owns_shop(shop_id) or app.is_admin());

create policy product_images_update_own on public.product_images
  for update to authenticated
  using (app.owns_shop(shop_id) or app.is_admin())
  with check (app.owns_shop(shop_id) or app.is_admin());

create policy product_images_delete_own on public.product_images
  for delete to authenticated
  using (app.owns_shop(shop_id) or app.is_admin());

-- ------------------------------------------------------------
-- subscriptions — sellers READ their own, and nothing more.
-- No seller insert / update / delete policy exists, so a seller
-- can never change their plan, expiry or status.
-- ------------------------------------------------------------
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (app.owns_shop(shop_id) or app.is_admin());

create policy subscriptions_write_admin on public.subscriptions
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ------------------------------------------------------------
-- payments — same shape.
-- ------------------------------------------------------------
create policy payments_select_own on public.payments
  for select to authenticated
  using (app.owns_shop(shop_id) or app.is_admin());

create policy payments_write_admin on public.payments
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ------------------------------------------------------------
-- audit_log — admin read only, no writes from any user role.
-- ------------------------------------------------------------
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (app.is_admin());

-- ------------------------------------------------------------
-- reports — file-and-forget for the public, admin-managed after.
-- ------------------------------------------------------------
create policy reports_insert_public on public.reports
  for insert to anon, authenticated
  with check (
    (product_id is not null and app.product_is_public(product_id))
    or (product_id is null and shop_id is not null and app.shop_is_public(shop_id))
  );

create policy reports_select_admin on public.reports
  for select to authenticated
  using (app.is_admin());

create policy reports_update_admin on public.reports
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

create policy reports_delete_admin on public.reports
  for delete to authenticated
  using (app.is_admin());

-- ------------------------------------------------------------
-- daily_views — the shop owner reads its own numbers.
-- Writes happen only inside public.record_view().
-- ------------------------------------------------------------
create policy daily_views_select_own on public.daily_views
  for select to authenticated
  using (app.owns_shop(shop_id) or app.is_admin());

-- ------------------------------------------------------------
-- favorites — strictly your own rows.
-- ------------------------------------------------------------
create policy favorites_select_own on public.favorites
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy favorites_insert_own on public.favorites
  for insert to authenticated
  with check (user_id = (select auth.uid()) and app.product_is_public(product_id));

create policy favorites_delete_own on public.favorites
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- deleted_objects — RLS on, zero policies, zero grants.
-- Only the service_role (the Worker's R2 cleanup job) can touch it.
-- ------------------------------------------------------------
-- (no policies by design)
