/**
 * Bazaro — /admin is gated on the server, on every route, for everybody.
 *
 * scripts/admin-grants-test.mjs proves the grant screen is gated. This
 * proves the same thing about the rest of /admin, because the guard is
 * called per handler: a route added later, or one whose guard call is
 * dropped in a refactor, is a hole that no existing test would notice.
 *
 * The rule being pinned, from CLAUDE.md: a non-admin gets the ordinary
 * 404 — not a redirect, not a "forbidden" — so the response must not
 * reveal that /admin exists at all. Four callers are checked against
 * every route: signed out, a signed-in seller, an admin whose row has
 * been deactivated, and a real active admin.
 *
 * Hiding the UI is not the gate, so the POST routes are driven directly
 * rather than through a page: a seller who knows the URL is exactly the
 * attacker this has to stop.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/admin-access-test.mjs
 */
const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const SHOP = 'aaaaaaaa-1111-4111-8111-111111111111';
const INTENT = 'eeeeeeee-1111-4111-8111-111111111111';
const COOKIE = 'sb-access=TEST';

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const set = (path) => fetch(STUB + path).then((r) => r.json());
const writes = () => fetch(STUB + '/__writes').then((r) => r.json());

/** Every GET under /admin, including one that matches no handler. */
const GETS = [
  '/admin',
  '/admin/shops',
  '/admin/shops?status=active',
  '/admin/intents',
  '/admin/reports',
  `/admin/shops/${SHOP}`,
  `/admin/shops/${SHOP}/grant`,
  '/admin/nothing-here',
];

/** Every POST under /admin. Each one writes if it is not stopped. */
const POSTS = [
  [`/admin/shops/${SHOP}/grant`, { plan: 'months_6', reason: 'x', step: 'review' }],
  [`/admin/shops/${SHOP}/status`, { status: 'suspended' }],
  [`/admin/shops/${SHOP}/expiry`, { days: '30' }],
  [`/admin/shops/${SHOP}/note`, { note: 'x' }],
  [`/admin/intents/${INTENT}/activate`, {}],
  [`/admin/intents/${INTENT}/not-found`, {}],
];

const get = (path, signedIn = true) =>
  fetch(APP + path, { headers: signedIn ? { cookie: COOKIE } : {}, redirect: 'manual' });

const post = (path, fields, signedIn = true) =>
  fetch(APP + path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      origin: APP,
      'content-type': 'application/x-www-form-urlencoded',
      ...(signedIn ? { cookie: COOKIE } : {}),
    },
    body: new URLSearchParams(fields),
  });

/**
 * What a refused caller must see.
 *
 * 404 is the whole point: a 302 to /login or a 403 both answer the
 * question "is there an admin area here?", and the answer is meant to
 * stay unavailable. The body must also carry none of the admin screen's
 * own vocabulary.
 */
async function refused(label, signedIn) {
  for (const path of GETS) {
    const res = await get(path, signedIn);
    check(`${label}: GET ${path} is the ordinary 404`, res.status, 404);
    const body = await res.text();
    check(`${label}: GET ${path} reveals no admin UI`,
      /adm-|\/admin\/shops|بەخشینی پلان/.test(body), false);
  }
}

/** A refused caller must also change nothing, not merely see nothing. */
async function writesNothing(label, signedIn) {
  for (const [path, fields] of POSTS) {
    await set('/__calls/reset');
    const res = await post(path, fields, signedIn);
    check(`${label}: POST ${path} is refused`, res.status, 404);
    check(`${label}: POST ${path} wrote nothing`, (await writes()).length, 0);
  }
}

await set('/__mode/shop');
await set('/__rows/1');

/* ---------- 1. signed out ---------- */
await set('/__admin/0');
await set('/__admin-active/1');
await refused('signed out', false);
await writesNothing('signed out', false);

/* ---------- 2. a signed-in seller who is not an admin ---------- */
await refused('seller', true);
await writesNothing('seller', true);

/* ---------- 3. an admin whose row was deactivated ----------
   app.is_admin() reads is_active, so switching it off takes effect on
   the next request. Deactivating is the documented way to remove an
   admin while keeping the audit trail, and it has to actually work. */
await set('/__admin/1');
await set('/__admin-active/0');
await refused('deactivated admin', true);
await writesNothing('deactivated admin', true);

/* ---------- 4. a real active admin gets in ----------
   The mirror of the above: if every case 404s, the test would pass
   against a screen nobody can reach. */
await set('/__admin-active/1');
for (const path of GETS.filter((p) => p !== '/admin/nothing-here')) {
  const res = await get(path, true);
  check(`active admin: GET ${path} opens`, res.status, 200);
}
const unknown = await get('/admin/nothing-here', true);
check('even an admin gets a 404 for a path that matches no handler', unknown.status, 404);

const adminHome = await get('/admin', true).then((r) => r.text());
check('and the admin screen is the one that renders', adminHome.includes('adm-'), true);
check('it is never cached',
  (await get('/admin', true)).headers.get('cache-control'), 'no-store');
check('and never indexed',
  (await get('/admin', true)).headers.get('x-robots-tag'), 'noindex, nofollow');

/* ---------- 5. no seller or customer page links to /admin ----------
   The gate is server-side, so a link would not grant access — but it
   would tell every seller the address exists, which is the thing the
   404 is there to withhold. */
await set('/__admin/1');
for (const path of ['/', '/search?q=a', '/saved', '/app', '/app/new', '/login', '/@nafin-boutique']) {
  const body = await fetch(APP + path, { headers: { cookie: COOKIE } }).then((r) => r.text());
  check(`no admin link on ${path}`, /href="\/admin/.test(body), false);
}

await set('/__admin/0');

/* ---------- report ---------- */
for (const r of results) {
  if (r.pass) console.log('PASS ' + r.name);
  else console.log(`FAIL  ${r.name}\n      got  ${JSON.stringify(r.got)}\n      want ${JSON.stringify(r.want)}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} of ${results.length} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
