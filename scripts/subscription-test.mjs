/**
 * Shop Web — the retained manual payment fallback, end to end.
 *
 * Three things are being pinned.
 *
 *  1. The legacy fallback: directly POST a plan, get a reference code and the
 *     owner's FIB number, say you sent it, and wait. The screen must
 *     never claim the payment succeeded — only the owner finding the
 *     money does that — and it must never ask for a PIN, a password, a
 *     card number or a receipt. The primary plan UI now uses the existing
 *     Wayl hosted checkout, covered by wayl-test.mjs.
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

import { FIB_NUMBER, FREE_PRODUCT_LIMIT, PLANS } from '../worker/config.js';

/** Prices come from config, so changing one does not break this file. */
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const priced = (key) => grouped(PLANS.find((p) => p.key === key).amount);

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
const setPlan = (plan) => fetch(`${STUB}/__plan/${plan}`).then((r) => r.json());
const setProducts = (n) => fetch(`${STUB}/__products/${n}`).then((r) => r.json());
const setDismissed = (kind, daysAgo) =>
  fetch(`${STUB}/__dismissed/${kind}/${daysAgo}`).then((r) => r.json());
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
await setPlan('free');
await setProducts(0);
await setDismissed('reset', 0);

/* ============================================================
   1. the seller picks a plan
   ============================================================ */

let html = await page('/app/subscription');
check('the plan screen renders', html.includes('نوێکردنەوەی پلان'), true);
check('both plans are offered', PLANS.every((p) => html.includes(String(p.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ','))), true);
check('6 months is priced from config', html.includes(priced('months_6')), true);
check('1 year is priced from config', html.includes(priced('year_1')), true);
check('there is a pay button', html.includes('id="pay-btn"'), true);
check('payment history is on the screen', html.includes('مێژووی پارەدان'), true);
check('a confirmed payment is listed', html.includes('پشتڕاستکراوە'), true);

// The old placeholder promised two free months for paying during the
// trial. That is a different date rule and it is gone.
check('no 2-month bonus is promised', /٢ مانگی زیادە/.test(html), false);

await resetCalls();
// Filing a manual intent is closed: migration 0030 took the seller's
// insert policy away, so every intent now comes from
// public.wayl_start_intent. This route no longer attempts the write.
let r = await post('/app/subscription', { plan: 'months_6' });
check('the old manual entry files nothing', r.status, 303);
check('and says online payment is not switched on',
      r.location, '/app/subscription?e=errUnavailable');
check('no intent was written',
      (await getWrites()).some((w) => w.table === 'payment_intents' && w.method === 'POST'), false);

r = await post('/app/subscription', { plan: 'not-a-plan' });
check('an unknown plan is still refused first', r.location, '/app/subscription?e=errPlan');

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

// Two writes, and only these two: the transition itself, and the note
// of where the owner's Telegram message landed so the webhook can edit
// it. Nothing that moves money or time.
let writes = await getWrites();
check('the transition is the first call', writes[0]?.table, 'rpc/mark_intent_sent');
check('and the only other write is the Telegram bookkeeping',
      writes.slice(1).every((w) => w.table === 'payment_intents'
                                && Object.keys(w.body).every((k) => k.startsWith('telegram_'))),
      true);
check('the subscription was not touched',
      writes.some((w) => w.table === 'subscriptions'), false);
check('no payment was recorded',
      writes.some((w) => w.table === 'payments'), false);
check('and the intent status was not written from here',
      writes.some((w) => w.table === 'payment_intents' && 'status' in w.body), false);

html = await page('/app/subscription/pay');
check('the screen now says waiting, not paid',
      html.includes('چاوەڕوانی پشتڕاستکردنەوە'), true);
check('the "I sent it" button is gone', html.includes('پارەکەم نارد'), false);
check('still no success state', html.includes('alert--ok'), false);

// A transfer already waiting still has its instructions to go back to.
r = await post('/app/subscription', { plan: 'months_6' });
check('a live intent still leads to its own instructions',
      r.location, '/app/subscription/pay');

html = await page('/app/subscription');
check('the primary plan screen does not link into manual payment',
      html.includes('/app/subscription/pay'), false);

r = await post('/app/subscription/sent', { intent: 'not-a-uuid' });
check('a bad intent id is refused', r.location, '/app/subscription/pay?e=errSent');

