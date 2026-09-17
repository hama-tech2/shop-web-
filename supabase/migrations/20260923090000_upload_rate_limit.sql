-- ============================================================
-- Authenticated upload abuse limit
--
-- Uses the existing race-safe, service-only app.take_rate_token()
-- table and advisory lock. The Worker supplies the authenticated shop
-- id; no client-provided id is trusted. This migration is intentionally
-- not applied by the application or by tests.
-- ============================================================

create or replace function public.rate_limit_upload(p_key text)
returns boolean
language sql
security definer
set search_path = app, public, pg_temp
as $$
  select app.take_rate_token(
    'upload', p_key,
    12, interval '1 minute',
    100, interval '1 day'
  );
$$;

revoke all on function public.rate_limit_upload(text)
  from public, anon, authenticated;
grant execute on function public.rate_limit_upload(text)
  to service_role;

comment on function public.rate_limit_upload(text) is
  'True if an authenticated shop may start another R2 upload: 12 per minute and 100 per day. Called only by the Worker with its service credential after session and shop ownership checks.';
