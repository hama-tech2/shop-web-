-- ============================================================
-- Shop Web — 0017: what the public shop page needs
--
--   * social handles and a call number on shops
--   * a way to read a shop's HEADER even when its subscription has
--     lapsed. RLS hides an expired shop from anon entirely, which is
--     right for products but wrong for the page itself: the seller's
--     link must keep working, showing contact buttons and a quiet
--     notice instead of a 404.
-- ============================================================

alter table public.shops
  add column phone     text,
  add column instagram text,
  add column tiktok    text,
  add column facebook  text;

-- Handles, not URLs — the page builds the link, so a seller cannot
-- paste something that sends their customers somewhere else.
alter table public.shops
  add constraint shops_phone_fmt     check (phone     is null or phone ~ '^\+?[0-9]{7,20}$'),
  add constraint shops_instagram_fmt check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,40}$'),
  add constraint shops_tiktok_fmt    check (tiktok    is null or tiktok    ~ '^[A-Za-z0-9._]{1,40}$'),
  add constraint shops_facebook_fmt  check (facebook  is null or facebook  ~ '^[A-Za-z0-9._-]{1,60}$');

comment on column public.shops.instagram is 'Handle only, no URL. The page builds the link.';
comment on column public.shops.phone is 'Optional call number. The WhatsApp number is used if this is null.';

-- ------------------------------------------------------------
-- The public header.
--
-- SECURITY DEFINER so it can see a shop whose subscription has lapsed,
-- but it deliberately returns nothing for a shop an admin has suspended
-- or banned, and it never returns the expiry date — the visitor has no
-- business knowing when a seller's subscription runs out.
-- ------------------------------------------------------------
create or replace function public.shop_public_profile(p_slug text)
returns table (
  id               uuid,
  slug             text,
  name             text,
  bio              text,
  city             text,
  whatsapp         text,
  phone            text,
  instagram        text,
  tiktok           text,
  facebook         text,
  logo_key         text,
  cover_key        text,
  products_visible boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.slug, s.name, s.bio, s.city,
         s.whatsapp, s.phone, s.instagram, s.tiktok, s.facebook,
         s.logo_key, s.cover_key,
         app.subscription_visible(sub.status, sub.expires_at, sub.grace_days)
  from public.shops s
  join public.subscriptions sub on sub.shop_id = s.id
  where lower(s.slug) = lower(p_slug)
    and s.status = 'active';
$$;

revoke all on function public.shop_public_profile(text) from public;
grant execute on function public.shop_public_profile(text) to anon, authenticated, service_role;
