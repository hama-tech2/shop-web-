-- ============================================================
-- Restore the live six-month price: 1,000 -> 38,000
--
-- Run this the moment the one real payment is confirmed. Until it runs,
-- EVERY shop can buy six months for 1,000 IQD, not just the one doing
-- the test — there is no environment flag and no pretending involved.
--
-- The database is half of it. The other half is the Worker, or the
-- screen goes on saying 1,000 while Wayl is asked for 38,000:
--
--   1. worker/config.js — PLANS months_6: amount 1000 -> 38000,
--      monthly 167 -> 6300
--   2. scripts/plan-state-test.mjs — the pinned price back to 38000,
--      and drop the sixIsTemporary guard on the "cheaper month" check
--   3. scripts/stub-supabase.mjs — PRICE.months_6 back to 38000
--   4. npx wrangler deploy
--
-- An open checkout still sitting at 1,000 is not a loose end:
-- wayl_start_intent only reuses an attempt priced at what the shop pays
-- today, so the next tap cancels and replaces it, and
-- wayl_apply_payment would refuse to activate it either way. Step 2
-- below just makes that immediate.
-- ============================================================

-- 1. the price
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

-- 2. close anything created at the temporary price
update public.payment_intents pi
   set status = 'cancelled', handled_at = now()
 where pi.status in ('open', 'pending')
   and pi.source = 'payment'
   and pi.amount <> app.plan_price_for(pi.plan, pi.shop_id);

-- 3. proof, in one row
select
  app.plan_price('months_6')                                   as six_months,
  app.plan_price('year_1')                                     as one_year,
  (select count(*) from app.price_overrides)                   as overrides_left,
  (select count(*) from public.shops sh
    where app.plan_price_for('months_6', sh.id) <> 38000
       or app.plan_price_for('year_1',   sh.id) <> 72000)      as shops_off_list_price,
  (select count(*) from public.payment_intents pi
    where pi.status in ('open', 'pending') and pi.source = 'payment'
      and pi.amount <> app.plan_price_for(pi.plan, pi.shop_id)) as intents_off_list_price;
-- expect: 38000, 72000, 0, 0, 0
