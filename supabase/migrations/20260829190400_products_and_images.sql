-- ============================================================
-- Shop Web — 0005: products, product_images
--
-- ONE price. No discount, no old_price. Ever.
-- ============================================================

create table public.products (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null references public.shops (id) on delete cascade,
  -- every product has a category: the global one is required,
  -- the seller's own grouping is optional
  platform_category_id  uuid not null references public.platform_categories (id) on delete restrict,
  category_id           uuid references public.categories (id) on delete set null,

  title                 text not null,
  description           text not null,
  price                 numeric(12, 2) not null check (price >= 0 and price <= 999999999),
  currency              text not null default 'IQD' check (currency in ('IQD', 'USD')),

  status                text not null default 'active'
                          check (status in ('active', 'hidden', 'archived')),

  sort_order            int not null default 100,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint products_title_len check (char_length(btrim(title)) between 2 and 200),
  constraint products_desc_len  check (char_length(btrim(description)) between 1 and 5000)
);

comment on table public.products is
  'Products. Exactly one price column — discounts / old_price are intentionally absent.';
comment on column public.products.status is
  'active = public, hidden = seller-only, archived = kept but out of the way. Nothing is hard deleted by expiry.';

-- Normalised Sorani search vector, maintained by the database.
alter table public.products
  add column search_tsv tsvector
  generated always as (
    setweight(app.ku_tsvector(title), 'A') ||
    setweight(app.ku_tsvector(coalesce(description, '')), 'B')
  ) stored;

alter table public.products
  add column title_norm text
  generated always as (app.ku_normalize(title)) stored;

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function app.touch_updated_at();

-- The seller's own category must belong to the same shop.
create or replace function app.check_category_same_shop()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.category_id is not null
     and not exists (
       select 1 from public.categories c
       where c.id = new.category_id and c.shop_id = new.shop_id
     ) then
    raise exception 'category % does not belong to shop %', new.category_id, new.shop_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger products_category_same_shop
  before insert or update of category_id, shop_id on public.products
  for each row execute function app.check_category_same_shop();

-- ------------------------------------------------------------
-- product_images — R2 object keys only, max 10 per product.
-- ------------------------------------------------------------
create table public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  shop_id     uuid not null references public.shops (id) on delete cascade,
  r2_key      text not null unique,
  position    int  not null default 1 check (position between 1 and 10),
  width       int  check (width  is null or width  > 0),
  height      int  check (height is null or height > 0),
  bytes       int  check (bytes  is null or bytes  > 0),
  content_type text default 'image/webp'
                 check (content_type is null or content_type in ('image/webp', 'image/jpeg', 'image/png')),
  created_at  timestamptz not null default now(),

  constraint product_images_key_not_url check (r2_key !~* '^https?://'),
  constraint product_images_key_len     check (char_length(r2_key) between 3 and 512),
  constraint product_images_unique_pos  unique (product_id, position)
);

comment on table public.product_images is
  'Up to 10 images per product, enforced by trigger. Stores R2 keys, never URLs.';
comment on column public.product_images.r2_key is
  'R2 object key, e.g. products/<shop_id>/<product_id>/<uuid>.webp';

-- Keep shop_id on images in sync with the parent product (denormalised
-- so RLS and the R2 delete queue never need a join).
create or replace function app.sync_image_shop_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop uuid;
begin
  select p.shop_id into v_shop from public.products p where p.id = new.product_id;
  if v_shop is null then
    raise exception 'product % does not exist', new.product_id using errcode = '23503';
  end if;
  new.shop_id := v_shop;
  return new;
end;
$$;

create trigger product_images_sync_shop
  before insert or update of product_id on public.product_images
  for each row execute function app.sync_image_shop_id();

-- Is this product visible to the anonymous public right now?
create or replace function app.product_is_public(p_product uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.products p
    where p.id = p_product
      and p.status = 'active'
      and app.shop_is_public(p.shop_id)
  );
$$;

revoke all on function app.product_is_public(uuid) from public;
grant execute on function app.product_is_public(uuid) to anon, authenticated, service_role;
