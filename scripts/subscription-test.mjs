/**
 * Shop Web — the manual payment flow, end to end.
 *
 * Three things are being pinned.
 *
 *  1. The seller journey: pick a plan, get a reference code and the
 *     owner's FIB number, say you sent it, and wait. The screen must
 *     never claim the payment succeeded — only the owner finding the
 *     money does that — and it must never ask for a PIN, a password, a
 *     card number or a receipt.
 *
 *  2. The state transitions: open -> pending is the seller's only move,
 *     and it moves nothing else. Confirming is the owner's, and
 *     not-found puts the intent back rather than inventing a rejection.
 *
 *  3. The admin gate. /admin is decided on the server against the
 *     admins table on every request, and a non-admin gets the ordinary
 *     404 — not a redirect, not a 403, and nothing in the body that says
 *     the page exists.
 *
 * Drives the real Worker against scripts/stub-supabase.mjs:
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/subscription-test.mjs
 */

import { FIB_NUMBER, PLANS } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const COOKIE = 'sb-access=TEST';
const INTENT = 'eeeeeeee-1111-4111-8111-111111111111';

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const setAdmin = (on) => fetch(`${STUB}/__admin/${on ? 1 : 0}`).then((r) => r.json());
const setSub = (days) => fetch(`${STUB}/__sub/${days}`).then((r) => r.json());
const setIntent = (status) => fetch(`${STUB}/__intent/${status}`).then((r) => r.json());
const getWrites = () => fetch(`${STUB}/__writes`).then((r) => r.json());
const resetCalls = () => fetch(`${STUB}/__calls/reset`).then((r) => r.json());

const page = (path) =>
  fetch(`${APP}${path}`, { headers: { cookie: COOKIE } }).then((r) => r.text());

async function post(path, fields, extra = {}) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: COOKIE, origin: APP,
      'content-type': 'application/x-www-form-urlencoded',
      ...(extra.headers || {}),
    },
    body: new URLSearchParams(fields || {}),
  });
  return { status: res.status, location: res.headers.get('location') };
}

await fetch(`${STUB}/__mode/shop`);
await fetch(`${STUB}/__rows/1`);
await setAdmin(false);
await setSub(20);
await setIntent('none');

/* ============================================================
   1. the seller picks a plan
   ============================================================ */

let html = await page('/app/subscription');
check('the plan screen renders', html.includes('پلانی بەشداریکردن'), true);
check('both plans are offered', PLANS.every((p) => html.includes(String(p.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ','))), true);
check('6 months is priced at 55,000', html.includes('55,000'), true);
check('1 year is priced at 90,000', html.includes('90,000'), true);
check('there is a pay button', html.includes('id="pay-btn"'), true);
check('payment history is on the screen', html.includes('مێژووی پارەدان'), true);
check('a confirmed payment is listed', html.includes('پشتڕاستکراوە'), true);

// The old placeholder promised two free months for paying during the
// trial. That is a different date rule and it is gone.
check('no 2-month bonus is promised', /٢ مانگی زیادە/.test(html), false);

await resetCalls();
let r = await post('/app/subscription', { plan: 'months_6' });
check('choosing a plan files an intent', r.status, 303);
check('and goes straight to the instructions', r.location, '/app/subscription/pay');

const insert = (await getWrites()).find((w) => w.table === 'payment_intents' && w.method === 'POST');
check('the intent names the plan', insert?.body.plan, 'months_6');
check('and the shop', Boolean(insert?.body.shop_id), true);

r = await post('/app/subscription', { plan: 'not-a-plan' });
check('an unknown plan is refused', r.location, '/app/subscription?e=errPlan');

/* ============================================================
   2. the instructions
   ============================================================ */

await setIntent('open');
html = await page('/app/subscription/pay');

