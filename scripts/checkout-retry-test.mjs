/**
 * Bazaro — tapping Pay again after Wayl did not answer.
 *
 * The failure this exists to stop: a seller taps Pay, Wayl fails to
 * make a link, they tap again, and again, and on the sixth tap the app
 * tells them they are going too fast and stops letting them pay at
 * all. Every one of those taps was a person trying to give us money.
 *
 * So: one attempt per shop per plan, reused on every retry, with a
 * fresh reference each time because Wayl may already have seen the old
 * one. Nothing is spent until something actually reaches Wayl.
 *
 * The database half — the reuse, the rotated secret, the rate limit
 * that only counts real links — is scripts/checkout-retry-db-test.sql.
 * This is the Worker's half: what the seller meets on the screen.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/checkout-retry-test.mjs
 */

import { waylEnv } from '../worker/wayl.js';
import { PLANS, SUBSCRIPTION as S, plansIn } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const COOKIE = 'sb-access=TEST';

// The prices the seller is shown depend on which Wayl the Worker is
// pointed at, so the expected numbers have to come from the same place
// the Worker gets them — and by the same rule, not a second copy of it.
// An unset WAYL_ENV means test, exactly as it does in the Worker.
const PRICED = plansIn(waylEnv({ WAYL_ENV: process.env.WAYL_ENV }));
const YEAR = PRICED.find((p) => p.key === 'year_1');
const SIX = PRICED.find((p) => p.key === 'months_6');
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const control = (path) => fetch(`${STUB}${path}`).then((r) => r.json());
const created = () => fetch(`${STUB}/__wayl/created`).then((r) => r.json());
const page = (path) => fetch(`${APP}${path}`, { headers: { cookie: COOKIE } }).then((r) => r.text());

async function pay(plan = 'year_1') {
  const res = await fetch(`${APP}/app/subscription/checkout`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: COOKIE, origin: APP, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ plan }),
  });
  return { status: res.status, location: res.headers.get('location') };
}

async function fresh() {
  await control('/__mode/shop');
  await control('/__rows/1');
  await control('/__admin/0');
  await control('/__intent/none');
  await control('/__plan/free');
  await control('/__sub/0');
  await control('/__products/0');
  await control('/__wayl/reset');
  await control('/__calls/reset');
}

/* ============================================================
   1. the price the seller is told is the price they are charged
   ============================================================ */

await fresh();

const plans = await page('/app/subscription');
check('the plans screen shows the year price in dinars', plans.includes(grouped(YEAR.amount)));
check('and the six-month price', plans.includes(grouped(SIX.amount)));
check('the dinar charge is said before leaving the site',
  plans.includes(S.chargeNotice(grouped(YEAR.amount))));
