-- ============================================================
-- Shop Web — 0014: slug availability
--
-- The onboarding wizard checks a slug as the seller types. That needs
-- an answer the anon role can get without being able to read the shops
-- table, so it goes through a SECURITY DEFINER function.
--
-- The reserved list moves into ONE immutable function that both the
-- CHECK constraint and the availability check call, so the two can
-- never drift apart.
-- ============================================================

create or replace function app.slug_is_reserved(p_slug text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select lower(coalesce(p_slug, '')) in (
    'admin', 'api', 'login', 'signup', 'img', 'app', 'www', 'shop', 'store',
    'search', 'saved', 'help', 'support', 'about', 'terms', 'privacy',
    'sitemap', 'robots', 'assets', 'static', 'cdn', 'null', 'undefined',
    -- added with the auth routes in session 3
    'logout', 'onboarding', 'auth', 'forgot', 'reset', 'account', 'settings',
    'styles', 'js', 'seed', 'favicon'
  );
$$;

revoke all on function app.slug_is_reserved(text) from public;
grant execute on function app.slug_is_reserved(text) to anon, authenticated, service_role;

-- Swap the hard-coded list for the shared function.
alter table public.shops drop constraint shops_slug_not_reserved;
alter table public.shops
  add constraint shops_slug_not_reserved check (not app.slug_is_reserved(slug));

-- ------------------------------------------------------------
-- The live check. Returns a reason so the UI can say WHY.
-- Leaks only whether a slug is taken, which the public profile
-- URL already reveals.
-- ------------------------------------------------------------
create or replace function public.slug_available(p_slug text)
returns table (available boolean, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_slug is null or btrim(p_slug) = '' then
    return query select false, 'empty'; return;
  end if;
  if p_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$' then
    return query select false, 'format'; return;
  end if;
  if app.slug_is_reserved(p_slug) then
    return query select false, 'reserved'; return;
  end if;
  if exists (select 1 from public.shops s where lower(s.slug) = lower(p_slug)) then
    return query select false, 'taken'; return;
  end if;
  return query select true, 'ok';
end;
$$;

revoke all on function public.slug_available(text) from public;
grant execute on function public.slug_available(text) to anon, authenticated, service_role;
