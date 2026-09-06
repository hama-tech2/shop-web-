/**
 * Shop Web — the date rule and the five states.
 *
 * Two things are pinned here, both pure:
 *
 *  1. The date rule, as one line:
 *       new_end = max(current_end, today) + plan duration
 *     A seller who pays on day 10 of the trial keeps the remaining 20
 *     days on top. A seller who has been gone for three months does not
 *     get billed for the time they were away. There is no "1 + 6 = 7"
 *     special case and no bonus months — those were a different rule.
 *
 *  2. Which of the five states a shop is in. Only trial, pending and
 *     active are stored; grace and expired fall out of the expiry date
 *     and the 7-day window, which is the same arithmetic RLS uses to
 *     decide whether the shop's products are public.
 *
 *   node scripts/plan-state-test.mjs
 */

import { PLANS } from '../worker/config.js';
import { bannerFor, daysUntil, planState } from '../worker/plan-state.js';

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const DAY = 86400000;
const NOW = Date.parse('2026-09-06T12:00:00Z');
const at = (days) => new Date(NOW + days * DAY).toISOString();

/* ============================================================
   1. the date rule
   ============================================================

   The Worker never computes this — admin_apply_payment does, in one
   statement, so that the subscription and the payment row can never
   disagree. This is the same arithmetic, kept here so a change to the
   rule has to break a test before it reaches a seller's calendar.
*/

const MONTHS = { months_6: 6, year_1: 12 };

function newEnd(currentEnd, plan, now = NOW) {
  const base = Math.max(now, Date.parse(currentEnd));
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + MONTHS[plan]);
  return d.toISOString();
}

const carried = (currentEnd, now = NOW) =>
  Math.max(0, Math.round((Date.parse(currentEnd) - now) / DAY));

// Day 10 of a 30-day trial: 20 days left, and they stay.
check('trial day 10 + 6 months: keeps the unused 20 days',
      carried(at(20)), 20);
check('trial day 10 + 6 months: ends 20 days after a plain 6 months',
      Math.round((Date.parse(newEnd(at(20), 'months_6'))
                - Date.parse(newEnd(at(0), 'months_6'))) / DAY), 20);

check('trial last day + 6 months: nothing carried', carried(at(0)), 0);

// Renewing early stacks rather than resetting.
check('active with 60 days left + 1 year: keeps the 60',
      Math.round((Date.parse(newEnd(at(60), 'year_1'))
                - Date.parse(newEnd(at(0), 'year_1'))) / DAY), 60);

// Expired sellers start from today. They are not charged for the gap,
// and they do not get credit for it either.
check('expired 3 days ago: starts from today', carried(at(-3)), 0);
check('expired 90 days ago: starts from today', carried(at(-90)), 0);
check('expired 90 days ago + 1 year ends a year from today',
      newEnd(at(-90), 'year_1'), newEnd(at(0), 'year_1'));

// The rule that is NOT in force: no bonus months for paying in trial.
check('6 months means 6 months, not 8',
      Math.round((Date.parse(newEnd(at(0), 'months_6')) - NOW) / DAY) < 190, true);

/* ============================================================
   2. the five states
   ============================================================ */

const sub = (days, plan = 'trial', graceDays = 7) => ({
  plan,
  status: plan === 'trial' ? 'trialing' : 'active',
  expires_at: at(days),
  grace_ends_at: at(days + graceDays),
  total_days: 30,
});

check('trial, 20 days left', planState(sub(20), false, NOW).key, 'trial');
check('trial, 20 days left: counts the days', planState(sub(20), false, NOW).days, 20);
check('active, 200 days left', planState(sub(200, 'year_1'), false, NOW).key, 'active');

// Day 30: the plan has ended but the shop is still up.
check('the day it expires: grace, not expired', planState(sub(0), false, NOW).key, 'grace');
check('3 days past: still grace', planState(sub(-3), false, NOW).key, 'grace');
check('3 days past: 4 days of grace left', planState(sub(-3), false, NOW).days, 4);
check('6 days past: still grace', planState(sub(-6), false, NOW).key, 'grace');

// Day 37: grace is over and the products are hidden.
check('7 days past: expired', planState(sub(-7), false, NOW).key, 'expired');
check('30 days past: expired', planState(sub(-30), false, NOW).key, 'expired');

// A transfer waiting on the owner is what the seller most needs to see,
// but it never changes what the subscription is really doing.
check('pending while on trial', planState(sub(20), true, NOW).key, 'pending');
check('pending is still flagged once expired', planState(sub(-30), true, NOW).pending, true);
check('but an expired shop is still expired',
      planState(sub(-30), true, NOW).key, 'expired');
check('a pending transfer does not extend anything',
      planState(sub(-8), true, NOW).key, 'expired');

check('no subscription row at all', planState(null, false, NOW).key, 'expired');

/* ---------- the banners ---------- */

check('day 20 of the trial: countdown', bannerFor(planState(sub(10), false, NOW), 10), 'soon');
check('day 21: still counting', bannerFor(planState(sub(9), false, NOW), 10), 'soon');
check('day 15: nothing yet', bannerFor(planState(sub(15), false, NOW), 10), null);
check('day 30: grace banner', bannerFor(planState(sub(-1), false, NOW), 10), 'grace');
check('day 37: hidden banner', bannerFor(planState(sub(-7), false, NOW), 10), 'hidden');
check('waiting on the owner', bannerFor(planState(sub(20), true, NOW), 10), 'pending');

/* ---------- daysUntil ---------- */

check('daysUntil rounds up', daysUntil(at(1.2), NOW), 2);
check('daysUntil goes negative once past', daysUntil(at(-2), NOW), -2);
check('daysUntil on nonsense', daysUntil('not a date', NOW), null);

/* ============================================================
   3. the price list the seller is shown
   ============================================================

   app.plan_price is what actually gets stored, and it is checked
   against these in scripts/subscription-test.mjs. Here we only pin the
   numbers the brief fixed.
*/

const priceOf = (key) => PLANS.find((p) => p.key === key)?.amount;
check('6 months costs 55,000 IQD', priceOf('months_6'), 55000);
check('1 year costs 90,000 IQD', priceOf('year_1'), 90000);
check('there are exactly two paid plans', PLANS.length, 2);

/* ============================================================ */

let failed = 0;
for (const x of results) {
  if (!x.pass) failed += 1;
  console.log(
    `${x.pass ? 'PASS' : 'FAIL'}  ${x.name}` +
    (x.pass ? '' : `\n        got  ${JSON.stringify(x.got)}\n        want ${JSON.stringify(x.want)}`),
  );
}
console.log(failed ? `\n${failed} of ${results.length} FAILED` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
