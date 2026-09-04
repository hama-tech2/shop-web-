/**
 * Shop Web — affected-row test for the seller write paths.
 *
 * PostgREST answers 200 with an empty body when a write matches no
 * rows. RLS discarding an update therefore looks exactly like a
 * successful one, and the seller gets a success screen over a product
 * that did not change — or a "deleted" message for a row still there.
 *
 * Each case runs the same request twice against a stub that reports
 * one affected row and then zero, and asserts the two outcomes differ
 * in the way they should.
 *
 * Needs the Worker running against scripts/../stub (see the session
 * notes); by default:
 *   node scripts/affected-rows-test.mjs http://127.0.0.1:8798 http://127.0.0.1:8899
 */

const APP = process.argv[2] || 'http://127.0.0.1:8798';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const PRODUCT = 'bbbbbbbb-1111-4111-8111-111111111111';
const CAT = 'dddddddd-1111-4111-8111-111111111111';
const COOKIE = 'sb-access=TEST';

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: got === want });

const setRows = (n) => fetch(`${STUB}/__rows/${n}`).then((r) => r.json());

async function post(path, fields) {
  const body = new URLSearchParams(fields);
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: COOKIE,
      origin: APP,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  return {
    status: res.status,
    location: res.headers.get('location'),
    html: res.status === 200 ? await res.text() : '',
  };
}

/** The Sorani "not found, it may already be deleted" line. */
const GONE = 'نەدۆزرایەوە';

const PRODUCT_FORM = {
  title: 'کراسی کوردی',
  price: '85000',
  description: '',
  category: 'clothing',
  status: 'active',
  images: JSON.stringify([
    { card: `products/aaaaaaaa-1111-4111-8111-111111111111/${PRODUCT}/1-card.webp`,
      full: `products/aaaaaaaa-1111-4111-8111-111111111111/${PRODUCT}/1-full.webp` },
  ]),
};

/* ---------- product edit ---------- */

await setRows(1);
let r = await post(`/app/products/${PRODUCT}`, PRODUCT_FORM);
check('edit, 1 row: redirects to the list', r.location, '/app/products');
check('edit, 1 row: no error page', r.status, 303);

await setRows(0);
r = await post(`/app/products/${PRODUCT}`, PRODUCT_FORM);
check('edit, 0 rows: does NOT redirect', r.status, 200);
check('edit, 0 rows: shows the gone error', r.html.includes(GONE), true);

/* ---------- product delete ---------- */

await setRows(1);
r = await post(`/app/products/${PRODUCT}/delete`, {});
check('delete, 1 row: clean redirect', r.location, '/app/products');

await setRows(0);
r = await post(`/app/products/${PRODUCT}/delete`, {});
check('delete, 0 rows: redirect carries the error', r.location, '/app/products?e=errGone');

/* ---------- category rename ---------- */

await setRows(1);
r = await post(`/app/categories/${CAT}`, { name: 'ناوی نوێ' });
check('rename, 1 row: clean redirect', r.location, '/app/categories');

await setRows(0);
r = await post(`/app/categories/${CAT}`, { name: 'ناوی نوێ' });
check('rename, 0 rows: redirect carries the error', r.location, '/app/categories?e=errGone');

/* ---------- category delete ---------- */

await setRows(1);
r = await post(`/app/categories/${CAT}/delete`, {});
check('cat delete, 1 row: clean redirect', r.location, '/app/categories');

await setRows(0);
r = await post(`/app/categories/${CAT}/delete`, {});
check('cat delete, 0 rows: redirect carries the error', r.location, '/app/categories?e=errGone');

/* ---------- category move ---------- */

await setRows(1);
r = await post(`/app/categories/${CAT}/move`, { dir: 'down' });
check('move, 1 row: clean redirect', r.location, '/app/categories');

await setRows(0);
r = await post(`/app/categories/${CAT}/move`, { dir: 'down' });
check('move, 0 rows: redirect carries the error', r.location, '/app/categories?e=errGone');

/* ---------- the error actually reaches the seller's screen ---------- */

for (const [name, path] of [
  ['products list renders the error', '/app/products?e=errGone'],
  ['categories page renders the error', '/app/categories?e=errGone'],
]) {
  const res = await fetch(`${APP}${path}`, { headers: { cookie: COOKIE } });
  check(name, (await res.text()).includes(GONE), true);
}

/* ---------- an unknown error key must not be reflected ---------- */

const res = await fetch(`${APP}/app/products?e=<script>alert(1)</script>`, {
  headers: { cookie: COOKIE },
});
check('unknown error key is ignored', (await res.text()).includes('alert(1)'), false);

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
