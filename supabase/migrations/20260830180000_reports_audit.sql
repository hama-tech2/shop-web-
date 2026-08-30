-- ============================================================
-- Shop Web — 0020: audit the reports queue
--
-- Every other table an admin writes to already carries the audit
-- trigger. `reports` did not, so hiding or dismissing a report left no
-- trace of who did it. Every admin action must be in audit_log.
-- ============================================================

create trigger reports_audit
  after insert or update or delete on public.reports
  for each row execute function app.write_audit();
