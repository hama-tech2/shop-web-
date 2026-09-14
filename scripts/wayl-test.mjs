/**
 * Shop Web — Wayl hosted checkout, end to end.
 *
 * What is being pinned, in one sentence: a plan moves only when this
 * server has asked Wayl and Wayl has said the payment is complete.
 *
 * So the tests are mostly refusals — a webhook with a bad signature, a
 * replayed event, an amount that does not match the plan price, a
 * redirect carrying `status=success`, a status Wayl has never sent
 * before. None of them may grant a month, and none of them may tell a
 * seller their payment failed either.
 *
 * Drives the real Worker against scripts/stub-supabase.mjs, which also
 * stands in for api.thewayl.com — no test can reach the real API and
 * no test run can create a real charge.
 *
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\nSUPABASE_SERVICE_ROLE_KEY="stub-service-key"\nWAYL_API_BASE="http://127.0.0.1:8899"\nWAYL_API_TOKEN="stub-wayl-token"\nWAYL_ENV="test"\nPAYMENTS_ENABLED="true"\nWAYL_RETURN_URL="https://staging.bazaro.test/app/subscription/result"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/wayl-test.mjs
 *
 * With PAYMENTS_ENABLED="false" in .dev.vars, run it as:
 *   node scripts/wayl-test.mjs --payments-off
 */

import { createHmac } from 'node:crypto';
import { mapStatus, signatureValid } from '../worker/wayl.js';
import { returnUrl } from '../worker/routes/payment.js';
import { FIB_NUMBER, PLANS } from '../worker/config.js';

/**
 * The prices, read from config rather than written here.
 *
 * The database is authoritative and config carries the same two
 * numbers for display; scripts/plan-limits-test.mjs is what proves
 * they agree. Repeating them a third time in this file only meant
 * that changing a price broke twenty assertions about something else.
 */
const YEAR = PLANS.find((p) => p.key === 'year_1').amount;
const SIX = PLANS.find((p) => p.key === 'months_6').amount;
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const APP = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8810';
const STUB = process.argv.filter((a) => a.startsWith('http'))[1] || 'http://127.0.0.1:8899';
const PAYMENTS_OFF = process.argv.includes('--payments-off');

const COOKIE = 'sb-access=TEST';
/** What .dev.vars sets. Deliberately not the host the tests talk to. */
/**
 * The return URL the running Worker is configured with.
 *
 * Read from the environment rather than fixed here, because this file
 * asserts that the Worker uses its CONFIGURED URL and never the request
 * host — and that assertion has to keep holding when the configured URL
 * changes, which is exactly what happens on the way to production.
 * The unit cases below still pin the validation rules against literals.
 */
const RETURN_URL = process.env.WAYL_RETURN_URL
  || 'https://shop-web.mahmadmajed149.workers.dev/app/subscription/result';
const STAGING = 'https://staging.bazaro.test/app/subscription/result';
const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const control = (path) => fetch(`${STUB}${path}`).then((r) => r.json());
const waylState = () => control('/__wayl');

const page = (path) => fetch(`${APP}${path}`, { headers: { cookie: COOKIE } }).then((r) => r.text());

async function post(path, fields) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: COOKIE, origin: APP,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields || {}),
  });
  return { status: res.status, location: res.headers.get('location') };
}

