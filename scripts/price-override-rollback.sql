-- ============================================================
-- Undo the live-test price. Run this the moment the real payment is
-- confirmed — or run it for any reason at all, at any time, safely.
--
-- One statement. No deploy, no migration, no Worker restart. The next
-- checkout anybody starts is priced from app.plan_price again, which
-- never moved: 38,000 for six months, 72,000 for a year.
--
-- A checkout still sitting open at 1,000 is not a loose end either.
-- wayl_start_intent only reuses an attempt whose amount equals what the
-- shop pays today, so the next time that seller taps pay, the 1,000
-- attempt is cancelled and replaced at 38,000 — and wayl_apply_payment
-- would refuse to activate it in any case, because the amount no longer
-- matches. Cancelling it here just makes that immediate.
-- ============================================================

-- 1. the rollback itself
delete from app.price_overrides;

-- 2. close any checkout that was created at the override price, so
--    nothing is left holding a link nobody can pay into.
update public.payment_intents pi
   set status = 'cancelled', handled_at = now()
 where pi.status in ('open', 'pending')
   and pi.source = 'payment'
   and pi.amount <> app.plan_price(pi.plan);

-- 3. proof, in one row: no override left, and both plans back to list
--    for every shop that exists.
select
  (select count(*) from app.price_overrides)                   as overrides_left,
  app.plan_price('months_6')                                   as list_months_6,
  app.plan_price('year_1')                                     as list_year_1,
  (select count(*) from public.shops sh
    where app.plan_price_for('months_6', sh.id) <> 38000
       or app.plan_price_for('year_1',   sh.id) <> 72000)      as shops_off_list_price,
  (select count(*) from public.payment_intents pi
    where pi.status in ('open', 'pending')
      and pi.source = 'payment'
      and pi.amount <> app.plan_price(pi.plan))                as intents_off_list_price;
-- expect: 0, 38000, 72000, 0, 0