check('the reference code is shown', html.includes('SW-4821'), true);
check('the owner\'s FIB number is shown', html.includes(FIB_NUMBER), true);
check('both have a copy button', (html.match(/data-copy="/g) || []).length, 2);
check('the seller is told to write the code in the note',
      html.includes('لە تێبینی ناردنەکەدا'), true);
check('there is an "I sent it" button', html.includes('پارەکەم نارد'), true);

// The things this screen must never do.
check('never claims success', /سەرکەوتوو بوو|پارەکەت وەرگیرا/.test(html), false);
check('no green tick before the owner confirms', html.includes('alert--ok'), false);

// It asks the seller for nothing at all. The page carries exactly one
// input — the hidden id of the intent they are looking at — so there is
// no field a PIN, a password or a card number could be typed into, and
// no file picker for a receipt.
const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
check('the page has exactly one input', inputs.length, 1);
check('and it is the hidden intent id',
      /type="hidden"[^>]*name="intent"/.test(inputs[0] ?? ''), true);
check('no password field', /type="password"/.test(html), false);
check('no receipt upload', /type="file"/.test(html), false);
check('nothing on the page is required', /\brequired\b/.test(html), false);

// And it says so out loud, because that sentence is what a seller
// checks the next time somebody phones them asking for a code.
check('says plainly that we never ask for those',
      html.includes('هەرگیز داوای PIN، ووشەی نهێنی یان ژمارەی کارتت لێ ناکەین'), true);

/* ============================================================
   3. "I sent it" — open to pending, and nothing else
   ============================================================ */

await resetCalls();
r = await post('/app/subscription/sent', { intent: INTENT });
check('marking it sent redirects back to the instructions', r.location, '/app/subscription/pay');

let writes = await getWrites();
check('exactly one call was made', writes.length, 1);
check('and it is mark_intent_sent', writes[0]?.table, 'rpc/mark_intent_sent');
check('the subscription was not touched',
      writes.some((w) => w.table === 'subscriptions'), false);
check('no payment was recorded',
      writes.some((w) => w.table === 'payments'), false);

html = await page('/app/subscription/pay');
check('the screen now says waiting, not paid',
      html.includes('چاوەڕوانی پشتڕاستکردنەوە'), true);
check('the "I sent it" button is gone', html.includes('پارەکەم نارد'), false);
check('still no success state', html.includes('alert--ok'), false);

// A second plan cannot be filed on top of a live intent.
r = await post('/app/subscription', { plan: 'months_6' });
check('choosing the same plan again returns to the instructions',
      r.location, '/app/subscription/pay');

html = await page('/app/subscription');
check('the plan screen links back to the waiting payment',
      html.includes('/app/subscription/pay'), true);

r = await post('/app/subscription/sent', { intent: 'not-a-uuid' });
check('a bad intent id is refused', r.location, '/app/subscription/pay?e=errSent');

r = await post('/app/subscription/sent', { intent: INTENT },
               { headers: { origin: 'https://evil.test' } });
check('a cross-origin "I sent it" is refused', r.status, 403);

/* ============================================================
   4. the banners on the dashboard
   ============================================================ */

await setIntent('none');

const banner = async (days) => {
  await setSub(days);
  const out = await page('/app');
  const m = out.match(/class="plan-banner plan-banner--([a-z]+)"/);
  return m ? m[1] : null;
};

check('day 15 of the trial: no banner', await banner(15), null);
check('day 20 (10 days left): countdown', await banner(10), 'soon');
check('day 30 (grace started): grace banner', await banner(-1), 'grace');
check('day 37 (products hidden): hidden banner', await banner(-8), 'hidden');

await setSub(-8);
html = await page('/app');
check('the hidden banner says paying restores them',
      html.includes('پارە بدە'), true);

await setIntent('pending');
await setSub(10);
check('a waiting transfer replaces the countdown', await banner(10), 'pending');
await setIntent('none');
await setSub(20);

/* ============================================================
   5. the admin gate
   ============================================================

   Server-side, against the admins table, on every request. A non-admin
   gets the ordinary 404 the router would have produced for any unknown
   path — no redirect, no 403, and nothing in the body that admits the
   page is there.
*/

const ADMIN_PATHS = ['/admin', '/admin/shops', '/admin/intents', '/admin/reports'];

await setAdmin(false);
for (const path of ADMIN_PATHS) {
  const res = await fetch(`${APP}${path}`, { headers: { cookie: COOKIE }, redirect: 'manual' });
  const body = await res.text();
  check(`non-admin ${path}: 404`, res.status, 404);
  check(`non-admin ${path}: not a redirect`, res.headers.get('location'), null);
  check(`non-admin ${path}: body does not admit it exists`,
        /بەڕێوەبردن|adm-h1/.test(body), false);
}

// Signed out entirely.
for (const path of ADMIN_PATHS) {
  const res = await fetch(`${APP}${path}`, { redirect: 'manual' });
  check(`signed out ${path}: 404, not a login redirect`, res.status, 404);
}

// The writes are gated too, and a non-admin POST must not look like a
// rejected CSRF attempt either — it is the same 404.
await resetCalls();
for (const path of [
  `/admin/intents/${INTENT}/activate`,
  `/admin/intents/${INTENT}/not-found`,
]) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: COOKIE, origin: APP,
               'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(),
  });
  check(`non-admin POST ${path.split('/').pop()}: 404`, res.status, 404);
}
writes = await getWrites();
check('a non-admin POST reaches no RPC at all',
      writes.some((w) => w.table.startsWith('rpc/admin')), false);

/* ---------- as the owner ---------- */

await setAdmin(true);
await setIntent('pending');

html = await page('/admin/intents');
check('admin sees the payments list', html.includes('پارەدانەکان'), true);
check('the row shows the shop', html.includes('بۆتیکی نافین'), true);
check('the row shows the reference code', html.includes('SW-4821'), true);
check('the row shows the amount', html.includes('55,000'), true);
check('there is an activate button', html.includes('چالاککردن'), true);
check('there is a not-found button', html.includes('نەدۆزرایەوە'), true);
check('there is no "rejected" anywhere', /ڕەتکرایەوە/.test(html), false);

check('expiring shops are listed', html.includes('بەم زووانە تەواو دەبن'), true);
check('each carries a WhatsApp link to that seller',
      html.includes('https://wa.me/9647510000002'), true);

await resetCalls();
r = await post(`/admin/intents/${INTENT}/activate`, {});
check('activate redirects back to the list', r.location, '/admin/intents');
writes = await getWrites();
check('activate goes through the one confirm function',
      writes.some((w) => w.table === 'rpc/admin_activate_intent'), true);

await setIntent('pending');
await resetCalls();
r = await post(`/admin/intents/${INTENT}/not-found`, {});
check('not-found redirects back to the list', r.location, '/admin/intents');
writes = await getWrites();
check('not-found goes through its own function',
      writes.some((w) => w.table === 'rpc/admin_intent_not_found'), true);
check('not-found records no payment',
      writes.some((w) => w.table === 'payments'), false);
check('not-found does not touch the subscription',
      writes.some((w) => w.table === 'subscriptions'), false);

await setAdmin(false);
await setIntent('none');

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
