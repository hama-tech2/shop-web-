-- ============================================================
-- Close the unused direct report-insert surface
--
-- There is currently no public report form or Worker route, but the
-- original grants let any holder of the public Supabase key insert an
-- unlimited number of rows directly into public.reports. RLS verified
-- the target; it did not limit write volume. Keep admin read/update/
-- delete access unchanged and remove only the unused insert privilege.
-- ============================================================

revoke insert on table public.reports from anon, authenticated;

comment on table public.reports is
  'Abuse reports. Direct public inserts are disabled until a rate-limited Worker endpoint is intentionally introduced; admins retain existing review permissions.';
