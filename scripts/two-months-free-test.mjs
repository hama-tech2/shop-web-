/**
 * Bazaro — the seller's side of "the first two months are free".
 *
 * supabase/tests/two_months_free_test.sql proves the calendar: sixty
 * days, one per account, a plan bought mid-trial starting when the
 * trial ends, and nothing stacking. This proves the screens that sit on
 * top of it, and one thing the database cannot: that the Worker never
 * decides any of it for itself.
 *
 * The rule being pinned hardest is the last one. Every date and every
 * verdict on this screen comes from subscription_state(); if the Worker
 * started computing "is the trial over" from a clock of its own, a
 * seller could be locked out or let in by a stale response, and the
 * browser could be talked into either.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/two-months-free-test.mjs
 */
const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const COOKIE = 'sb-access=TEST';

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const set = (path) => fetch(STUB + path).then((r) => r.json());
const page = (path) =>
  fetch(APP + path, { headers: { cookie: COOKIE } }).then((r) => r.text());
const raw = (path) => fetch(APP + path, { headers: { cookie: COOKIE }, redirect: 'manual' });

/** The subscription screen as the seller sees it. */
const plans = () => page('/app/subscription');
/** The Account card, which carries the same state in a smaller space. */
const account = () => page('/app');

const has = (html, text) => html.includes(text);
const stateAttr = (html) =>
  html.match(/data-plan-state="([^"]*)"/)?.[1] ?? null;

await set('/__mode/shop');
await set('/__rows/1');
await set('/__products/1');

/* ================================================================
   1. the free period, running, nothing bought
   ================================================================ */
await set('/__plan/trial');
await set('/__trial/23');
await set('/__sub/23');

let html = await plans();
check('the screen is headed by the free period', has(html, '٢ مانگ بەخۆڕایی'));
check('it says how many days are left', has(html, '23 ڕۆژ لە ماوە بەخۆڕاییەکەت ماوە.'));
check('and what happens when they run out', has(html, 'دوو مانگ بەخۆڕایی. پاش کۆتاییهاتنی، بۆ بەردەوامبوون پلانێک هەڵبژێرە.'));
check('the state the markup declares is the trial', stateAttr(html), 'trial');
check('and the days it declares are the trial days', html.includes('data-plan-days="23"'));

/* ---- the two paid plans, at the two prices, and no third ---- */
check('six months is offered', has(html, '5,000'));
check('one year is offered', has(html, '9,000'));
check('there is no public one-month plan', /name="plan"[^>]*value="month_1"/.test(html), false);
check('and no third price appears', (html.match(/billing-amount/g) || []).length, 2);

// The old model must be gone from the screen, not merely unreachable.
// A seller who sees 38,000 anywhere has been told the wrong number.
check('the old six-month price is nowhere on the page', has(html, '38,000'), false);
check('nor the old yearly price', has(html, '72,000'), false);
check('no permanent Free plan is offered any more', has(html, 'پلانی بەخۆڕایی'), false);
check('and nothing is sold by the month', has(html, '١ مانگ') || has(html, '1 مانگ'), false);

/* ---- this is not a discount, and must never look like one ---- */
check('the free period is not dressed as a price cut', /<del|<s>|line-through/.test(html), false);
check('nothing claims a plan costs 0', /\b0\s*د\.ع/.test(html), false);

/* ---- the buy form is there, because nothing is held yet ---- */
check('a seller on the free period can still buy early', has(html, 'id="plan-form"'));

/* ================================================================
   2. a plan bought DURING the free period
   ================================================================ */
await set('/__plan/months_6');
await set('/__trial/23');
// The entitlement now runs to the trial end plus six months, which is
// what admin_apply_payment's greatest(now, expires_at) produces.
await set('/__sub/' + (23 + 182));

html = await plans();
check('the screen says the plan is ready and starts after the free period',
  has(html, 'پلانی ٦ مانگت ئامادەیە و پاش کۆتایی ماوە بەخۆڕاییەکەت دەست پێدەکات.'));
check('the state is scheduled, not active', stateAttr(html), 'scheduled');
check('the heading is still the free period, because that is what is running',
  has(html, '٢ مانگ بەخۆڕایی'));
check('and it names the day the plan starts', has(html, 'دەست پێدەکات لە'));

/* ---- and there is nothing left to buy ---- */
check('no second plan is offered while one is scheduled', has(html, 'id="plan-form"'), false);
check('and no button offers to take another payment', has(html, 'id="pay-btn"'), false);
// Not buyable is not the same as not knowable. A seller whose plan ends
// next week still needs the price of the next one.
check('but the prices are still on the screen', has(html, '5,000') && has(html, '9,000'));
check('with nothing on them that can be posted',
  /billing-options--info/.test(html) && !/name="plan"/.test(html), true);
check('and a line saying when a new plan can be bought',
  has(html, 'کاتێک پلانی ئێستات تەواو بوو'));

