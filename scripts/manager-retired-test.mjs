/**
 * Shop Web — the seller's product manager is /app, and only /app.
 *
 * There used to be two screens listing a seller's products: /app, the
 * owner view of the shop, and /app/products, a manager of its own. They
 * showed the same rows with different markup, and every "back" in the
 * publish flow pointed at the second one — so a seller who finished
 * adding a product, or abandoned one, or deleted one, ended up on a
 * screen that was not their shop and had no obvious way back to it.
 *
 * /app/products is retired. What this pins:
 *
 *   * GET /app/products answers with a redirect to /app. It never
 *     renders a list of its own again.
 *   * Publish, edit and delete all end on /app.
 *   * A bad or missing product id ends on /app, not on an error.
 *   * Nothing a seller can normally tap links to /app/products.
 *   * /app/products/<id> survives as the edit form's own URL, and the
 *     delete endpoint under it still works.
 *
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/manager-retired-test.mjs
 */

import { PRODUCT as T } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const SHOP = 'aaaaaaaa-1111-4111-8111-111111111111';
const DRAFT = 'bbbbbbbb-1111-4111-8111-111111111111';
const PRODUCT_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const COOKIE = 'sb-access=TEST';

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const control = (path) => fetch(`${STUB}${path}`).then((r) => r.json());
const setMode = (m) => control(`/__mode/${m}`);

const get = (path, headers) =>
  fetch(`${APP}${path}`, { redirect: 'manual', headers: headers || {} });
const asSeller = (path) => get(path, { cookie: COOKIE });
const sellerHtml = async (path) => (await asSeller(path)).text();

const post = async (path, fields) => {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: COOKIE, origin: APP,
               'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  return { status: res.status, location: res.headers.get('location'),
           html: res.status === 200 ? await res.text() : '' };
};

// An image key is checked against the product it belongs to, so the
// edit form needs a gallery under the product's own id, not the draft's.
const img = (owner, n) => ({ card: `products/${SHOP}/${owner}/${n}-card.webp`,
                             full: `products/${SHOP}/${owner}/${n}-full.webp` });
const gallery = (owner, n = 1) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => img(owner, i + 1)));
const formFor = (owner) =>
  ({ images: gallery(owner), title: 'کراسی کوردی', price: '25000' });

await setMode('shop');
await control('/__plan/year_1');
await control('/__sub/20');
// The stored product carries a cover, the way every real one does: a
// product cannot be published without an image. The editor saves the
// cover, the name and the market category, and compares what the form
// posts against what is stored — so a fixture holding no stored image
// makes an ordinary edit look like an attempt to add one.
await control(`/__productimg/${encodeURIComponent(`products/${SHOP}/${PRODUCT_ID}/stored.webp`)}`);

/* ============================================================
   1. the address itself
   ============================================================ */

const retired = await asSeller('/app/products');
check('/app/products no longer renders a page', retired.status, 303);
check('it redirects to /app', retired.headers.get('location'), '/app');
check('and is never cached, so the decision stays reversible',
  retired.headers.get('cache-control'), 'no-store');

// No body, so there is nothing of the old list left to render.
check('it carries no list of its own', (await retired.text()).trim(), '');

// The old page took ?e and a filter; neither resurrects it.
for (const q of ['?e=errGone', '?filter=hidden', '?category=food', '?foo=bar']) {
  const res = await asSeller(`/app/products${q}`);
  check(`/app/products${q} redirects too`, res.status, 303);
  check(`/app/products${q} lands on /app`, res.headers.get('location'), '/app');
}

// A stranger is not a special case: the retired address sends everyone
// to /app, which does its own gating (scripts/entry-points-test.mjs).
const stranger = await get('/app/products');
check('a signed-out visitor is redirected as well', stranger.status, 303);
check('to /app, which decides what they may see',
  stranger.headers.get('location'), '/app');

/* ============================================================
   2. add a product
   ============================================================ */

const home = await sellerHtml('/app');
check('/app offers Add Product', /href="\/app\/new"/.test(home));
check('and it is the only add entry point a seller sees',
  (home.match(/href="\/app\/new"/g) || []).length, 1);

// Back from the add form goes to /app. This is the Back button case:
// the form is reached from /app, so the browser's own Back returns
// there — and the form's own back arrow has to agree, or the two
// disagree about where "back" is.
const addForm = await sellerHtml('/app/new');
check('the add form’s back arrow points at /app',
  /<a class="icon-btn" href="\/app" aria-label/.test(addForm));
check('the add form never links to the old manager',
  addForm.includes('/app/products"'), false);
check('and posts to /app/new', /<form[^>]*action="\/app\/new"/.test(addForm));

/* ---------- publish ---------- */

let r = await post('/app/new', { draft_id: DRAFT, ...formFor(DRAFT) });
check('publishing succeeds', r.status, 303);
check('and lands on /app', r.location, '/app');

/* ============================================================
   3. edit
   ============================================================ */

const editUrl = `/app/products/${PRODUCT_ID}`;
const editForm = await asSeller(editUrl);
check('the edit form still lives under /app/products/<id>', editForm.status, 200);

