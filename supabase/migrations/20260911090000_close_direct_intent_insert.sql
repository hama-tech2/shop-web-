-- ============================================================
-- Shop Web — 0030: a payment intent is made by a function, or not at all
--
-- payment_intents has been writable by any signed-in seller for their
-- own shop since 0018, back when a seller pressing "pay" WAS the whole
-- flow. It is not any more: public.wayl_start_intent is where a
-- checkout is made, and it is the only place that enforces the things
-- that matter — the per-shop rate limit, one live intent per plan, the
-- reference, and the webhook secret that goes with it.
--
-- With the insert policy still open, a seller could go around all of
-- that with a direct PostgREST call: their own reference, no rate
-- limit, as many rows as they cared to make. None of it could activate
-- a plan — activation is service-key only and re-derives the price from
-- app.plan_price — but it is unbounded rows, unbounded Wayl lookups
-- from polling, and a queue the owner has to read.
--
-- So the seller's insert policy goes. Nothing else changes:
--
--   * wayl_start_intent is SECURITY DEFINER and never consulted RLS.
--   * admin_grant_plan is SECURITY INVOKER and keeps its own policy,
--     payment_intents_insert_manual_admin, which still requires a real
--     admin and source = 'manual_grant'.
--   * sellers still SELECT their own intents, which is what the plans
--     screen and the payment result page read.
--   * mark_intent_sent is an UPDATE through a definer function and is
--     untouched.
--
-- The retained manual transfer flow could file an intent through this
-- policy. It has no entry point in the app any more, and after this it
-- cannot file one at all; worker/routes/account.js says so rather than
-- attempting a write the database will refuse.
-- ============================================================

drop policy if exists payment_intents_insert_own on public.payment_intents;

comment on table public.payment_intents is
  'A payment being attempted. Created by public.wayl_start_intent, or by an admin grant. Sellers read their own and may not insert.';