r = await post('/app/subscription/sent', { intent: INTENT },
               { headers: { origin: 'https://evil.test' } });
check('a cross-origin "I sent it" is refused', r.status, 403);

/* ============================================================
   4. the renewal banners
   ============================================================ */

await setIntent('none');

const banner = async (days, path = '/app') => {
  await setSub(days);
  const out = await page(path);
  const m = out.match(/class="plan-banner plan-banner--([a-z]+)"/);
  return m ? m[1] : null;
};

// Free runs out of nothing, so it is never warned about. Whatever the
// date on the row says, there is no countdown to draw.
await setPlan('free');
for (const days of [15, 10, 3, -1, -5]) {
  check(`free, ${days} days on the row: no banner`, await banner(days), null);
}

// A paid plan runs for months, so it is warned earlier and more often.
await setPlan('year_1');
check('paid, 20 days left: no banner', await banner(20), null);
check('paid, 14 days left: amber', await banner(14), 'soon');
check('paid, 7 days left: amber', await banner(7), 'soon');
check('paid, 3 days left: urgent', await banner(3), 'urgent');
check('paid expiry uses Free tier without a countdown banner', await banner(-1), null);
check('past grace stays Free without a countdown banner', await banner(-5), null);

await setSub(-5);
html = await page('/app');
check('expired account shows permanent Free and a management link', html.includes('data-status="free"') && html.includes('href="/app"'), true);
check('no promise that paying republishes hidden products', html.includes('یەکسەر بگەڕێنەوە'), false);
check('the red banner has no close button',
      /plan-banner--hidden[\s\S]*?plan-banner__close/.test(html), false);

await setSub(-1);
html = await page('/app');
check('grace has no close button either',
      /plan-banner--grace[\s\S]*?plan-banner__close/.test(html), false);

/* ---------- closing one, and it coming back ---------- */

await setSub(10);
html = await page('/app');
check('the amber banner has a close button', html.includes('plan-banner__close'), true);
check('and it posts the kind it is closing',
      /name="kind" value="soon"/.test(html), true);

await resetCalls();
r = await post('/app/banner/dismiss', { kind: 'soon' });
check('closing it redirects back to the dashboard', r.location, '/app');

writes = await getWrites();
check('the dismissal is stored against the shop',
      writes.some((w) => w.table === 'plan_banner_dismissals'), true);
check('and it records when, not that it is gone for good',
      Boolean(writes.find((w) => w.table === 'plan_banner_dismissals')?.body.dismissed_at), true);

check('once closed, the banner is gone', await banner(10), null);

// Never "never again": it comes back on its own.
await setDismissed('soon', 4);
check('three days later it is back', await banner(10), 'soon');

// The urgent one is its own banner and its own cooldown.
await setDismissed('reset', 0);
await setDismissed('soon', 0);
check('closing the amber one does not silence the urgent one',
      await banner(3), 'urgent');

await setDismissed('urgent', 0);
check('the urgent one closes too', await banner(3), null);
await setDismissed('urgent', 1.5);
check('and is back the next day', await banner(3), 'urgent');

// A dismissal can never hide the red ones.
await setDismissed('soon', 0);
await setDismissed('urgent', 0);
check('stored dismissal cannot create a countdown for Free', await banner(-1), null);
check('Free still has no countdown after grace', await banner(-5), null);
await setDismissed('reset', 0);

r = await post('/app/banner/dismiss', { kind: 'grace' });
check('a red banner cannot be dismissed through the endpoint either', r.location, '/app');
await resetCalls();
await post('/app/banner/dismiss', { kind: 'grace' });
check('and nothing is written for it',
      (await getWrites()).some((w) => w.table === 'plan_banner_dismissals'), false);

r = await post('/app/banner/dismiss', { kind: 'soon' },
               { headers: { origin: 'https://evil.test' } });
check('a cross-origin dismissal is refused', r.status, 403);

/* ---------- Account has one summary, not a second banner ---------- */

