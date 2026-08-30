-- ============================================================
-- Shop Web — 0003: shops, platform_categories, categories
-- ============================================================

create table public.shops (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null unique references auth.users (id) on delete cascade,
  slug          text not null unique,
  name          text not null,
  bio           text,
  whatsapp      text not null,
  city          text not null default 'erbil',
  address       text,
  -- R2 object keys only. Never full URLs.
  logo_key      text,
  cover_key     text,
  -- Seller-facing status is admin-controlled (see the column guard trigger).
  status        text not null default 'active'
                  check (status in ('active', 'suspended', 'banned')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint shops_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  constraint shops_name_len    check (char_length(btrim(name)) between 2 and 80),
  constraint shops_bio_len     check (bio is null or char_length(bio) <= 1000),
  constraint shops_whatsapp_fmt check (whatsapp ~ '^\+?[0-9]{7,20}$'),
  constraint shops_logo_key_fmt  check (logo_key  is null or logo_key  !~* '^https?://'),
  constraint shops_cover_key_fmt check (cover_key is null or cover_key !~* '^https?://')
);

comment on table public.shops is 'One shop per seller (owner_id is unique). status is admin-only.';
comment on column public.shops.logo_key is 'R2 object key, e.g. shops/<shop_id>/logo/<uuid>.webp — never a URL.';

create trigger shops_touch_updated_at
  before update on public.shops
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------
-- platform_categories — the global taxonomy, admin-managed.
-- ------------------------------------------------------------
create table public.platform_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name_ckb    text not null,
  name_ar     text,
  name_en     text,
  icon        text,
  sort_order  int  not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint platform_categories_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$')
);

comment on table public.platform_categories is 'Global category list shown across the platform. Admin write only.';

-- ------------------------------------------------------------
-- categories — a seller''s own grouping inside their shop.
-- ------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_name_len check (char_length(btrim(name)) between 1 and 60),
  constraint categories_unique_per_shop unique (shop_id, name)
);

comment on table public.categories is 'Seller-defined categories, scoped to one shop.';

create trigger categories_touch_updated_at
  before update on public.categories
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------
-- Ownership helper.
-- ------------------------------------------------------------
create or replace function app.owns_shop(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.shops s
    where s.id = p_shop and s.owner_id = auth.uid()
  );
$$;

revoke all on function app.owns_shop(uuid) from public;
grant execute on function app.owns_shop(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Column guard: a seller may edit their shop, but never its
-- ownership or its status. Only an admin can.
-- ------------------------------------------------------------
-- Deliberately NOT security definer: it must see the *real* caller so
-- that service_role / postgres maintenance is not blocked.
create or replace function app.guard_shop_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or app.is_admin() then
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'shops.owner_id is admin-only' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    raise exception 'shops.status is admin-only' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'shops.id is immutable' using errcode = '42501';
  end if;

  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger shops_guard_columns
  before update on public.shops
  for each row execute function app.guard_shop_columns();
