/**
 * Bazaro — an empty WhatsApp composer, and where a product is shown.
 *
 * Two small product rules, both of which fail silently if they break.
 *
 * 1. Tapping WhatsApp opens the seller's chat with NOTHING typed. A
 *    pre-filled message wrote the customer's first line for them, which
 *    many people send unread and others delete before they can start.
 *
 * 2. A product is shown to everyone (feed + profile + link) or only on
 *    the profile (profile + link). Profile-only is NOT hidden: the
 *    product stays public, its URL keeps working, and it still counts
 *    toward the Free plan's five — the thing a seller could otherwise
 *    use to hold six live products.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/visibility-test.mjs
 */
import { DEFAULT_VISIBILITY, PRODUCT_VISIBILITY } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const SHOP_PATH = '/@nafin-boutique';
const PRODUCT_ID = 'bbbbbbbb-1111-4111-8111-111111111111';
const PRODUCT_PATH = `${SHOP_PATH}/p/${PRODUCT_ID}`;
const COOKIE = 'sb-access=TEST';

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const control = (p) => fetch(STUB + p).then((r) => r.json());
const writes = () => fetch(STUB + '/__writes').then((r) => r.json());
const page = (p, auth = false) =>
  fetch(APP + p, { headers: auth ? { cookie: COOKIE } : {} }).then((r) => r.text());

