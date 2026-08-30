-- ============================================================
-- Shop Web — 0016: audit_log.actor_id keeps its value
--
-- Two problems with the foreign key:
--
--  1. ON DELETE SET NULL erased the actor from history the moment the
--     user was deleted, which defeats the point of an audit log.
--  2. Deleting a user cascades into shops and products, whose audit
--     triggers then insert a row referencing the very user being
--     deleted — a foreign key violation that aborts the delete.
--
-- An audit log records what happened, not who still exists, so the
-- column keeps the raw uuid and drops the reference.
-- ============================================================

alter table public.audit_log drop constraint audit_log_actor_id_fkey;

comment on column public.audit_log.actor_id is
  'auth.users id of whoever made the change. Deliberately not a foreign key: the record outlives the account.';