const editHtml = await editForm.text();
check('it is the product form', editHtml.includes('publish-page'));
check('posting to its own URL', new RegExp(`action="${editUrl}"`).test(editHtml));
check('its back arrow points at /app',
  /<a class="icon-btn" href="\/app" aria-label/.test(editHtml));

r = await post(editUrl, formFor(PRODUCT_ID));
check('a successful edit redirects', r.status, 303);
check('to /app', r.location, '/app');

// A product that is gone — deleted in another tab, or never this
// seller's and refused by RLS. The seller lands on their own shop
// rather than on an error about a product they cannot see.
await control('/__noproduct/1');
const missing = await asSeller(editUrl);
check('a product that no longer exists redirects', missing.status, 303);
check('to /app', missing.headers.get('location'), '/app');

const missingPost = await post(editUrl, formFor(PRODUCT_ID));
check('and saving one goes to /app too, not to a 500',
  [303, 200].includes(missingPost.status), true);
check('without claiming the edit worked',
  missingPost.status === 303 ? missingPost.location === '/app'
                             : missingPost.html.includes(T.errGone), true);
await control('/__noproduct/0');

// A malformed id never matches the product route at all, so it falls
// through to /app and is answered by it. Same destination, no error —
// which is what the seller needed. Pinned as the destination rather
// than as a redirect, because the mechanism here is the router's.
const malformed = await asSeller('/app/products/not-a-uuid');
check('a malformed id is not an error', malformed.status, 200);
const malformedBody = await malformed.text();
check('and answers with the owner home',
  malformedBody.includes('owner-controls') && malformedBody.includes('owner-products'));
check('not with the retired manager',
  /class="manager-row"|class="rows"/.test(malformedBody), false);

/* ============================================================
   4. delete
   ============================================================ */

r = await post(`/app/products/${PRODUCT_ID}/delete`, {});
check('a delete that removed a row redirects', r.status, 303);
check('to /app', r.location, '/app');

// Nothing removed: already gone in another tab, or not this seller's.
await control('/__rows/0');
r = await post(`/app/products/${PRODUCT_ID}/delete`, {});
check('a delete that removed nothing still goes to /app',
  (r.location || '').split('?')[0], '/app');
check('and says so in the query, rather than reporting success',
  r.location, '/app?e=errGone');

// The message is shown, not just carried. This is the no-JavaScript
// path: the card-by-card delete on /app reads its own fetch result.
const withError = await sellerHtml('/app?e=errGone');
check('/app renders the delete failure', withError.includes(T.errGone));
check('and shows nothing when there is no error',
  (await sellerHtml('/app')).includes(T.errGone), false);

// The query cannot put arbitrary text on a seller's screen.
const injected = await sellerHtml('/app?e=' + encodeURIComponent('<b>hacked</b>'));
check('an unknown error key renders no message',
  /hacked/.test(injected), false);
await control('/__rows/1');

// A GET on the delete endpoint is not a delete.
const deleteGet = await asSeller(`/app/products/${PRODUCT_ID}/delete`);
check('GET on the delete URL deletes nothing and redirects', deleteGet.status, 303);
check('to /app', deleteGet.headers.get('location'), '/app');

/* ============================================================
   5. nothing normal points a seller at the old manager
   ============================================================ */

const SELLER_SCREENS = [
  ['the owner home', '/app'],
  ['the add form', '/app/new'],
  ['the edit form', editUrl],
  ['the profile editor', '/app/profile'],
  ['the plan screen', '/app/subscription'],
];

for (const [name, path] of SELLER_SCREENS) {
  const page = await sellerHtml(path);
  // href="/app/products" exactly — /app/products/<id> is the edit form
  // and the delete endpoint, both of which are meant to stay.
  const links = page.match(/href="\/app\/products"/g) || [];
  check(`${name}: no link to the retired manager`, links.length, 0);
  const forms = page.match(/action="\/app\/products"/g) || [];
  check(`${name}: and nothing posts to it`, forms.length, 0);
}

// The settings panel opens over /app, and its product row is gone with
// the page it pointed at.
check('the settings panel has no manage-products row',
  home.includes('href="/app/products"'), false);
check('but still offers editing the profile',
  home.includes('href="/app/profile"'), true);
check('and viewing the public shop', /href="\/@[^"]+"/.test(home), true);

// The Free access gate, which a seller meets on the way to Add Product.
await control('/__plan/free');
await control('/__products/5');
const gate = await sellerHtml('/app/new');
check('the Free limit screen does not offer the old manager either',
  gate.includes('href="/app/products"'), false);
check('and sends the seller back to /app',
  /href="\/app"/.test(gate), true);
await control('/__plan/year_1');
await control('/__products/1');

/* ============================================================
   6. the edit URL and the delete endpoint are still real
   ============================================================ */

check('the edit URL is still routed, not redirected',
  (await asSeller(editUrl)).status, 200);
check('and the owner page still deletes through it',
  (await (await fetch(`${APP}/js/owner-profile.js`)).text())
    .includes("'/app/products/'"), true);

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
