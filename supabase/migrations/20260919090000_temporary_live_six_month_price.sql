-- ============================================================
-- TEMPORARY — the live six-month price, for one real payment
--
-- A real Wayl payment cannot be rehearsed. The live checkout is the
-- only one that charges an actual card, FIB or SuperQi account, and the
-- only thing left unproven is that a real charge arrives, activates a
-- plan, and grants the right number of days. Proving it should not cost
-- 38,000 IQD, so for one transaction six months costs 1,000.
--
-- THIS IS THE REAL PRICE WHILE IT IS IN PLACE. Every shop pays it, not
-- just the one doing the test: there is no environment flag and no
-- pretending here. Reverse it as soon as the payment is confirmed:
--
--   supabase/migrations/…_restore_six_month_price.sql, or by hand —
--   scripts/six-month-price-rollback.sql
--
-- The year is untouched at 72,000, and nothing else about the payment
-- path moves. The amount is still written by the database on insert and
-- re-derived by wayl_apply_payment before a day is granted; the months
-- still come from the plan, so 1,000 buys exactly the same six months
-- 38,000 did. Signature checking, the authoritative status read and the
-- activated_at replay guard are not touched by this file.
--
-- PLANS in worker/config.js carries the same number for display and
-- scripts/plan-limits-test.mjs fails if the two drift, so the screen
-- cannot say 38,000 while Wayl is asked for 1,000.
-- ============================================================

create or replace function app.plan_price(p_plan text)
returns numeric
language sql
immutable
as $$
  select case p_plan
           -- TEMPORARY: 38000 normally. One live payment test.
           when 'months_6' then 1000::numeric
           when 'year_1'   then 72000::numeric
         end;
$$;

comment on function app.plan_price(text) is
  'IQD price per plan, authoritative. TEMPORARY: months_6 is 1,000 for one live payment test; restore to 38,000 straight after. PLANS in worker/config.js must be edited to match.';
