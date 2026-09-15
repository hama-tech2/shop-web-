/**
 * Shop Web — the Free plan is where every shop already is.
 *
 * Nothing is started and nothing expires. A shop that has never paid
 * may hold five products, one image each, for as long as the account
 * exists; a paid shop is not counted at all, and when a paid plan runs
 * out the shop lands back on Free with everything it posted still
 * there.
 *
 * What is pinned here is the Worker's half: which screen a seller
 * meets, that looking at it writes nothing, and that the refusals the
 * database raises come back as a screen with a way out of it. The
 * database's half — the trigger, the per-tier image cap, the fallback
 * on expiry — is scripts/free-plan-db-test.sql, because that is where
 * they are decided.
 *
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/free-plan-test.mjs
 */

import { FREE_IMAGE_LIMIT, FREE_PRODUCT_LIMIT, PLANS, PRODUCT as T } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const COOKIE = 'sb-access=TEST';

const SHOP = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRODUCT_ID = 'bbbbbbbb-1111-4111-8111-111111111111';

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const control = (path) => fetch(`${STUB}${path}`).then((r) => r.json());
const writes = () => fetch(`${STUB}/__writes`).then((r) => r.json());

/**
 * The writes that actually changed something.
 *
 * PostgREST calls a read-only RPC with POST, so subscription_state and
 * product_slots_left show up in the log looking like writes. They are
 * the two questions every one of these screens asks, and counting them
 * would make "this screen writes nothing" impossible to state.
 */
const changes = async () => (await writes()).filter(
  (w) => !/^rpc\/(subscription_state|product_slots_left)$/.test(w.table));
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

/** The R2 keys a product of this shop could legitimately own. */
const gallery = (draft, n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({
  card: `products/${SHOP}/${draft}/${i + 1}-card.webp`,
  full: `products/${SHOP}/${draft}/${i + 1}-full.webp`,
})));

/** Post a product the way the form does, with `n` images on it. */
async function publish(n) {
  const draft = crypto.randomUUID();
  return post('/app/new', {
    draft_id: draft, images: gallery(draft, n), title: 'کراسی کوردی', price: '25000',
  });
}

/** Edit a product the way the form does, with a chosen visibility. */
async function setVisibility(status) {
  return post(`/app/products/${PRODUCT_ID}`, {
    images: gallery(PRODUCT_ID, 1), title: 'کراسی کوردی', price: '25000', status,
  });
}

/** A shop with no payment behind it and `count` products already up. */
async function free(count = 0) {
  await control('/__mode/shop');
  await control('/__rows/1');
  await control('/__admin/0');
  await control('/__intent/none');
  await control('/__dismissed/reset/0');
  await control('/__suspended/0');
  await control('/__plan/free');
  await control('/__sub/0');
  await control(`/__products/${count}`);
  await control('/__calls/reset');
}

/** A shop on a live paid plan. */
async function paid(count = 0, days = 20, plan = 'year_1') {
  await free(count);
  await control(`/__plan/${plan}`);
  await control(`/__sub/${days}`);
  await control('/__calls/reset');
}

/* ============================================================
   1. signing up costs nothing and starts nothing
   ============================================================ */

await free(0);

const account = await page('/app');
check('the account card says the shop is on Free', account.includes('data-status="free"'));
check('with nothing drawn as running out',
  account.includes('id="settings-plan-warning"'), false);
check('and a way to the paid plans', account.includes('id="settings-subscription"'));
check('opening the app started no trial',
  (await writes()).some((w) => w.table === 'rpc/start_trial'), false);

const profile = await page('/app/profile');
check('the profile screen still works with no payment', profile.includes('<form'));
const saved = await post('/app/profile', { name: 'دوکانی نافین', whatsapp: '07510000002', city: 'erbil' });
check('and still saves', saved.status, 303);
check('there is no start_trial call left anywhere in the app',
  (await writes()).some((w) => String(w.table).includes('start_trial')), false);

/* ============================================================
   2. the plan gate, met every time on the way in
   ============================================================ */

await control('/__calls/reset');
const gate = await page('/app/new');
check('Add Product shows the plan screen, not the form',
  gate.includes('billing--gate') && !gate.includes('id="product-form"'));