await setSub(10);
html = await page('/app');
check('the existing owner banner is preserved once',
      (html.match(/class="plan-banner /g) || []).length, 1);
check('Account keeps its subscription summary without a duplicate banner',
      html.slice(html.indexOf('id="account-settings"')).includes('plan-banner'), false);

/* ============================================================
   4b. never on a page a customer can see
   ============================================================

   The public shop page and the product pages are edge-cached and are
   served to everybody, so a seller's billing state must not appear on
   them at all — not as a banner, not as a hidden element, not as a
   data attribute.
*/

await setSub(-5);   // the loudest possible state

for (const [name, path] of [
  ['the public shop page', '/@nafin-boutique'],
  ['a product page', '/@nafin-boutique/p/bbbbbbbb-1111-4111-8111-111111111111'],
]) {
  // Signed in as the shop's own owner: the hardest case, because the
  // session that would render a banner is present.
  const asOwner = await page(path);
  const asVisitor = await fetch(`${APP}${path}`).then((res) => res.text());

  check(`${name}: no banner for the owner`, asOwner.includes('plan-banner'), false);
  check(`${name}: no banner for a customer`, asVisitor.includes('plan-banner'), false);
  check(`${name}: no plan state leaks`, /data-plan-state|پارەدان/.test(asVisitor), false);
  // Edge-cached: it has to be the same bytes whoever asks.
  check(`${name}: identical for both`, asOwner === asVisitor, true);
}

await setSub(20);

/* ============================================================
   4c. five products on the Free plan
   ============================================================ */

await setPlan('free');
await setProducts(2);

// A Free seller meets the plan gate on the way in, every time. The
// parameter is what they come back through once they have chosen to
// carry on for nothing; it grants nothing on its own.
html = await page('/app/new?plan=free');
check('the form says how many slots are left',
      html.includes(`3 لە ${FREE_PRODUCT_LIMIT}`), true);
check('and the form is there to use', html.includes('id="product-form"'), true);

await setProducts(FREE_PRODUCT_LIMIT);
html = await page('/app/new?plan=free');
check('a full shop gets the plan screen, not a form',
      html.includes('id="product-form"'), false);
check('which says the plan is full', html.includes('billing--gate'), true);
check('and links to the plans, rather than only refusing',
      html.includes('/app/subscription/checkout'), true);

// Posting anyway is refused the same way.
const img = (n) => ({
  card: `products/aaaaaaaa-1111-4111-8111-111111111111/bbbbbbbb-1111-4111-8111-111111111111/${n}-card.webp`,
  full: `products/aaaaaaaa-1111-4111-8111-111111111111/bbbbbbbb-1111-4111-8111-111111111111/${n}-full.webp`,
});
const publish = () => fetch(`${APP}/app/new`, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: COOKIE, origin: APP,
             'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    draft_id: 'bbbbbbbb-1111-4111-8111-111111111111',
    images: JSON.stringify([img(1)]), title: 'کراسی کوردی', price: '25000',
  }),
}).then(async (res) => ({ status: res.status, html: await res.text() }));

let out = await publish();
check('publishing over the limit is refused', out.status, 200);
check('with the same screen that links to the plans',
      out.html.includes('billing--gate'), true);

// Paid plans are unlimited, whatever the count.
await setPlan('year_1');
await setProducts(40);
html = await page('/app/new');
check('a paid shop with 40 products still gets the form',
      html.includes('id="product-form"'), true);
check('and is told nothing about slots', html.includes('publish-free-left'), false);

out = await publish();
check('and can publish', out.status, 303);

await setPlan('free');
await setProducts(0);

/* ============================================================
   4d. six months then the recommended year, selected by default
   ============================================================ */

html = await page('/app/subscription');
const yearAt = html.indexOf('data-plan="year_1"');
const sixAt = html.indexOf('data-plan="months_6"');

check('the six-month card comes before the year', sixAt < yearAt, true);
check('the year is selected by default', /name="plan" value="year_1" checked/.test(html), true);
check('there are exactly two commercial choices', (html.match(/type="radio" name="plan"/g) || []).length, 2);
check('free is not a selectable card',
      /class="plan[^"]*"[^>]*data-plan="trial"/.test(html), false);
// Nothing here sells a free month any more: Free is not something a
// seller buys or starts, it is where they already are.
check('and no free month is offered on the plans screen',
      /\d+\s*ڕۆژ بەخۆڕایی/.test(html), false);

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
check('the row shows the amount', html.includes(priced('months_6')), true);
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