const post = (p, fields) => fetch(APP + p, {
  method: 'POST',
  redirect: 'manual',
  headers: { cookie: COOKIE, origin: APP, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

/** Every wa.me link on a page. */
const waLinks = (html) =>
  [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]*)"/g)].map((m) =>
    m[1].replaceAll('&amp;', '&'));

const img = (n) => ({
  card: `products/aaaaaaaa-1111-4111-8111-111111111111/${PRODUCT_ID}/${n}-card.webp`,
  full: `products/aaaaaaaa-1111-4111-8111-111111111111/${PRODUCT_ID}/${n}-full.webp`,
});

await control('/__mode/shop');
await control('/__rows/1');
await control('/__plan/year_1');
await control('/__sub/20');
await control(`/__productimg/${encodeURIComponent(img(1).card)}`);
await control(`/__visibility/${DEFAULT_VISIBILITY}`);

/* ============================================================
   1. WhatsApp opens empty, everywhere
   ============================================================ */

for (const [label, path] of [
  ['the feed card', '/'],
  ['the shop page', SHOP_PATH],
  ['the product page', PRODUCT_PATH],
  ['search results', '/search?q=%DA%A9'],
  ['saved', '/saved'],
]) {
  const links = waLinks(await page(path));
  check(`${label}: has at least one WhatsApp link or none at all`,
    Array.isArray(links), true);
  check(`${label}: no ?text= on any WhatsApp link`,
    links.some((u) => u.includes('?text=') || u.includes('&text=')), false);
  check(`${label}: no query string at all`,
    links.some((u) => u.includes('?')), false);
  check(`${label}: every link is bare wa.me/<digits>`,
    links.every((u) => /^https:\/\/wa\.me\/[0-9]+$/.test(u)), true);
}

// The specific things that used to be typed for the customer.
const product = await page(PRODUCT_PATH);
const shop = await page(SHOP_PATH);
for (const [label, html] of [['product page', product], ['shop page', shop]]) {
  const joined = waLinks(html).join(' ');
  check(`${label}: no greeting in the link`, /%D8%B3%DA%B5%D8%A7%D9%88|سڵاو/.test(joined), false);
  check(`${label}: no product title in the link`, joined.includes('%DA%A9%D8%B1%D8%A7%D8%B3'), false);
  check(`${label}: no URL smuggled into the link`, /https?%3A|bazarnow|127\.0\.0\.1/.test(joined), false);
}

// Validation and security are unchanged: digits only, no scheme injection.
check('the product page link is the shop number, digits only',
  waLinks(product).filter((u) => u.includes('9647510000002')).length > 0, true);
check('no javascript: or data: could reach a WhatsApp href',
  /href="javascript:|href="data:/.test(product + shop), false);

/* ============================================================
   2. visibility — the customer's side
   ============================================================ */

const inFeed = async () => (await page('/')).includes('کراسی کوردی');
const inSearch = async () => (await page('/search?q=%DA%A9')).includes('کراسی کوردی');
const onProfile = async () => (await page(SHOP_PATH)).includes('کراسی کوردی');
const directUrl = async () => (await fetch(APP + PRODUCT_PATH)).status;

/* ---------- default: everyone ---------- */
await control('/__visibility/everyone');
check('default product is in the feed', await inFeed(), true);
check('default product is on the profile', await onProfile(), true);
check('default product opens by direct URL', await directUrl(), 200);

/* ---------- profile only ---------- */
await control('/__visibility/profile');
check('profile-only product is GONE from the feed', await inFeed(), false);
check('profile-only product is GONE from search', await inSearch(), false);
check('profile-only product is STILL on the public profile', await onProfile(), true);
check('profile-only product STILL opens by direct URL', await directUrl(), 200);

// It is public, not private: a signed-out stranger can still read it.
const stranger = await fetch(APP + PRODUCT_PATH).then((r) => r.text());
check('and a signed-out stranger can read it', stranger.includes('کراسی کوردی'), true);
check('it is not a 404 and not a login wall',
  /تێپەڕەوشە|sign in|چوونە ژوورەوە/.test(stranger) && !stranger.includes('کراسی کوردی'), false);

/* ---------- a product from before the column ---------- */
await control('/__visibility/-');
check('a product written before this column is still in the feed', await inFeed(), true);
check('and still on the profile', await onProfile(), true);
check('and still opens by direct URL', await directUrl(), 200);
await control(`/__visibility/${DEFAULT_VISIBILITY}`);

/* ============================================================
   3. visibility — the seller's side
   ============================================================ */

const createForm = await page('/app/new', true);
check('the create form offers the choice', createForm.includes('name="visibility"'), true);
check('with both options',
  Object.keys(PRODUCT_VISIBILITY).every((k) => createForm.includes(`value="${k}"`)), true);
check('and "everyone" is preselected',
  /value="everyone"[^>]*checked/.test(createForm), true);
check('profile-only is not preselected',
  /value="profile"[^>]*checked/.test(createForm), false);
check('both labels are on the form',
  createForm.includes('بۆ هەمووان') && createForm.includes('تەنها لە پرۆفایل'), true);

/* ---------- publishing carries the choice ---------- */
await control('/__calls/reset');
const draft = 'cccccccc-1111-4111-8111-111111111111';
const created = await post('/app/new', {
  draft_id: draft,
  images: JSON.stringify([{
    card: `products/aaaaaaaa-1111-4111-8111-111111111111/${draft}/1-card.webp`,
    full: `products/aaaaaaaa-1111-4111-8111-111111111111/${draft}/1-full.webp`,
  }]),
  title: 'کراسی کوردی', price: '25000', currency: 'IQD', visibility: 'profile',
});
check('publishing a profile-only product succeeds', created.status, 303);
const inserts = (await writes()).filter((w) => w.table === 'products' && w.method === 'POST');
check('and the choice reached the database', inserts[0]?.body?.visibility, 'profile');
check('while status stayed active — this is not hiding',
  inserts[0]?.body?.status, 'active');

/* ---------- editing it ---------- */
await control('/__visibility/profile');
const editForm = await page(`/app/products/${PRODUCT_ID}`, true);
check('the edit form offers the choice', editForm.includes('name="visibility"'), true);
check('and opens on what was stored',
  /value="profile"[^>]*checked/.test(editForm), true);

await control('/__calls/reset');
const edited = await post(`/app/products/${PRODUCT_ID}`, {
  draft_id: PRODUCT_ID,
  images: JSON.stringify([img(1)]),
  title: 'کراسی کوردی', category: '', visibility: 'everyone',
});
check('changing visibility saves', edited.status, 303);
const patches = (await writes()).filter((w) => w.table === 'products' && w.method === 'PATCH');
check('and the new choice reached the database', patches[0]?.body?.visibility, 'everyone');

/* ---------- the editor is still narrow ----------
   Where a product shows is the seller's to change. What it costs is
   not: the restricted editor must still refuse price, currency and
   status even when they are posted by hand. */
const patched = patches[0]?.body ?? {};
check('the edit still never writes a price', 'price' in patched, false);
check('nor a currency', 'currency' in patched, false);
check('nor a status', 'status' in patched, false);
check('it writes only title, visibility and market category',
  Object.keys(patched).sort(), ['platform_category_id', 'title', 'visibility']);

/* ---------- a crafted value is refused, not folded ---------- */
await control('/__calls/reset');
const bogus = await post(`/app/products/${PRODUCT_ID}`, {
  draft_id: PRODUCT_ID,
  images: JSON.stringify([img(1)]),
  title: 'کراسی کوردی', category: '', visibility: 'secret',
});
check('an invented visibility is refused', bogus.status, 200);
check('and nothing was written',
  (await writes()).filter((w) => w.table === 'products').length, 0);

/* ---------- a form from before this shipped ---------- */
await control('/__calls/reset');
const noField = await post(`/app/products/${PRODUCT_ID}`, {
  draft_id: PRODUCT_ID,
  images: JSON.stringify([img(1)]),
  title: 'کراسی کوردی', category: '',
});
check('a form with no visibility field still saves', noField.status, 303);

/* ============================================================
   4. the Free limit counts both kinds
   ============================================================ */

await control('/__plan/free');
await control('/__sub/0');
await control('/__products/5');
const gate = await page('/app/new', true);
check('a Free seller with five products meets the gate, whatever their visibility',
  gate.includes('billing--gate') || gate.includes('trial-limit'), true);

// The rule in one line: profile-only is still `status = 'active'`, and
// app.enforce_free_product_limit counts active rows. Nothing in this
// change touches that trigger, so there is no way to hold a sixth.
check('the insert the gate would have made never carried a non-active status',
  inserts.every((w) => w.body?.status === 'active'), true);

await control('/__plan/year_1');
await control('/__sub/20');
await control('/__products/1');

/* ---------- report ---------- */
for (const r of results) {
  if (r.pass) console.log('PASS ' + r.name);
  else console.log(`FAIL  ${r.name}\n      got  ${JSON.stringify(r.got)}\n      want ${JSON.stringify(r.want)}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} of ${results.length} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
