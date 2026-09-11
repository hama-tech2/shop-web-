/**
 * Shop Web — the trial is chosen, not given.
 *
 * A new seller can sign up, name their shop, add a number and a logo
 * and never spend anything. The month starts when they say it does, in
 * front of their first product, and it starts once per account for as
 * long as the account exists.
 *
 * What is being pinned here is the Worker's half: which screen a seller
 * meets, and that looking at it changes nothing. The database's half —
 * the one-time guard, the 30 days, the refusals — is
 * scripts/trial-db-test.sql, because that is where they are decided.
 *
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/trial-gate-test.mjs
 */

import { PLANS, TRIAL_DAYS, TRIAL_PRODUCT_LIMIT } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const COOKIE = 'sb-access=TEST';

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const control = (path) => fetch(`${STUB}${path}`).then((r) => r.json());
const writes = () => fetch(`${STUB}/__writes`).then((r) => r.json());
const page = (path) => fetch(`${APP}${path}`, { headers: { cookie: COOKIE } }).then((r) => r.text());

async function post(path, fields) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: COOKIE, origin: APP, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields || {}),
  });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

/** A shop that has just been created: no plan, trial untouched. */
async function fresh() {
  await control('/__mode/shop');
  await control('/__rows/1');
  await control('/__admin/0');
  await control('/__intent/none');
  await control('/__products/0');
  await control('/__dismissed/reset/0');
  await control('/__plan/none');
  await control('/__sub/0');
  await control('/__trial/0');
  await control('/__calls/reset');
}

/* ============================================================
   1. signing up spends nothing
   ============================================================ */

await fresh();

const account = await page('/app');
check('the account card says there is no plan yet', account.includes('هێشتا پلانێکت نییە'));
check('and shows it as a blocked state', account.includes('data-level="blocked"'));
check('with a way to the plans', account.includes('id="settings-subscription"'));
check('no trial was started by opening the app',
  (await writes()).some((w) => w.table === 'rpc/start_trial'), false);

// The shop itself is still entirely editable.
const profile = await page('/app/profile');
check('the profile screen still works with no plan', profile.includes('<form'));
const saved = await post('/app/profile', { name: 'دوکانی نافین', whatsapp: '07510000002', city: 'erbil' });
check('and still saves', saved.status, 303);
check('saving a profile started no trial',
  (await writes()).some((w) => w.table === 'rpc/start_trial'), false);

/* ============================================================
   2. the first product is where the choice is made
   ============================================================ */

await control('/__calls/reset');
const gate = await page('/app/new');
check('Add Product shows the access screen, not the form',
  gate.includes('billing--gate') && !gate.includes('id="product-form"'));
check('the free month is offered', gate.includes('id="start-trial"'));
check('for 30 days', gate.includes(String(TRIAL_DAYS)));
check('and says it is once per account', gate.includes('تەنها یەک جار'));
check('both paid plans are offered',
  PLANS.every((p) => gate.includes(String(p.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ','))));
check('the year keeps its badge', gate.includes('billing-best'));
check('the paid options go to Wayl checkout',
  (gate.match(/action="\/app\/subscription\/checkout"/g) || []).length, 2);
check('there is no FIB or SuperQi chooser here',
  !gate.includes('SuperQi') && !gate.includes('billing-methods'));
check('looking at the screen started nothing',
  (await writes()).some((w) => w.table === 'rpc/start_trial'), false);

const blockedPost = await post('/app/new', { draft_id: crypto.randomUUID(), title: 'x', price: '1000' });
check('posting a product with no plan gets the same screen',
  blockedPost.body.includes('billing--gate'));
check('and wrote no product', (await writes()).some((w) => w.table === 'products'), false);

/* ============================================================
   3. starting it, once
   ============================================================ */

const started = await post('/app/subscription/trial', {});
check('starting the trial sends the seller to the product form',
  [started.status, started.location], [303, '/app/new']);
check('the trial was started on the server',
  (await writes()).some((w) => w.table === 'rpc/start_trial'));

const form = await page('/app/new');
check('the form is now the screen', form.includes('publish-page') && !form.includes('billing--gate'));

const again = await post('/app/subscription/trial', {});
check('a second start is refused by the server',
  [again.status, again.location], [303, '/app/subscription/start?e=errTrialUsed']);

// A different browser, a new session, a shop made again: same answer,
// because the guard is a row against the account, not a cookie.
await control('/__plan/none');
await control('/__sub/0');
const gateAfter = await page('/app/subscription/start');
check('the access screen now says the trial is spent',
  gateAfter.includes('بەکارهێنراوە') && !gateAfter.includes('id="start-trial"'));
const thirdTry = await post('/app/subscription/trial', {});
check('and starting it anyway is still refused',
  thirdTry.location, '/app/subscription/start?e=errTrialUsed');
check('the paid plans are still offered to them',
  gateAfter.includes('/app/subscription/checkout'));

/* ============================================================
   4. while it runs, and after
   ============================================================ */

await control('/__plan/trial');
await control('/__sub/20');
await control('/__products/0');
check('a running trial reaches the form', (await page('/app/new')).includes('publish-page'));

await control('/__products/5');
const full = await page('/app/new');
check(`the trial still stops at ${TRIAL_PRODUCT_LIMIT} products`,
  full.includes('trial-limit') || full.includes('بەرهەم'));
