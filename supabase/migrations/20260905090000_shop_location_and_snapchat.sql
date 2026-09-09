-- ============================================================
-- Shop Web — 0023: shop location and Snapchat
--
-- Both were rendered as disabled inputs with "not available yet".
-- There was nowhere to put either value: `shops` had no column for a
-- map link and none for Snapchat. This adds both, with the same shape
-- of CHECK the other social handles already carry.
--
-- maps_url is the one field a seller pastes as a whole URL rather than
-- a handle, so it is the one that needs a scheme guard: https only.
-- That rejects javascript:, data: and vbscript: outright, and plain
-- http:// too — a map link is never worth a mixed-content warning on
-- the page a customer opens from TikTok.
-- ============================================================

alter table public.shops
  add column if not exists maps_url text,
  add column if not exists snapchat text;

-- The length bound is a separate char_length rather than a regex
-- repetition count: Postgres caps those at 255, and {3,500} makes the
-- expression fail at evaluation time, not at creation — the constraint
-- looks fine until the first write tries to use it.
alter table public.shops
  drop constraint if exists shops_maps_url_fmt,
  add constraint shops_maps_url_fmt
    check (
      maps_url is null
      or (char_length(maps_url) between 12 and 500
          and maps_url ~ '^https://[^\s<>"]+$')
    );

alter table public.shops
  drop constraint if exists shops_snapchat_fmt,
  add constraint shops_snapchat_fmt
    check (snapchat is null or snapchat ~ '^[A-Za-z0-9._-]{1,40}$');

comment on column public.shops.maps_url is
  'Google Maps link the seller pastes. https only — the CHECK is what stops javascript: and data:.';
comment on column public.shops.snapchat is
  'Snapchat username, handle only, no @.';

-- ------------------------------------------------------------
-- The public profile RPC has to return them, or the shop page
-- cannot render the location button or the Snapchat link.
--
-- Everything else about this function is unchanged: still SECURITY
-- DEFINER so a lapsed shop keeps its header, still returning nothing
-- for a suspended or banned shop, still never exposing the expiry.
-- ------------------------------------------------------------
-- The return type gains two columns, which CREATE OR REPLACE cannot do.
drop function if exists public.shop_public_profile(text);

create function public.shop_public_profile(p_slug text)
returns table (
  id uuid, slug text, name text, bio text, city text,
  whatsapp text, phone text,
  instagram text, tiktok text, facebook text, snapchat text,
  maps_url text,
  logo_key text, cover_key text,
  products_visible boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.id, s.slug, s.name, s.bio, s.city,
    s.whatsapp, s.phone,
    s.instagram, s.tiktok, s.facebook, s.snapchat,
    s.maps_url,
    s.logo_key, s.cover_key,
    app.subscription_visible(sub.status, sub.expires_at, sub.grace_days)
  from public.shops s
  join public.subscriptions sub on sub.shop_id = s.id
  where lower(s.slug) = lower(p_slug)
    and s.status = 'active';
$$;

revoke all on function public.shop_public_profile(text) from public;
grant execute on function public.shop_public_profile(text) to anon, authenticated, service_role;
