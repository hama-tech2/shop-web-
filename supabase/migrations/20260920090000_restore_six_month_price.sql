-- ============================================================
-- Restore the live six-month price to 38,000
--
-- The one real payment is done: BZ-MU19Y0W5-AADD31A42E, 1,000 IQD in
-- the live environment, a real Wallet charge, one webhook event, and
-- 181 days granted. 20260919_temporary_live_six_month_price existed for
-- that transaction and nothing else, so it goes now — until it does,
-- every shop buys six months for 1,000.
--
-- What this does NOT change, deliberately:
--   * the year stays 72,000
--   * WAYL_ENV stays live
--   * WAYL_RETURN_URL stays https://bazarnow.xyz/app/subscription/result
--
-- The Worker half must move with it or the screen will say 1,000 while
-- Wayl is asked for 38,000. scripts/six-month-price-rollback.sql lists
-- the three files and the one deploy.
-- ============================================================

create or replace function app.plan_price(p_plan text)
returns numeric
language sql
immutable
as $$
  select case p_plan
           when 'months_6' then 38000::numeric
           when 'year_1'   then 72000::numeric
         end;
$$;

comment on function app.plan_price(text) is
  'IQD price per plan, authoritative. PLANS in worker/config.js must be edited to match.';

-- Close anything created at the temporary price, so no link is left
-- that nobody can pay into. wayl_start_intent would cancel and replace
-- it on the next tap anyway, and wayl_apply_payment would refuse to
-- activate it; this only makes that immediate.
update public.payment_intents pi
   set status = 'cancelled', handled_at = now()
 where pi.status in ('open', 'pending')
   and pi.source = 'payment'
   and pi.amount <> app.plan_price_for(pi.plan, pi.shop_id);
