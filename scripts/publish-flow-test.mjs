/**
 * Shop Web — the publish flow, end to end.
 *
 * The locked rule: an image, a name and a price are the only things
 * required to publish. Category, shop category and description must
 * never block, and each failure must name its own field rather than
 * falling back to a generic save error.
 *
 * Drives the real Worker against scripts/stub-supabase.mjs:
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/publish-flow-test.mjs
 */

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const SHOP = 'aaaaaaaa-1111-4111-8111-111111111111';
const DRAFT = 'bbbbbbbb-1111-4111-8111-111111111111';
const COOKIE = 'sb-access=TEST';

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: got === want });

const setMode = (m) => fetch(`${STUB}/__mode/${m}`).then((r) => r.json());
const control = (path) => fetch(`${STUB}${path}`).then((r) => r.json());

const img = (n) => ({
  card: `products/${SHOP}/${DRAFT}/${n}-card.webp`,
  full: `products/${SHOP}/${DRAFT}/${n}-full.webp`,
});

const gallery = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => img(i + 1)));

async function publish(fields) {
  const res = await fetch(`${APP}/app/new`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: COOKIE,
      origin: APP,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ draft_id: DRAFT, ...fields }),
  });
  return {
    status: res.status,
    location: res.headers.get('location'),
    html: res.status === 200 ? await res.text() : '',
  };
}

/* The Sorani fragments that identify each specific message. */
const SAYS = {
  noImage: 'لانیکەم یەک وێنە',        // add at least one image
  tooMany: 'تەنها ٥ وێنە',            // only 5 images
  name:    'ناوی بەرهەم دەبێت',       // the name must be at least 2 letters
  price:   'نرخێکی دروست',            // enter a valid price
  save:    'پاشەکەوتکردن سەرکەوتوو',  // the generic save failure
};

// Publishing lands the seller in their own owner view of the shop.
//
// It used to land on /@slug/p/<id> — the customer's copy of the page.
// That view has no owner controls, because nothing under /@ knows who
// is looking, and it is served `public, s-maxage=…` where every /app
// screen is `no-store`. Pressing Back from it walked to /@slug and left
// the owner sitting in a cached, shared, customer view of their own
// shop.
//
// OWNER is /app: the shop as its owner sees it — header, owner-controls
// and products. Not /app/products, which is the management list: a place
// to administer stock, not to look at the shop you have just added to.
// PUBLIC is the customer's copy, and is what publishing must never use.
const OWNER = '/app';
const MANAGER = '/app/products';
const PUBLIC = `/@nafin-boutique/p/${DRAFT}`;

const MINIMUM = { images: gallery(1), title: 'کراسی کوردی', price: '25000' };

await setMode('shop');
// The gallery belongs to a paid shop: Free is one image per product,
// which scripts/free-plan-test.mjs is what covers. Everything here is
// about the form, not the plan.
await control('/__plan/year_1');
await control('/__sub/20');

/* ---------- the locked minimum: image + name + price only ---------- */

let r = await publish(MINIMUM);
check('minimum publishes (no description, no categories)', r.location, OWNER);
check('minimum does not re-render the form', r.status, 303);

r = await publish({ ...MINIMUM, description: '', category: '', own_category: '' });
check('empty optional fields still publish', r.location, OWNER);

r = await publish({ ...MINIMUM, description: 'وەسفێکی کورت', category: 'clothing' });
check('filled optional fields still publish', r.location, OWNER);

r = await publish({ ...MINIMUM, images: gallery(5) });
check('five images publish', r.location, OWNER);

/* ---------- each failure names its own field ---------- */

r = await publish({ ...MINIMUM, images: gallery(6) });
check('six images: rejected', r.status, 200);
check('six images: says the limit, not "add an image"', r.html.includes(SAYS.tooMany), true);
check('six images: not the generic save error', r.html.includes(SAYS.save), false);

r = await publish({ ...MINIMUM, images: '[]' });
check('no image: says image required', r.html.includes(SAYS.noImage), true);
check('no image: not the generic save error', r.html.includes(SAYS.save), false);

r = await publish({ ...MINIMUM, title: '' });
check('no name: says name required', r.html.includes(SAYS.name), true);
check('no name: not the generic save error', r.html.includes(SAYS.save), false);

r = await publish({ ...MINIMUM, price: '' });
check('no price: says price', r.html.includes(SAYS.price), true);
check('no price: not the generic save error', r.html.includes(SAYS.save), false);

r = await publish({ ...MINIMUM, price: 'abc' });
check('invalid price: says price', r.html.includes(SAYS.price), true);

r = await publish({ ...MINIMUM, price: '-5' });
check('negative price: says price', r.html.includes(SAYS.price), true);

r = await publish({ ...MINIMUM, price: '0' });
check('zero price: says price', r.html.includes(SAYS.price), true);

// A Sorani seller types ٢٥٠٠٠ as readily as 25000; both must publish.
r = await publish({ ...MINIMUM, price: '٢٥٠٠٠' });
check('arabic-indic digits publish', r.location, OWNER);