check('carrying on for nothing is offered', gate.includes('id="start-trial"'));
check('both paid plans are offered',
  PLANS.every((p) => gate.includes(String(p.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ','))));
check('the year keeps its badge', gate.includes('billing-best'));
check('the paid options go to Wayl checkout',
  (gate.match(/action="\/app\/subscription\/checkout"/g) || []).length, 2);
check('there is no FIB or SuperQi chooser here',
  !gate.includes('SuperQi') && !gate.includes('billing-methods'));
check('looking at the screen wrote nothing at all', await changes(), []);

// Choosing Free is a redirect and not a row. The parameter it forwards
// skips the screen; it grants nothing.
const chose = await post('/app/subscription/free', {});
check('choosing Free sends the seller to the form',
  [chose.status, chose.location], [303, '/app/new?plan=free']);
check('and wrote nothing', await changes(), []);
check('the old trial path is the same thing now',
  (await post('/app/subscription/trial', {})).location, '/app/new?plan=free');

const form = await page('/app/new?plan=free');
check('the form is the screen once Free is chosen',
  form.includes('publish-page') && !form.includes('billing--gate'));
check('and it says how much room is left',
  form.includes('publish-free-left') && form.includes(String(FREE_PRODUCT_LIMIT)));

// Coming back without the parameter is the gate again: it is met every
// time, not once.
check('the gate is back on the next visit', (await page('/app/new')).includes('billing--gate'));

/* ============================================================
   3. five products, and the sixth
   ============================================================ */

for (const held of [0, 1, 2, 3, 4]) {
  await free(held);
  check(`with ${held} products the form is reachable`,
    (await page('/app/new?plan=free')).includes('publish-page'));
  const r = await publish(1);
  check(`product ${held + 1} publishes`, r.location === '/app', true);
}

await free(FREE_PRODUCT_LIMIT);
const fullForm = await page('/app/new?plan=free');
check('a full shop never reaches the form', fullForm.includes('publish-page'), false);
check('it is told the plan is full, with a way out',
  fullForm.includes('billing--gate') || fullForm.includes('trial-limit'));

await control('/__calls/reset');
const sixth = await publish(1);
check('the sixth product is refused',
  sixth.body.includes('billing--gate') || sixth.body.includes('trial-limit'));
check('and no product row was written',
  (await writes()).some((w) => w.table === 'products'), false);

// Deleting a product gives the slot back: nothing is spent, only held.
await free(FREE_PRODUCT_LIMIT);
check('full', (await page('/app/new?plan=free')).includes('publish-page'), false);
await control(`/__products/${FREE_PRODUCT_LIMIT - 1}`);
check('deleting one gives the slot back',
  (await page('/app/new?plan=free')).includes('publish-page'));
check('and the next product publishes again', (await publish(1)).location === '/app', true);

// The gate says so too, rather than offering a button that is refused.
await free(FREE_PRODUCT_LIMIT);
const fullGate = await page('/app/subscription/start');
check('a full shop is not offered the Free button', fullGate.includes('id="start-trial"'), false);
check('but the paid plans are still there', fullGate.includes('/app/subscription/checkout'));
const refused = await post('/app/subscription/free', {});
check('and asking for it anyway is refused by the server',
  refused.location, '/app/subscription/start?e=errFreeFull');

/* ============================================================
   4. one image on Free
   ============================================================ */

await free(0);
check(`${FREE_IMAGE_LIMIT} image publishes on Free`, (await publish(1)).location === '/app', true);

await control('/__calls/reset');
const two = await publish(FREE_IMAGE_LIMIT + 1);
check('a second image is refused', two.status, 200);
check('with the reason, not a save error',
  two.body.includes('وێنە') && !two.body.includes('billing--gate'));
check('and nothing was written', (await writes()).some((w) => w.table === 'products'), false);
check('the form comes back filled in', two.body.includes('publish-page'));

/* ============================================================
   5. a paid seller is not counted
   ============================================================ */

await paid(0);
const paidForm = await page('/app/new');
check('a paid seller goes straight to the form, with no gate',
  paidForm.includes('publish-page') && !paidForm.includes('billing--gate'));
check('and is not told about slots', paidForm.includes('publish-free-left'), false);

