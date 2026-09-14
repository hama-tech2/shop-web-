/**
 * Shop Web — shop categories: the JSON API, and the promise that a
 * category never costs a seller a product.
 *
 * Three things are being pinned here.
 *
 *  1. The category endpoints the owner profile and the product form use
 *     answer in JSON and never navigate: add, rename, delete.
 *  2. Deleting a category deletes NOTHING else. products.category_id is
 *     ON DELETE SET NULL, so the Worker must issue exactly one write,
 *     against `categories`, and never touch `products`.
 *  3. A category can never block publishing. A stale id, an id from
 *     another shop, a deleted one, an empty value and an unknown market
 *     slug all have to publish the product anyway, with no category —
 *     because the category is optional and the product is not.
 *
 * Drives the real Worker against scripts/stub-supabase.mjs:
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/categories-test.mjs
 */

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const SHOP = 'aaaaaaaa-1111-4111-8111-111111111111';
const DRAFT = 'bbbbbbbb-1111-4111-8111-111111111111';
const CAT_A = 'dddddddd-1111-4111-8111-111111111111';
const CAT_NEW = 'dddddddd-3333-4333-8333-333333333333';
/** A well-formed uuid that is not one of this seller's categories. */
const CAT_STALE = 'eeeeeeee-9999-4999-8999-999999999999';
const COOKIE = 'sb-access=TEST';

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const setRows = (n) => fetch(`${STUB}/__rows/${n}`).then((r) => r.json());
const resetCalls = () => fetch(`${STUB}/__calls/reset`).then((r) => r.json());
const getCalls = () => fetch(`${STUB}/__calls`).then((r) => r.json());
const getWrites = () => fetch(`${STUB}/__writes`).then((r) => r.json());

async function api(path, fields, extra = {}) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: COOKIE,
      origin: APP,
      'content-type': 'application/x-www-form-urlencoded',
      ...(extra.headers || {}),
    },
    body: new URLSearchParams(fields || {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON: the test says so */ }
  return { status: res.status, json, text };
}

// The stub is shared and stateful; another suite may have left it in a
// different mode. Say what this one needs.
await fetch(`${STUB}/__mode/shop`);
await setRows(1);

/* ============================================================
   1. the JSON API
   ============================================================ */

let r = await fetch(`${APP}/api/categories`, { headers: { cookie: COOKIE } });
let body = await r.json();
check('list: 200', r.status, 200);
check('list: returns the seller\'s categories', body.categories.length, 2);
check('list: id and name only', Object.keys(body.categories[0]).sort(), ['id', 'name']);
check('list: never cached', r.headers.get('cache-control'), 'no-store');

r = await api('/api/categories', { name: 'شەڵ' });
check('create: 200', r.status, 200);
check('create: answers with the new id', r.json.id, CAT_NEW);
check('create: answers with the saved name', r.json.name, 'شەڵ');

r = await api('/api/categories', { name: '   ' });
check('create, blank name: refused', r.status, 400);
check('create, blank name: names the field', typeof r.json.error, 'string');

// A name the seller already has is not a failure — it is the category
// they asked for, already made. The caller selects it and moves on.
r = await api('/api/categories', { name: 'کراس' });
check('create, existing name: succeeds', r.status, 200);
check('create, existing name: returns the existing id', r.json.id, CAT_A);
check('create, existing name: says it existed', r.json.existed, true);

r = await api(`/api/categories/${CAT_A}`, { name: 'کراسی نوێ' });
check('rename: 200', r.status, 200);
check('rename: echoes the new name', r.json.name, 'کراسی نوێ');

await setRows(0);
r = await api(`/api/categories/${CAT_A}`, { name: 'کراسی نوێ' });
check('rename, 0 rows: 404, not a silent success', r.status, 404);
await setRows(1);

r = await api('/api/categories/not-a-uuid', { name: 'x' });
check('rename, bad id: 404', r.status, 404);

/* ---------- a write still has to come from our own origin ---------- */

r = await api('/api/categories', { name: 'شەڵ' }, { headers: { origin: 'https://evil.test' } });
check('create from a foreign origin: refused', r.status, 403);

r = await api(`/api/categories/${CAT_A}/delete`, {}, { headers: { origin: 'https://evil.test' } });
check('delete from a foreign origin: refused', r.status, 403);