r = await publish({ ...MINIMUM, price: '25,000' });
check('thousands separators publish', r.location, OWNER);

/* ---------- an image key from another shop is refused ---------- */

r = await publish({
  ...MINIMUM,
  images: JSON.stringify([{ card: 'products/99999999-9999-4999-8999-999999999999/x/1-card.webp' }]),
});
check('foreign image key: refused', r.status, 200);

/* ---------- the bug that started this: a seller with no shop ---------- */

await setMode('noshop');

const form = await fetch(`${APP}/app/new`, {
  headers: { cookie: COOKIE }, redirect: 'manual',
});
check('no shop: /app/new does not render the form', form.status, 303);
check('no shop: sent to onboarding, not the product form', form.headers.get('location'), '/onboarding');

r = await publish(MINIMUM);
check('no shop: publish cannot reach the insert', r.status, 303);
check('no shop: publish redirects to onboarding', r.location, '/onboarding');

await setMode('shop');

/* ============================================================
   after publishing, and the one list behind it
   ============================================================

   Publishing lands the seller in their own manager, in owner mode,
   whatever the product's visibility. The manager is one list: hidden
   products are marked, not filed somewhere else.
   ============================================================ */

await control('/__mixed/1');
const manager = await fetch(`${APP}/app/products`, { headers: { cookie: COOKIE } })
  .then((res) => res.text());

check('the manager has no All / Visible / Hidden navigation', /manager-filters/.test(manager), false);
check('and offers no filter links at all', /[?&]filter=/.test(manager), false);
check('a visible product is in the list', manager.includes('کراسی کوردی'), true);
check('and a hidden one is in the SAME list', manager.includes('کراسی شاراوە'), true);
check('each row still says which it is',
  manager.includes('شاراوەیە') && manager.includes('دیارە'), true);
check('tapping a row still opens it for editing',
  manager.includes('href="/app/products/' + DRAFT + '"'), true);
check('delete is still there', /\/delete"/.test(manager), true);
check('and Add Product is still there', manager.includes('href="/app/new"'), true);
await control('/__mixed/0');

const asHidden = await publish({ ...MINIMUM, status: 'hidden' });
check('publishing a hidden product goes to the owner view too', asHidden.location, OWNER);

/* ---------- the regression itself ---------- */

// The bug: a successful publish handed the seller the customer's view
// of their own shop. These are the properties that were broken, pinned
// one at a time so a future change cannot quietly undo them.

const published = await publish(MINIMUM);

check('a visible product goes to the owner view', published.location, OWNER);
// Named explicitly rather than inferred from the check above: the point
// is which places publishing must not use, not just "some other path".
check('publishing never lands on the public product page',
  published.location === PUBLIC, false);
check('publishing never lands anywhere under /@',
  published.location.startsWith('/@'), false);
check('publishing never lands on the management list',
  published.location === MANAGER, false);
check('publishing stays inside the authenticated area',
  published.location.startsWith('/app'), true);

// Owner mode, checked by what the landing page actually contains rather
// than by its URL: the shop header and the controls a customer never
// sees.
const landing = await fetch(`${APP}${published.location}`, {
  headers: { cookie: COOKIE },
});
const landingHtml = await landing.text();
check('the landing page renders', landing.status, 200);
check('it is the owner view of the shop', landingHtml.includes('owner-controls'), true);
check('it shows the shop\u2019s own products section',
  landingHtml.includes('id="owner-products"'), true);
check('it offers editing the profile',
  landingHtml.includes('href="/app/profile"'), true);
check('it offers adding another product',
  landingHtml.includes('href="/app/new"'), true);
// The public link is present as a deliberate choice, not as the place
// the seller was dropped.
check('the public shop link is offered, not forced',
  landingHtml.includes('owner-preview-link'), true);

// And the property that made Back dangerous. Every /app screen is
// no-store; the storefront is `public, s-maxage=…`. Landing on a
// cacheable page at the end of an authenticated flow is what put a
// shared customer view into the seller's history.
const cache = landing.headers.get('cache-control') || '';
check('the landing page is not cacheable', cache.includes('no-store'), true);
check('and is not marked public', cache.includes('public'), false);

// A signed-out visitor cannot reach it at all, which is the difference
// between an owner view and a storefront.
const signedOut = await fetch(`${APP}${published.location}`, { redirect: 'manual' });
check('the owner view is closed to anyone not signed in',
  [302, 303, 307].includes(signedOut.status), true);
check('and sends them to log in',
  (signedOut.headers.get('location') || '').startsWith('/login'), true);

// The storefront is still public and still cacheable — that is correct
// for a customer, and is exactly why a seller must not be sent there.
const storefront = await fetch(`${APP}${PUBLIC}`);
check('the public product page is still served publicly',
  (storefront.headers.get('cache-control') || '').includes('public'), true);

// The management list is untouched by this change and still reachable.
const managerPage = await fetch(`${APP}${MANAGER}`, { headers: { cookie: COOKIE } });
check('the management list still works', managerPage.status, 200);

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