await paid(FREE_PRODUCT_LIMIT + 3);
check(`${FREE_PRODUCT_LIMIT + 3} products is nothing to a paid seller`,
  (await page('/app/new')).includes('publish-page'));
check('who can still publish', (await publish(1)).location === '/app', true);
check('with more than one image', (await publish(5)).location === '/app', true);

await paid(0);
const gateForPaid = await fetch(`${APP}/app/subscription/start`,
  { headers: { cookie: COOKIE }, redirect: 'manual' });
check('the plan gate is not a screen a paid seller can be stuck on',
  [gateForPaid.status, gateForPaid.headers.get('location')], [303, '/app/new']);
check('and posting Free while paid simply carries on',
  (await post('/app/subscription/free', {})).location, '/app/new');

/* ============================================================
   6. when a paid plan runs out
   ============================================================ */

await paid(FREE_PRODUCT_LIMIT + 3, -1);
const lapsed = await page('/app/new');
check('an expired plan is the Free gate again', lapsed.includes('billing--gate'));
check('it is not offered as a new free month while over the limit',
  lapsed.includes('id="start-trial"'), false);
const lapsedPost = await publish(1);
check('and posting a new product is refused',
  lapsedPost.body.includes('billing--gate') || lapsedPost.body.includes('trial-limit'));

// Nothing was deleted to get there: the shop's own products are still
// the shop's, and its profile is still public. What changed is how many
// of them are up — the database hid the extras, and hidden is a state
// the seller already knows how to undo.
// The seller's own list is /app now, and its grid is fetched from the
// public shop by public/js/owner-profile.js — so "still listed" is a
// property of the shop page, which /app shows the owner's copy of.
const stillThere = await page('/@nafin-boutique');
check('the products already posted are still listed', stillThere.includes('کراسی کوردی'));
check('and the public profile still renders', stillThere.includes('بۆتیکی نافین'));
check('the seller\u2019s own home still opens',
  (await page('/app')).includes('owner-products'));
check('a hidden product is still the seller\'s to open',
  (await page(`/app/products/${PRODUCT_ID}`)).includes('publish-page'));

// Five are public and the rest are hidden, so putting a sixth back up
// is the one edit the database refuses. The seller is told which rule
// they met, with their form still filled in.
await control(`/__public/${FREE_PRODUCT_LIMIT}`);
const sixthPublic = await setVisibility('active');
check('making a sixth product public is refused', sixthPublic.status, 200);
check('with the reason, on the form, and no claim that anything was deleted',
  sixthPublic.body.includes(T.errPublicFull(FREE_PRODUCT_LIMIT))
  && sixthPublic.body.includes('publish-page'));

// Hiding one is always allowed: that is how a seller makes room.
check('hiding one of the five is allowed',
  (await setVisibility('hidden')).location, '/app');

// And once there is room, the swap goes through.
await control(`/__public/${FREE_PRODUCT_LIMIT - 1}`);
check('and then the other one can go up in its place',
  (await setVisibility('active')).location, '/app');

// Paying again lifts it, with no re-posting and nothing restored.
await paid(FREE_PRODUCT_LIMIT + 3, 20);
check('paying again reaches the form immediately',
  (await page('/app/new')).includes('publish-page'));
await control(`/__public/${FREE_PRODUCT_LIMIT}`);
check('and a paid seller may have more than five public',
  (await setVisibility('active')).location, '/app');

// A shop that lapses with room to spare loses nothing at all.
await paid(3, -1);
await control('/__public/3');
check('a lapsed shop under the limit still reaches the form',
  (await page('/app/new?plan=free')).includes('publish-page'));
check('and can still publish', (await publish(1)).location === '/app', true);
check('and its products stay public',
  (await setVisibility('active')).location, '/app');

/* ============================================================
   7. the admin's stop button outranks all of it
   ============================================================ */

await free(0);
await control('/__suspended/1');
const stopped = await page('/app/new');
check('a suspended shop cannot reach the form', stopped.includes('publish-page'), false);
const stoppedPost = await publish(1);
check('and its post is refused',
  stoppedPost.body.includes('billing--gate') || stoppedPost.body.includes('trial-limit'));
await control('/__suspended/0');

/* ============================================================
   8. what the account card says as a paid plan ends
   ============================================================ */