/* ---------- and a session ---------- */

r = await fetch(`${APP}/api/categories`, { redirect: 'manual' });
check('list without a session: 401, not a redirect', r.status, 401);

r = await fetch(`${APP}/api/categories`, {
  method: 'POST', redirect: 'manual',
  headers: { origin: APP, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ name: 'x' }),
});
check('create without a session: 401', r.status, 401);

/* ============================================================
   2. deleting a category never deletes a product
   ============================================================ */

await resetCalls();
r = await api(`/api/categories/${CAT_A}/delete`, {});
check('delete: 200', r.status, 200);

let calls = await getCalls();
check('delete: exactly one write', calls.length, 1);
check('delete: and it is a DELETE on categories',
      /^DELETE categories\?/.test(calls[0]), true);
check('delete: scoped to this shop, not just the id',
      calls[0].includes(`shop_id=eq.${SHOP}`), true);
check('delete: nothing was written to products',
      calls.some((c) => c.includes('products')), false);
check('delete: nothing was written to product_images',
      calls.some((c) => c.includes('product_images')), false);

await setRows(0);
r = await api(`/api/categories/${CAT_A}/delete`, {});
check('delete, 0 rows: 404, not a silent success', r.status, 404);
await setRows(1);

/* ---------- the product survives, and is still publishable ---------- */

const img = (n) => ({
  card: `products/${SHOP}/${DRAFT}/${n}-card.webp`,
  full: `products/${SHOP}/${DRAFT}/${n}-full.webp`,
});
const MINIMUM = {
  images: JSON.stringify([img(1)]),
  title: 'کراسی کوردی',
  price: '25000',
};

async function publish(fields) {
  const res = await fetch(`${APP}/app/new`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: COOKIE, origin: APP,
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

/** The generic "save failed" the seller kept hitting on his phone. */
const SAVE_FAILED = 'پاشەکەوتکردن سەرکەوتوو';

/* ============================================================
   3. a category can never block publishing
   ============================================================ */

const cases = [
  ['no category at all', {}],
  ['empty shop category', { own_category: '' }],
  ['empty market category', { category: '' }],
  ['both empty', { own_category: '', category: '' }],
  ['a stale shop category id', { own_category: CAT_STALE }],
  ['a shop category id that is not a uuid', { own_category: 'deleted' }],
  ['an unknown market category slug', { category: 'no-such-slug' }],
  ['a stale id and an unknown slug together',
   { own_category: CAT_STALE, category: 'no-such-slug' }],
  ['a real shop category', { own_category: CAT_A }],
];

for (const [name, fields] of cases) {
  const out = await publish({ ...MINIMUM, ...fields });
  check(`publishes with ${name}`, out.location === '/app', true);
  check(`publishes with ${name}: no save error`, out.html.includes(SAVE_FAILED), false);
}

/* The stale id must not be sent on to Postgres either. Passing it made
   check_category_same_shop raise 23514, which is how an optional field
   became "پاشەکەوتکردن سەرکەوتوو نەبوو" on a seller's phone. It is not
   enough that the publish succeeded against a stub that does not
   enforce the trigger — the id has to be gone from the insert. */
await resetCalls();
await publish({ ...MINIMUM, own_category: CAT_STALE });
let insert = (await getWrites()).find((w) => w.method === 'POST' && w.table === 'products');
check('a stale category id reaches the insert as null', insert?.body.category_id, null);

await resetCalls();
await publish({ ...MINIMUM, category: 'no-such-slug' });
insert = (await getWrites()).find((w) => w.method === 'POST' && w.table === 'products');
check('an unknown market slug reaches the insert as null',
      insert?.body.platform_category_id, null);

/* A category the seller really owns still has to arrive intact. */
await resetCalls();
await publish({ ...MINIMUM, own_category: CAT_A, category: 'clothing' });
insert = (await getWrites()).find((w) => w.method === 'POST' && w.table === 'products');
check('a real shop category is kept', insert?.body.category_id, CAT_A);
check('a real market category is kept',
      insert?.body.platform_category_id, 'cccccccc-1111-4111-8111-111111111111');

const sent = await fetch(`${APP}/api/categories`, { headers: { cookie: COOKIE } });
check('and the seller\'s real categories are still there',
      (await sent.json()).categories.length, 2);

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