check('one charge line per plan, so the selection can switch between them',
  (plans.match(/data-charge-for="/g) || []).length, PLANS.length);
check('the form is marked for the double-tap guard', plans.includes('data-checkout'));
check('and the guard script is loaded', plans.includes('/js/checkout.js'));

// The gate in front of Add Product sells the same two plans, and must
// say the same numbers.
const gate = await page('/app/subscription/start');
check('the plan gate names the dinar charge too',
  gate.includes(S.chargeNotice(grouped(YEAR.amount)))
  && gate.includes(S.chargeNotice(grouped(SIX.amount))));
check('each gate checkout form is guarded',
  (gate.match(/data-checkout/g) || []).length, PLANS.length);

/* ============================================================
   2. Wayl fails, and the seller taps again
   ============================================================ */

await control('/__wayl/linkfails/1');

const first = await pay('year_1');
check('the first tap comes back rather than hanging', first.status, 303);
check('and says the failure was Wayl\'s, not the seller\'s',
  first.location, '/app/subscription?e=errProvider');

// Nine more ordinary taps. This is the exact sequence that used to end
// in "you are going too fast" and no way to pay.
const tries = [];
for (let i = 0; i < 9; i += 1) tries.push(await pay('year_1'));

check('every retry is still answered, none is rate limited',
  tries.every((r) => r.location === '/app/subscription?e=errProvider'));
check('no retry was ever told the shop is busy',
  tries.some((r) => r.location?.includes('errBusy')), false);

// Ten taps, ten attempts at Wayl, but only ever one intent behind them.
const attempts = await created();
check('every tap did try Wayl', attempts.length, 10);
const references = new Set(attempts.map((a) => a.referenceId));
check('each attempt carried a fresh reference', references.size, 10);
const intents = new Set(attempts.map((a) => a.customParameter));
check('and all ten were the same one attempt', intents.size, 1);
check('the webhook URL is the same one throughout',
  new Set(attempts.map((a) => a.webhookUrl)).size, 1);

/* ============================================================
   3. Wayl answers, and the seller goes
   ============================================================ */

await control('/__wayl/linkfails/0');
const worked = await pay('year_1');
check('the tap that works redirects to Wayl', worked.status, 303);
check('and the link is Wayl\'s, not ours', worked.location?.startsWith('https://'));
check('Wayl was asked for the price the database holds',
  (await created()).at(-1)?.total, YEAR.amount);
// Wayl answers 201, not 200, when it creates a link. The Worker reads
// the whole 2xx range; a check for 200 would read a created link as a
// failure and leave the seller with nothing.
check('a 201 from Wayl is a created link, not a failure',
  worked.location?.startsWith('https://checkout.'));

// A second tap on a link that already exists is the same link, not a
// second payment.
const again = await pay('year_1');
check('tapping again hands back the same checkout', again.location, worked.location);
check('and no eleventh link was made at Wayl', (await created()).length, 11);

/* ============================================================
   4. a failure that is ours, said as ours
   ============================================================

   Five different things used to come back as one word, errCheckout: no
   return URL configured, the database refusing, Wayl refusing, Wayl
   unreachable, the link failing to store. Only one of those is Wayl's,
   and only one is worth tapping again for.

   The missing-return-URL case is the one that actually bit: Wayl is
   never called at all, so there is no Wayl error to find and no link,
   id or code to store. Verified live on 2026-09-12 by running the
   Worker with WAYL_RETURN_URL removed from wrangler.jsonc: the route
   answered ?e=errConfig, made zero create-link calls, and logged
   "checkout failed: WAYL_RETURN_URL is missing or not a usable https
   URL". That one needs a second Worker to reproduce, so what is pinned
   here is everything reachable with one.
   ============================================================ */

await fresh();
await control('/__wayl/linkfails/1');
const refused = await pay('year_1');
check('Wayl refusing is reported as Wayl, not as the seller',
  refused.location, '/app/subscription?e=errProvider');
check('and the attempt still holds no link', (await created()).length, 1);
await control('/__wayl/linkfails/0');

/* ============================================================
   5. the guards that must survive all of this
   ============================================================ */

await fresh();
await control('/__wayl/busy/1');
check('a shop making real links in a loop is still stopped',
  (await pay('year_1')).location, '/app/subscription?e=errBusy');
await control('/__wayl/busy/0');

await fresh();
await control('/__intent/pending');
check('a hand-made transfer waiting on the owner still wins',
  (await pay('months_6')).location, '/app/subscription/pay');

await fresh();
const crossOrigin = await fetch(`${APP}/app/subscription/checkout`, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: COOKIE, origin: 'https://evil.test',
             'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ plan: 'year_1' }),
});
check('a cross-origin checkout is refused', crossOrigin.status, 403);

const madeUp = await pay('year_100');
check('an invented plan buys nothing', madeUp.location, '/app/subscription?e=errPlan');
check('and reached Wayl not at all', (await created()).length, 0);

/* ============================================================
   6. nothing about the payment leaks to the browser
   ============================================================ */

await fresh();
await control('/__wayl/linkfails/0');
await pay('year_1');
const secret = (await created()).at(-1)?.webhookSecret;
check('Wayl was given a webhook secret', /^[0-9a-f]{64}$/.test(secret || ''));
for (const path of ['/app/subscription', '/app/subscription/start', '/app']) {
  check(`the secret is in no part of ${path}`, (await page(path)).includes(secret), false);
}

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}` +
    (r.pass ? '' : `\n     got ${JSON.stringify(r.got)} want ${JSON.stringify(r.want)}`));
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