/* ---- posting the form anyway gets nowhere: the database refuses ---- */
const stacked = await fetch(APP + '/app/subscription/checkout', {
  method: 'POST',
  redirect: 'manual',
  headers: {
    cookie: COOKIE, origin: APP,
    'content-type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({ plan: 'year_1' }),
});
check('posting a second checkout by hand is refused', stacked.status === 303 || stacked.status === 302, true);
check('and lands back on the plan screen rather than at Wayl',
  (stacked.headers.get('location') || '').startsWith('/app/subscription'), true);
check('no Wayl checkout url was handed out',
  /thewayl/.test(stacked.headers.get('location') || ''), false);
// Not an error, and not reported as one. The seller did nothing wrong:
// they already hold a plan. A generic "checkout failed" banner here
// would read as a payment problem and send them to support.
check('and they are not shown a checkout failure they did not cause',
  /[?&]e=err/.test(stacked.headers.get('location') || ''), false);

/* ================================================================
   3. a paid plan running, past the free period
   ================================================================ */
await set('/__plan/year_1');
await set('/__trial/-');
await set('/__sub/200');

html = await plans();
check('a running paid plan reads as active', stateAttr(html), 'active');
check('it counts down the paid days', has(html, '200 ڕۆژ ماوە'));
check('the free-period heading is gone', has(html, '٢ مانگ بەخۆڕایی'), false);
check('and a running plan is not offered another', has(html, 'id="plan-form"'), false);

/* ================================================================
   4. the free period has ended and nothing was bought
   ================================================================ */
await set('/__plan/trial');
// The free month ended five days ago, which is past the three grace
// days a subscription carries. Grace is the existing behaviour and is
// pinned separately below.
await set('/__trial/-5');
await set('/__sub/-5');

html = await plans();
check('the screen says the free period is over', has(html, 'ماوە بەخۆڕاییەکەت تەواو بووە'));
check('it says the products were kept', has(html, 'بەرهەمەکانت پارێزراون'));
check('it says so again, plainly, in its own line',
  has(html, 'هیچ بەرهەمێک نەسڕدراوەتەوە'));
check('it never says anything was deleted',
  /سڕاوە|سڕدرا|لەناوچوو/.test(html.replace('نەسڕدراوەتەوە', '')), false);
check('and it offers the two plans again', has(html, 'id="plan-form"'));
check('at the same two prices', has(html, '5,000') && has(html, '9,000'));

/* ---- the seller is still signed in and their shop still works ---- */
check('the Account screen still opens after the free period ended',
  (await raw('/app')).status, 200);
check('the product manager still opens', (await raw('/app/products')).status !== 500, true);
const acct = await account();
check('and the Account card says the products are preserved, not lost',
  /پارێزراون/.test(acct));

/* ================================================================
   5. the Worker decides none of this
   ================================================================ */
// Every verdict above came from the stub's subscription_state. If the
// Worker had a clock of its own, a shop the database calls expired
// could still be drawn as a live trial. It cannot: with on_trial false
// and the date past, the screen says expired whatever the plan says.
await set('/__plan/trial');
await set('/__trial/-5');
await set('/__sub/-5');
check('a shop the database calls expired is drawn as expired',
  stateAttr(await plans()), 'expired');

// The free month gets NO grace days. Thirty days free means thirty, so
// the day after it ends the shop is expired, not in grace. A paid plan
// keeps its three grace days — that is asserted right below, against the
// same screen, so the two rules cannot quietly become one.
await set('/__trial/-1');
await set('/__sub/-1');
check('the day after the free period ends the shop is expired, not in grace',
  stateAttr(await plans()), 'expired');
check('and the screen says the free period is over',
  has(await plans(), 'ماوە بەخۆڕاییەکەت تەواو بووە'));

// The same day, but for a plan somebody paid for: still in grace, still
// public, still warned rather than cut off.
await set('/__plan/year_1');
await set('/__sub/-1');
check('a PAID plan one day past its date is still in grace',
  stateAttr(await plans()), 'grace');
await set('/__sub/-2');
check('and two days past it', stateAttr(await plans()), 'grace');
await set('/__sub/-4');
check('but not four days past it, once its grace is spent',
  stateAttr(await plans()), 'expired');

// Back to a live trial for the checks that follow.
await set('/__plan/trial');
await set('/__trial/1');
await set('/__sub/1');

// And the reverse: the database says the trial is live, so it is drawn
// live even though the plan row still says 'trial' and could be read as
// a month that began long ago.
await set('/__trial/1');
await set('/__sub/1');
check('a shop the database calls on-trial is drawn as on-trial',
  stateAttr(await plans()), 'trial');
check('on its last day it says so rather than counting one day',
  has(await plans(), 'ئەمڕۆ ڕۆژی کۆتایی ماوە بەخۆڕاییەکەتە.'));

/* ================================================================
   6. a suspended shop is not offered a free month
   ================================================================ */
await set('/__suspended/1');
html = await plans();
check('a suspended shop is told it is suspended', stateAttr(html), 'suspended');
check('and is not offered the free period', has(html, 'ڕۆژ لە ماوە بەخۆڕاییەکەت ماوە'), false);
await set('/__suspended/0');

/* ================================================================
   7. the trial limits are the ones we said, and are not unlimited
   ================================================================ */
await set('/__plan/trial');
await set('/__trial/20');
await set('/__sub/20');
await set('/__products/30');
const gate = await page('/app/new');
check('a seller who has used all thirty trial slots is stopped',
  /بەخۆڕایی|پلانێک/.test(gate));
check('the trial is never described as unlimited',
  /بێ ?سنوور/.test(gate) && !/ت١٠٠٠|1000/.test(gate), false);
await set('/__products/1');

/* ---------- report ---------- */
for (const r of results) {
  if (r.pass) console.log('PASS ' + r.name);
  else console.log(`FAIL  ${r.name}\n      got  ${JSON.stringify(r.got)}\n      want ${JSON.stringify(r.want)}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} of ${results.length} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