async function statusOf(ref) {
  const res = await fetch(`${APP}/app/subscription/status?ref=${encodeURIComponent(ref)}`, {
    headers: { cookie: COOKIE, accept: 'application/json' },
    redirect: 'manual',
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/** A webhook exactly as Wayl would send it, signed with this payment's secret. */
async function webhook(intentId, body, { secret, signature, header = 'x-wayl-signature-256' } = {}) {
  const raw = JSON.stringify(body);
  const sent = signature ?? createHmac('sha256', secret).update(raw).digest('hex');
  const res = await fetch(`${APP}/webhooks/wayl/${intentId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [header]: sent },
    body: raw,
  });
  return { status: res.status, text: await res.text() };
}

/* ============================================================
   0. the parts that need no server
   ============================================================ */

for (const [raw, want] of [
  // Documented and seen on a real link: a new one says "Created".
  ['Created', 'pending'], ['created', 'pending'],
  ['paid', 'paid'], ['PAID', 'paid'], ['completed', 'paid'],
  ['cancelled', 'cancelled'], ['failed', 'failed'],
  // The whole point: a word Wayl has not shown us yet is not a verdict.
  ['awaiting_something', 'pending'], ['', 'pending'], [null, 'pending'], [undefined, 'pending'],
  ['Refunded', 'pending'], ['3DS_REQUIRED', 'pending'], ['{}', 'pending'],
]) {
  check(`status "${raw}" maps to ${want}`, mapStatus(raw), want);
}

// Where Wayl sends a paying seller back to is configuration, never the
// request: a Worker builds new URL(request.url) from the Host header,
// and the caller owns that header.
for (const [env, want] of [
  [{}, null],
  [{ WAYL_RETURN_URL: '' }, null],
  [{ WAYL_RETURN_URL: 'not a url' }, null],
  [{ WAYL_RETURN_URL: 'http://evil.example/app/subscription/result' }, null],
  [{ WAYL_RETURN_URL: 'https://staging.bazaro.test/' }, null],
  [{ WAYL_RETURN_URL: STAGING }, STAGING],
  [{ WAYL_RETURN_URL: STAGING + '/?carried=1' }, STAGING],
  [{ WAYL_RETURN_URL: RETURN_URL }, RETURN_URL],
  [{ WAYL_RETURN_URL: RETURN_URL + '/?carried=1' }, RETURN_URL],
  [{ WAYL_RETURN_URL: 'http://127.0.0.1:8810/app/subscription/result' },
   'http://127.0.0.1:8810/app/subscription/result'],
]) {
  check(`return URL ${JSON.stringify(env.WAYL_RETURN_URL ?? null)}`, returnUrl(env), want);
}

const SECRET = 'a'.repeat(64);
const BODY = '{"referenceId":"BZ-TEST","status":"paid"}';
const hexMac = createHmac('sha256', SECRET).update(BODY).digest('hex');
const b64Mac = createHmac('sha256', SECRET).update(BODY).digest('base64');
// Wayl documents x-wayl-signature-256 as HMAC-SHA256, hex.
check('hex signature accepted', await signatureValid(SECRET, BODY, hexMac));
check('the same hex in capitals accepted', await signatureValid(SECRET, BODY, hexMac.toUpperCase()));
check('sha256= prefix accepted', await signatureValid(SECRET, BODY, `sha256=${hexMac}`));
check('base64 is not the documented encoding', await signatureValid(SECRET, BODY, b64Mac), false);
check('a hex string of the wrong length is not a signature',
  await signatureValid(SECRET, BODY, hexMac.slice(0, 63)), false);
check('another secret rejected', await signatureValid('b'.repeat(64), BODY, hexMac), false);
check('a changed body rejected', await signatureValid(SECRET, `${BODY} `, hexMac), false);
check('no signature rejected', await signatureValid(SECRET, BODY, ''), false);
check('no secret rejected', await signatureValid('', BODY, hexMac), false);

/* ============================================================
   1. the state every run starts from
   ============================================================ */

await control('/__mode/shop');
await control('/__rows/1');
await control('/__admin/0');
await control('/__plan/trial');
await control('/__sub/20');
await control('/__intent/none');
await control('/__wayl/reset');
await control('/__calls/reset');

/* ============================================================
   2. the switch
   ============================================================ */

if (PAYMENTS_OFF) {
  const plans = await page('/app/subscription');
  check('the plan form does not post while payments are off',
    plans.includes('method="get"') && !plans.includes('/app/subscription/checkout'));
  check('the screen says online payment is not on', plans.includes('چالاک نەکراوە'));

  const blocked = await post('/app/subscription/checkout', { plan: 'year_1' });
  check('checkout refuses', [blocked.status, blocked.location],
    [303, '/app/subscription?e=errUnavailable']);
  check('no Wayl link was created', (await waylState()).created.length, 0);

  report();
}

/* ============================================================
   3. the seller pays
   ============================================================ */

const plans = await page('/app/subscription');
check('the plan form posts to checkout',
  plans.includes('action="/app/subscription/checkout"') && plans.includes('method="post"'));
check('both prices are still server-side',
  plans.includes(grouped(YEAR)) && plans.includes(grouped(SIX)));
check('no payment method is offered here',
  !plans.includes('payment-method-form') && !plans.includes('SuperQi'));
// The two dormant flows. Both still exist in the tree on purpose; what
// matters is that nothing in the active UI leads a seller to either.
check('the FIB/SuperQi chooser is not on the screen or loaded by it',
  !plans.includes('billing-methods') && !plans.includes('/js/subscription.js')
  && !plans.includes('name="method"'));
check('nothing links to the manual transfer screen',
  !plans.includes('/app/subscription/pay') && !plans.includes('/app/subscription/sent'));
check('the owner\'s FIB number is nowhere on it', !plans.includes(FIB_NUMBER));

const started = await post('/app/subscription/checkout', {
  plan: 'year_1',
  // A crafted post naming its own price. The Worker never reads it.
  amount: '1', total: '1', shop_id: '99999999-9999-4999-8999-999999999999',
});
let state = await waylState();
const link = state.created[0];

// The URL is not written here: it is whatever Wayl returned and the
// database stored, and the redirect must be exactly that. Wayl's link
// shape is Wayl's to change.
check('the seller is sent to Wayl', [started.status, started.location],
  [303, state.intent?.checkout_url]);
check('and that URL is a real https checkout',
  /^https:\/\/checkout\./.test(started.location || ''));
check('exactly one link was created', state.created.length, 1);
check('the amount is the plan price', link?.total, YEAR);
// Wayl refuses any other shape, and did: {name, quantity, price} came
// back 422 naming label, amount and type.
check('the line item is the shape Wayl requires',
  link?.lineItem, [{ label: link?.lineItem?.[0]?.label, amount: YEAR, type: 'increase' }]);
check('the line item is labelled with the plan and the shop',
  typeof link?.lineItem?.[0]?.label === 'string' && link.lineItem[0].label.length > 0);
check('IQD', link?.currency, 'IQD');
check('the test environment', link?.env, 'test');
check('a fresh reference', /^BZ-[0-9A-Z]+-[0-9A-F]+$/.test(link?.referenceId || ''));
check('the webhook is per payment',
  link?.webhookUrl?.endsWith(`/webhooks/wayl/${state.intent.id}`));
check('the webhook secret is 32 random bytes', /^[0-9a-f]{64}$/.test(link?.webhookSecret || ''));
check('the return URL carries only the reference',
  link?.redirectionUrl, `${RETURN_URL}?ref=${link?.referenceId}`);
// The request reached the Worker on 127.0.0.1:8810. Neither URL says so.
check('the return URL is the configured one, not the request host',
  link?.redirectionUrl?.startsWith(RETURN_URL) && !link?.redirectionUrl?.includes('127.0.0.1'));
check('the webhook URL is on the configured origin too',
  link?.webhookUrl?.startsWith(`${new URL(RETURN_URL).origin}/webhooks/wayl/`)
  && !link?.webhookUrl?.includes('127.0.0.1'));
check('the intent was stored against this shop',
  [state.intent.shop_id, state.intent.plan, Number(state.intent.amount), state.intent.status],
  ['aaaaaaaa-1111-4111-8111-111111111111', 'year_1', YEAR, 'open']);

const REF = link.referenceId;
const INTENT = state.intent.id;
const SIGNING = link.webhookSecret;

/* the secret must never come back out */
const resultChecking = await page(`/app/subscription/result?ref=${REF}`);
check('the webhook secret is in no page the seller sees',
  !resultChecking.includes(SIGNING) && !plans.includes(SIGNING));
check('the API token is in no page the seller sees',
  !resultChecking.includes('stub-wayl-token'));

/* tapping Pay again is not a second payment */
const again = await post('/app/subscription/checkout', { plan: 'year_1' });
state = await waylState();
check('a second tap reuses the same checkout',
  [state.created.length, again.location], [1, state.intent?.checkout_url]);

await control('/__wayl/busy/1');
const busy = await post('/app/subscription/checkout', { plan: 'months_6' });
check('the per-shop rate limit sends the seller back, not to Wayl',
  [busy.status, busy.location, (await waylState()).created.length],
  [303, '/app/subscription?e=errBusy', 1]);
await control('/__wayl/busy/0');

const badPlan = await post('/app/subscription/checkout', { plan: 'forever' });
check('an unknown plan buys nothing',
  [badPlan.location, (await waylState()).created.length], ['/app/subscription?e=errPlan', 1]);

/* ============================================================
   4. coming back from Wayl proves nothing
   ============================================================ */

check('the result page is checking, not success',
  resultChecking.includes('data-result-state="checking"')
  && !resultChecking.includes('data-result-state="success"'));
check('the page carries the reference and the poller',
  resultChecking.includes(`data-result-ref="${REF}"`)
  && resultChecking.includes('/js/payment-result.js'));
check('there is a calm message for a slow payment',
  resultChecking.includes('payment-result-slow'));
check('the result page offers no method, no manual flow, no FIB number',
  !resultChecking.includes('billing-methods') && !resultChecking.includes('/app/subscription/pay')
  && !resultChecking.includes(FIB_NUMBER) && !resultChecking.includes('/js/subscription.js'));

// Wayl replaces our query with its own and adds a trailing slash.
const waylReturn = await page(`/app/subscription/result/?referenceId=${REF}&orderid=lnk_1`);
check('the seller comes back on Wayl\'s own query and is found',
  waylReturn.includes('data-result-state="checking"') && waylReturn.includes(`data-result-ref="${REF}"`));
const created = await statusOf(REF);
check('a created link is checking, not paid and not failed', created.body.state, 'checking');
check('and reports no payment method yet', created.body.paymentMethod, null);
check('coming back granted nothing', (await waylState()).activations, 0);

// orderid is Wayl's link id. It decides nothing, so a wrong one changes
// nothing, and a reference that is not this shop's is still not found.
const junkOrder = await page(`/app/subscription/result/?referenceId=${REF}&orderid=not-our-link`);
check('orderid is ignored', junkOrder.includes('data-result-state="checking"'));
const foreignReturn = await fetch(`${APP}/app/subscription/result/?referenceId=BZ-NOT-MINE-0001&orderid=lnk_1`,
  { headers: { cookie: COOKIE }, redirect: 'manual' });
check('another shop\'s reference is sent back to the plans',
  [foreignReturn.status, foreignReturn.headers.get('location')], [303, '/app/subscription']);

const lying = await page(`/app/subscription/result?ref=${REF}&status=success&paid=true&verified=1`);
check('a redirect parameter cannot make it success',
  lying.includes('data-result-state="checking"') && !lying.includes('چالاک تا'));

const noRef = await fetch(`${APP}/app/subscription/result`, {
  headers: { cookie: COOKIE }, redirect: 'manual',
});
check('no reference, no result page',
  [noRef.status, noRef.headers.get('location'), (await noRef.text()).includes('payment-result')],
  [303, '/app/subscription', false]);

const byWaylName = await fetch(`${APP}/app/subscription/status?referenceId=${encodeURIComponent(REF)}`,
  { headers: { cookie: COOKIE, accept: 'application/json' }, redirect: 'manual' });
check('the status endpoint reads Wayl\'s parameter name as well',
  (await byWaylName.json()).reference, REF);

const foreign = await statusOf('BZ-SOMEONE-ELSE');
check('another payment’s reference is not found', foreign.status, 404);
check('a malformed reference is not found', (await statusOf('../../etc')).status, 404);

const checking = await statusOf(REF);
check('status is checking', checking.body?.state, 'checking');
check('status returns only what the screen needs',
  Object.keys(checking.body).sort(),
  ['amount', 'expiresAt', 'paymentMethod', 'plan', 'reference', 'state']);
check('no expiry before there is one', checking.body.expiresAt, null);
check('nothing has been granted yet', (await waylState()).activations, 0);

/* ============================================================
   5. what Wayl says, and only what Wayl says
   ============================================================ */

await control('/__wayl/reports/some_new_state_wayl_invented');
check('an unknown status stays checking', (await statusOf(REF)).body.state, 'checking');
check('an unknown status grants nothing', (await waylState()).activations, 0);

await control('/__wayl/reports/paid');
await control('/__wayl/total/1000');
check('a smaller amount is not this payment', (await statusOf(REF)).body.state, 'checking');
check('an amount mismatch grants nothing', (await waylState()).activations, 0);

await control(`/__wayl/total/${YEAR * 10}`);
check('a larger amount is not this payment either', (await statusOf(REF)).body.state, 'checking');

await control(`/__wayl/total/${YEAR}`);
await control('/__wayl/currency/USD');
check('another currency is refused', (await statusOf(REF)).body.state, 'checking');
check('a currency mismatch grants nothing', (await waylState()).activations, 0);
await control('/__wayl/currency/IQD');

await control('/__wayl/reports/cancelled');
check('cancelled is cancelled', (await statusOf(REF)).body.state, 'cancelled');
await control('/__wayl/reports/failed');
check('failed is failed', (await statusOf(REF)).body.state, 'failed');
check('neither granted anything', (await waylState()).activations, 0);

/* ============================================================
   6. the webhook
   ============================================================ */

// Still 'failed' from the section above: a webhook that says otherwise
// is about to be believed by nobody.
const event = { id: 'evt_1', referenceId: REF, status: 'paid' };

const lyingBody = { id: 'evt_lie', referenceId: REF, status: 'paid', total: YEAR };
check('a correctly signed webhook claiming success is accepted',
  (await webhook(INTENT, lyingBody, { secret: SIGNING })).status, 200);
check('but the body claiming success granted nothing', (await waylState()).activations, 0);

/* Wayl's link id is not an event id. Two different deliveries that
   both carry it must both be taken; only an identical body is a
   replay. This is what stops a second webhook for one payment being
   swallowed as a duplicate. */
const seen = async () => (await waylState()).events.length;
let before = await seen();
check('a body carrying only the link id is taken',
  (await webhook(INTENT, { id: 'lnk_1', referenceId: REF, status: 'processing' },
    { secret: SIGNING })).status, 200);
check('a different body with the same link id is taken too',
  (await webhook(INTENT, { id: 'lnk_1', referenceId: REF, status: 'pending' },
    { secret: SIGNING })).status, 200);
check('two deliveries, two events: a link id never deduplicates',
  (await seen()) - before, 2);

before = await seen();
check('a real event id is taken',
  (await webhook(INTENT, { eventId: 'evt_real', referenceId: REF, status: 'processing' },
    { secret: SIGNING })).status, 200);
check('the same event id again is taken and ignored',
  (await webhook(INTENT, { eventId: 'evt_real', referenceId: REF, status: 'pending' },
    { secret: SIGNING })).status, 200);
check('two deliveries, one event: a real event id does deduplicate',
  (await seen()) - before, 1);
check('none of them granted anything', (await waylState()).activations, 0);

/* a delivery with no event id of its own is still deduplicated */
const anonymous = { referenceId: REF, status: 'processing' };
before = await seen();
check('a body with no event id is taken',
  (await webhook(INTENT, anonymous, { secret: SIGNING })).status, 200);
check('the same body again is taken and ignored',
  (await webhook(INTENT, anonymous, { secret: SIGNING })).status, 200);
check('the identical body is one event, not two', (await seen()) - before, 1);
check('none of them granted anything', (await waylState()).activations, 0);

await control('/__wayl/reports/paid');

check('a wrong signature is the ordinary 404',
  (await webhook(INTENT, event, { signature: 'f'.repeat(64) })).status, 404);
check('a signature from another secret is a 404',
  (await webhook(INTENT, event, { secret: 'b'.repeat(64) })).status, 404);
check('no signature at all is a 404',
  (await webhook(INTENT, event, { signature: '' })).status, 404);
check('a signature in the wrong header is a 404',
  (await webhook(INTENT, event, { secret: SIGNING, header: 'x-signature' })).status, 404);
check('an unknown intent is a 404',
  (await webhook('cccccccc-9999-4999-8999-999999999999', event, { secret: SIGNING })).status, 404);
check('a rejected webhook granted nothing', (await waylState()).activations, 0);

const bodyChanged = JSON.stringify({ ...event, status: 'paid', total: 1 });
const staleSignature = createHmac('sha256', SIGNING).update(JSON.stringify(event)).digest('hex');
const tampered = await fetch(`${APP}/webhooks/wayl/${INTENT}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-wayl-signature-256': staleSignature },
  body: bodyChanged,
});
check('a body edited after signing is a 404', tampered.status, 404);
check('the tampered body granted nothing', (await waylState()).activations, 0);

const wrongRef = await webhook(INTENT, { ...event, id: 'evt_wrong', referenceId: 'BZ-NOT-MINE' },
  { secret: SIGNING });
check('a signed webhook for another reference does nothing',
  [wrongRef.status, (await waylState()).activations], [200, 0]);

/* the real one */
const accepted = await webhook(INTENT, event, { secret: SIGNING });
state = await waylState();
check('a signed webhook is accepted', accepted.status, 200);
check('the plan was granted exactly once', state.activations, 1);
check('the payment is marked activated', Boolean(state.intent.activated_at));
check('Wayl’s own method was stored', state.intent.payment_method, 'FIB');

/* and again, and again */
check('the same event replayed is a 200 and nothing else',
  (await webhook(INTENT, event, { secret: SIGNING })).status, 200);
check('a replay grants nothing', (await waylState()).activations, 1);
check('a new event on a paid payment is a 200',
  (await webhook(INTENT, { ...event, id: 'evt_2' }, { secret: SIGNING })).status, 200);
check('a second event grants nothing either', (await waylState()).activations, 1);

/* ============================================================
   7. what the seller is finally told
   ============================================================ */

const paid = await statusOf(REF);
check('status is success', paid.body.state, 'success');
check('the expiry is the activated one', Boolean(paid.body.expiresAt));
check('the method is the one Wayl supplied', paid.body.paymentMethod, 'FIB');
check('polling after success grants nothing', (await waylState()).activations, 1);
check('the amount is still the plan price', paid.body.amount, YEAR);

const success = await page(`/app/subscription/result?ref=${REF}`);
check('the result page is success', success.includes('data-result-state="success"'));
check('success shows the activated plan', success.includes('چالاک تا'));
check('success stops polling',
  !success.includes('data-result-ref') && !success.includes('/js/payment-result.js'));
check('success links to the shop', success.includes('/@nafin-boutique'));
check('nothing from Wayl leaks into the page',
  !success.includes('stub-wayl-token') && !success.includes(SIGNING));

report();

function report() {
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}` +
      (r.pass ? '' : `\n     got ${JSON.stringify(r.got)} want ${JSON.stringify(r.want)}`));
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
