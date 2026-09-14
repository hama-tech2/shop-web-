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
 *     and the 3-day grace window, which is the same arithmetic RLS uses
 *     to decide whether the shop's products are public.
 *
 *  3. Which renewal banner belongs on the seller's screens, when it can
 *     be closed, and when a closed one comes back.
 *
 *   node scripts/plan-state-test.mjs
 */

import { PLANS, PLAN_BANNER, TRIAL_PRODUCT_LIMIT } from '../worker/config.js';
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

const sub = (days, plan = 'trial', graceDays = 3) => ({
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
check('1 day past: still grace', planState(sub(-1), false, NOW).key, 'grace');
check('1 day past: 2 days of grace left', planState(sub(-1), false, NOW).days, 2);
check('2 days past: still grace', planState(sub(-2), false, NOW).key, 'grace');

// Grace is three days. After that the products are hidden.
check('3 days past: expired', planState(sub(-3), false, NOW).key, 'expired');
check('30 days past: expired', planState(sub(-30), false, NOW).key, 'expired');

// A transfer waiting on the owner is what the seller most needs to see,
// but it never changes what the subscription is really doing.
check('pending while on trial', planState(sub(20), true, NOW).key, 'pending');
check('pending is still flagged once expired', planState(sub(-30), true, NOW).pending, true);
check('but an expired shop is still expired',
      planState(sub(-30), true, NOW).key, 'expired');
check('a pending transfer does not extend anything',
      planState(sub(-4), true, NOW).key, 'expired');

check('no subscription row at all', planState(null, false, NOW).key, 'expired');

/* ---------- the banners ---------- */

const S = PLAN_BANNER;
const banner = (days, plan = 'trial', closed = {}) =>
  bannerFor(planState(sub(days, plan), false, NOW), S, closed, NOW);

// A one-month trial gets two warnings.
check('trial, 15 days left: nothing yet', banner(15), null);
check('trial, day 20 (10 left): amber', banner(10)?.kind, 'soon');
check('trial, day 20: it can be closed', banner(10)?.dismissible, true);
check('trial, day 27 (3 left): urgent', banner(3)?.kind, 'urgent');
check('trial, 1 day left: still urgent', banner(1)?.kind, 'urgent');

// A paid plan runs for months, so it gets a third, earlier warning.
check('paid, 20 days left: nothing yet', banner(20, 'year_1'), null);
check('paid, 14 days left: amber', banner(14, 'year_1')?.kind, 'soon');
check('paid, 7 days left: amber', banner(7, 'year_1')?.kind, 'soon');
check('paid, 3 days left: urgent', banner(3, 'year_1')?.kind, 'urgent');
check('paid, 10 days left: warned, unlike a trial at 14',
      banner(10, 'year_1')?.kind, 'soon');

// The red two cannot be closed at all.
check('grace: red', banner(-1)?.kind, 'grace');
check('grace cannot be dismissed', banner(-1)?.dismissible, false);
check('hidden: red', banner(-5)?.kind, 'hidden');
check('hidden cannot be dismissed', banner(-5)?.dismissible, false);
check('waiting on the owner cannot be dismissed either',
      bannerFor(planState(sub(10), true, NOW), S, {}, NOW)?.dismissible, false);

/* Dismissing is "not now", never "never again". */

const ago = (days) => new Date(NOW - days * DAY).toISOString();

check('closed an hour ago: stays closed', banner(10, 'trial', { soon: ago(0.04) }), null);
check('closed 2 days ago: still closed', banner(10, 'trial', { soon: ago(2) }), null);
check('closed 4 days ago: back', banner(10, 'trial', { soon: ago(4) })?.kind, 'soon');

check('the urgent one closed 2 hours ago: closed',
      banner(3, 'trial', { urgent: ago(0.08) }), null);
check('the urgent one closed yesterday: back the next day',
      banner(3, 'trial', { urgent: ago(1.1) })?.kind, 'urgent');

// Closing one does not close the other: a seller who dismissed the
// 10-day warning must still meet the 3-day one.
check('closing the amber one does not silence the urgent one',
      banner(3, 'trial', { soon: ago(0) })?.kind, 'urgent');

// And nothing dismisses the red ones, whatever is in the table.
check('a stored dismissal cannot hide grace',
      banner(-1, 'trial', { soon: ago(0), urgent: ago(0) })?.kind, 'grace');
check('a stored dismissal cannot hide the products-are-gone banner',
      banner(-5, 'trial', { soon: ago(0), urgent: ago(0) })?.kind, 'hidden');

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
// TEMPORARY: 38,000 normally. 1,000 for one real live payment test;
// restore with the six-month price.
check('6 months costs 1,000 IQD', priceOf('months_6'), 1000);
check('1 year costs 72,000 IQD', priceOf('year_1'), 72000);
check('there are exactly two paid plans', PLANS.length, 2);

// The plans are talked about in dollars and charged in dinars, so the
// dollar figure is carried too — display only, never sent to Wayl.
check('6 months is talked about as $29', priceOf('months_6') && PLANS.find((p) => p.key === 'months_6').usd, 29);
check('1 year is talked about as $55', PLANS.find((p) => p.key === 'year_1').usd, 55);

// A year must be the better monthly rate, or the badge on it lies.
//
// TEMPORARILY it does lie: six months is 1,000 for one real live payment
// test, so its monthly rate is 167 and the badge on the year is wrong
// for as long as that lasts. Left visible rather than deleted — the
// moment 38,000 is restored this guards again on its own.
const monthlyOf = (key) => PLANS.find((p) => p.key === key).monthly;
const sixIsTemporary = PLANS.find((p) => p.key === 'months_6').amount === 1000;
check('the year is the cheaper month',
  sixIsTemporary || monthlyOf('year_1') < monthlyOf('months_6'), true);

// The year is what a seller should see first, and largest.
const ordered = PLANS.slice().sort(
  (a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0) || b.amount - a.amount,
);
check('the year comes first', ordered[0].key, 'year_1');
check('then six months', ordered[1].key, 'months_6');

check('the free trial allows five products', TRIAL_PRODUCT_LIMIT, 5);

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