for (const [days, level, phrase] of [
  [20, null, null],
  [7, 'soon', 'ڕۆژ لە پلانەکەت ماوە'],
  [3, 'urgent', 'تەنها'],
  [1, 'urgent', 'سبەی'],
  [-1, null, null], // Backend tier is Free once paid access expires.
]) {
  await control('/__plan/year_1');
  await control(`/__sub/${days}`);
  const html = await page('/app');
  const found = html.match(/id="settings-plan-warning" data-level="([a-z]+)"[^>]*>([^<]*)</);
  check(`${days} days left: ${level ?? 'no warning'}`, found?.[1] ?? null, level);
  if (phrase) check(`${days} days left says so`, found?.[2]?.includes(phrase));
  if (level) check(`${days} days left offers renewal`, html.includes('نوێکردنەوەی پلان'));
}

// Renewal is a thing the seller does. Nothing renews itself, and no
// screen says it does.
await control('/__sub/20');
const plans = await page('/app/subscription');
check('no screen claims a subscription renews itself',
  /خۆکار.{0,40}نوێ|auto.?renew/i.test(plans + (await page('/app'))), false);

/* ============================================================
   9. the owner's grant
   ============================================================ */

await control('/__admin/0');
const notAdmin = await fetch(`${APP}/admin/shops/${SHOP}/grant`,
  { headers: { cookie: COOKIE }, redirect: 'manual' });
check('a seller cannot open the grant screen', notAdmin.status, 404);

await control('/__admin/1');
const grantForm = await page(`/admin/shops/${SHOP}/grant`);
for (const plan of ['month_1', 'months_6', 'year_1']) {
  check(`the owner can grant ${plan}`, grantForm.includes(`value="${plan}"`));
}
check('a grant is not presented as a payment', grantForm.includes('وەک پارەدان تۆمار ناکرێت'));
const badPlan = await post(`/admin/shops/${SHOP}/grant`,
  { plan: 'forever', reason: 'because', step: 'review' });
check('an invented plan is refused', badPlan.body.includes('پلانێک هەڵبژێرە'));
await control('/__admin/0');

/* ============================================================
   10. the plan gate on a phone
   ============================================================

   Only with CHROME set, so the suite stays a fast node run by default:
   CHROME=/path/to/chrome node scripts/free-plan-test.mjs
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

    await free(0);

    for (const width of [320, 360, 390, 430]) {
      await view.setViewportSize({ width, height: 844 });
      await view.goto(`${APP}/app/new`);
      check(`${width}: the plan screen is what loads`,
        await view.locator('.billing--gate').count(), 1);
      check(`${width}: RTL and nothing runs off the side`,
        await view.evaluate(() => document.documentElement.dir === 'rtl'
          && document.documentElement.scrollWidth <= innerWidth));
      check(`${width}: every choice is a real tap target`,
        await view.locator('.gate-plan').evaluateAll(
          (els) => els.length === 3 && els.every((el) => el.getBoundingClientRect().height >= 44)));
      check(`${width}: carrying on for nothing is the first choice`,
        await view.locator('.gate-plan').first().getAttribute('data-plan') === 'free');
    }

    // A full shop, at the width most sellers are on: the free choice is
    // gone and the reason is on the screen.
    await view.setViewportSize({ width: 390, height: 844 });
    await control(`/__products/${FREE_PRODUCT_LIMIT}`);
    await view.goto(`${APP}/app/subscription/start`);
    check('a full shop sees two available paid choices',
      await view.locator('.gate-plan input:enabled').count(), 2);
    check('with a reason it can read',
      await view.locator('.alert').first().evaluate(
        (el) => el.getBoundingClientRect().height > 0
          && parseFloat(getComputedStyle(el).fontSize) >= 13));

    // The warning line as a paid plan ends.
    for (const [days, level] of [[7, 'soon'], [3, 'urgent'], [1, 'urgent']]) {
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
    await control('/__sub/-1');
    await view.goto(`${APP}/app?w=expired#account-settings`);
    check('expired paid is Free without countdown', await view.locator('.settings-plan').getAttribute('data-status'), 'free');
    check('Free has no expiry warning', await view.locator('#settings-plan-warning, .settings-plan time').count(), 0);
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
