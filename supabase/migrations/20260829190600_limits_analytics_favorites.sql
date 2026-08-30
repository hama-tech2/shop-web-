-- ============================================================
-- Shop Web — 0007: hard limits, daily_views, favorites
-- ============================================================

-- ------------------------------------------------------------
-- Limit 1: max 10 images per product. Database enforced.
-- ------------------------------------------------------------
create or replace function app.enforce_image_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if tg_op = 'UPDATE' and new.product_id = old.product_id then
    return new;
  end if;

  select count(*) into v_count
  from public.product_images
  where product_id = new.product_id;

  if v_count >= 10 then
    raise exception 'product % already has 10 images (maximum)', new.product_id
      using errcode = '23514', hint = 'delete an image before adding another';
  end if;

  return new;
end;
$$;

create trigger product_images_limit_10
  before insert or update of product_id on public.product_images
  for each row execute function app.enforce_image_limit();

-- ------------------------------------------------------------
-- Limit 2: max 1000 products per shop. Database enforced.
-- ------------------------------------------------------------
create or replace function app.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if tg_op = 'UPDATE' and new.shop_id = old.shop_id then
    return new;
  end if;

  select count(*) into v_count
  from public.products
  where shop_id = new.shop_id;

  if v_count >= 1000 then
    raise exception 'shop % already has 1000 products (maximum)', new.shop_id
      using errcode = '23514', hint = 'archive or delete a product before adding another';
  end if;

  return new;
end;
$$;

create trigger products_limit_1000
  before insert or update of shop_id on public.products
  for each row execute function app.enforce_product_limit();

-- ------------------------------------------------------------
-- daily_views — one counter row per shop / product / day.
-- Never written directly by users; only through record_view().
-- ------------------------------------------------------------
create table public.daily_views (
  id          bigint generated always as identity primary key,
  shop_id     uuid not null references public.shops (id) on delete cascade,
  product_id  uuid references public.products (id) on delete cascade,
  day         date not null default current_date,
  views       int  not null default 0 check (views >= 0),
  constraint daily_views_unique unique nulls not distinct (shop_id, product_id, day)
);

comment on table public.daily_views is
  'Aggregated view counts. product_id null = a shop profile view. Written only by public.record_view().';

create or replace function public.record_view(
  p_shop uuid default null,
  p_product uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop uuid := p_shop;
begin
  if p_product is not null then
    -- only count views of content the public can actually see
    if not app.product_is_public(p_product) then
      return;
    end if;
    select shop_id into v_shop from public.products where id = p_product;
  else
    if v_shop is null or not app.shop_is_public(v_shop) then
      return;
    end if;
  end if;

  insert into public.daily_views (shop_id, product_id, day, views)
  values (v_shop, p_product, current_date, 1)
  on conflict (shop_id, product_id, day)
    do update set views = public.daily_views.views + 1;
end;
$$;

comment on function public.record_view(uuid, uuid) is
  'Increments a view counter. Safe for anon: ignores anything not publicly visible.';

revoke all on function public.record_view(uuid, uuid) from public;
grant execute on function public.record_view(uuid, uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- favorites — a signed-in customer's saved products.
-- ------------------------------------------------------------
create table public.favorites (
  user_id     uuid not null references auth.users (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);

comment on table public.favorites is 'Per-user saved products. A user only ever sees their own rows.';