check('a full trial is not the no-plan screen', full.includes('billing--gate'), false);

await control('/__products/0');
await control('/__sub/-1');
const expired = await page('/app/new');
check('an expired trial is back to the access screen', expired.includes('billing--gate'));
check('and its trial button is gone', expired.includes('id="start-trial"'), false);
const expiredPost = await post('/app/new', { draft_id: crypto.randomUUID(), title: 'x', price: '1000' });
check('posting after the trial ends is refused', expiredPost.body.includes('billing--gate'));

/* ============================================================
   5. what the account card says as the end comes
   ============================================================ */

for (const [days, level, phrase] of [
  [20, null, null],
  [7, 'soon', 'ڕۆژ لە پلانەکەت ماوە'],
  [3, 'urgent', 'تەنها'],
  [1, 'urgent', 'سبەی'],
  [-1, 'blocked', 'تەواو بووە'],
]) {
  await control('/__plan/year_1');
  await control(`/__sub/${days}`);
  const html = await page('/app');
  const found = html.match(/id="settings-plan-warning" data-level="([a-z]+)"[^>]*>([^<]*)</);
  check(`${days} days left: ${level ?? 'no warning'}`, found?.[1] ?? null, level);
  if (phrase) check(`${days} days left says so`, found?.[2]?.includes(phrase));
  if (level) check(`${days} days left offers renewal`, html.includes('نوێکردنەوەی پلان'));
}

// Nothing about any of this renews by itself, and nothing says it does.
await control('/__sub/20');
const plans = await page('/app/subscription');
check('no screen claims a subscription renews itself',
  /خۆکار.{0,40}نوێ|auto.?renew/i.test(plans + (await page('/app'))), false);

/* ============================================================
   6. the owner's free grant
   ============================================================ */

await control('/__admin/0');
const notAdmin = await fetch(`${APP}/admin/shops/aaaaaaaa-1111-4111-8111-111111111111/grant`,
  { headers: { cookie: COOKIE }, redirect: 'manual' });
check('a seller cannot open the grant screen', notAdmin.status, 404);

await control('/__admin/1');
const grantForm = await page('/admin/shops/aaaaaaaa-1111-4111-8111-111111111111/grant');
for (const plan of ['month_1', 'months_6', 'year_1']) {
  check(`the owner can grant ${plan}`, grantForm.includes(`value="${plan}"`));
}
check('a grant is not presented as a payment', grantForm.includes('وەک پارەدان تۆمار ناکرێت'));
const badPlan = await post('/admin/shops/aaaaaaaa-1111-4111-8111-111111111111/grant',
  { plan: 'forever', reason: 'because', step: 'review' });
check('an invented plan is refused', badPlan.body.includes('پلانێک هەڵبژێرە'));
await control('/__admin/0');

/* ============================================================
   7. the access screen on a phone
   ============================================================

   Only with CHROME set, so the suite stays a fast node run by default:
   CHROME=/path/to/chrome node scripts/trial-gate-test.mjs
   ============================================================ */

if (process.env.CHROME) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: 'sb-access', value: 'TEST', url: APP }]);
    const view = await ctx.newPage();
    const errors = [];
    view.on('pageerror', (e) => errors.push(e.message));

    await control('/__plan/none');
    await control('/__sub/0');
    await control('/__trial/0');

    for (const width of [320, 360, 390, 430]) {
      await view.setViewportSize({ width, height: 844 });
      await view.goto(`${APP}/app/new`);
      check(`${width}: the access screen is what loads`,
        await view.locator('.billing--gate').count(), 1);
      check(`${width}: RTL and nothing runs off the side`,
        await view.evaluate(() => document.documentElement.dir === 'rtl'
          && document.documentElement.scrollWidth <= innerWidth));
      check(`${width}: every choice is a real tap target`,
        await view.locator('.gate-plan').evaluateAll(
          (els) => els.length === 3 && els.every((el) => el.getBoundingClientRect().height >= 44)));
      check(`${width}: the free month is first`,
        await view.locator('.gate-plan').first().getAttribute('data-plan') === 'trial');
    }

    // The warning line, at the width most sellers are on.
    await view.setViewportSize({ width: 390, height: 844 });
    for (const [days, level] of [[7, 'soon'], [3, 'urgent'], [1, 'urgent'], [-1, 'blocked']]) {
      await control('/__plan/year_1');
      await control(`/__sub/${days}`);
      // The plan card lives in the account panel, which is a :target
      // section: without the fragment it is rendered but not shown.
      // A changing query as well, so each state is a real navigation
      // rather than a same-document jump to the fragment.
      await view.goto(`${APP}/app?w=${days}#account-settings`);
      check(`the ${days}-day warning is visible and legible`,
        await view.locator('#settings-plan-warning').evaluate((el, want) => {
          const box = el.getBoundingClientRect();
          return el.dataset.level === want && box.height > 0
            && parseFloat(getComputedStyle(el).fontSize) >= 13;
        }, level));
    }
    check('no script errors on any of it', errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
}

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}` +
    (r.pass ? '' : `\n     got ${JSON.stringify(r.got)} want ${JSON.stringify(r.want)}`));
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
