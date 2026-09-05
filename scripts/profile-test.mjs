/**
 * Shop Web — the Edit Profile screen.
 *
 * The rules being pinned:
 *
 *  - An empty social field NEVER blocks the save. Instagram, TikTok,
 *    Facebook and Snapchat are all optional, together and separately.
 *  - Location is a real field now. It accepts a Google Maps link and
 *    refuses anything that is not https — a javascript: or data: URL
 *    would end up as an href on the page customers open from TikTok.
 *  - The screen no longer shows the slug, the raw URL, the workers.dev
 *    host, the website field or the category manager, and no screen
 *    shows @username any more. The slug still lives in the URL.
 *
 * Drives the real Worker against scripts/stub-supabase.mjs:
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/profile-test.mjs
 */

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const COOKIE = 'sb-access=TEST';
const SLUG = 'nafin-boutique';

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const resetCalls = () => fetch(`${STUB}/__calls/reset`).then((r) => r.json());
const getWrites = () => fetch(`${STUB}/__writes`).then((r) => r.json());

// The stub is shared and stateful; another suite may have left it in a
// different mode. Say what this one needs.
await fetch(`${STUB}/__rows/1`);
await fetch(`${STUB}/__mode/shop`);

const BASE = {
  name: 'بۆتیکی نافین',
  bio: '',
  city: 'erbil',
  whatsapp: '07510000002',
  phone: '',
};

async function save(fields) {
  await resetCalls();
  const res = await fetch(`${APP}/app/profile`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: COOKIE, origin: APP,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ ...BASE, ...fields }),
  });
  const patch = (await getWrites()).find((w) => w.method === 'PATCH' && w.table === 'shops');
  return {
    status: res.status,
    location: res.headers.get('location'),
    html: res.status === 200 ? await res.text() : '',
    saved: patch?.body ?? null,
  };
}

const page = (path) =>
  fetch(`${APP}${path}`, { headers: { cookie: COOKIE } }).then((r) => r.text());

const SAVED = '/app/profile?saved=1';

/* ============================================================
   1. empty socials never block the save
   ============================================================ */

let r = await save({});
check('saves with every social empty', r.location, SAVED);

r = await save({ instagram: '', tiktok: '', facebook: '', snapchat: '', maps_url: '' });
check('saves with every optional field explicitly blank', r.location, SAVED);
check('blank socials are stored as null, not ""', [
  r.saved.instagram, r.saved.tiktok, r.saved.facebook, r.saved.snapchat, r.saved.maps_url,
], [null, null, null, null, null]);

r = await save({ instagram: 'nafin.style', snapchat: '', maps_url: '' });
check('saves with one social filled and the rest empty', r.location, SAVED);
check('the filled one is kept', r.saved.instagram, 'nafin.style');

/* ============================================================
   2. Snapchat is real
   ============================================================ */

r = await save({ snapchat: 'nafin-shop' });
check('snapchat saves', r.location, SAVED);
// Snapchat allows a hyphen where Instagram and TikTok do not.
check('snapchat keeps a hyphen', r.saved.snapchat, 'nafin-shop');

r = await save({ snapchat: '@nafin.shop' });
check('a pasted @handle is cleaned', r.saved.snapchat, 'nafin.shop');

r = await save({ snapchat: 'https://snapchat.com/add/nafin.shop' });
check('a pasted snapchat URL becomes the handle', r.saved.snapchat, 'nafin.shop');

r = await save({ snapchat: 'no spaces allowed' });
check('an impossible snapchat handle is refused', r.status, 200);

/* ============================================================
   3. location is real, and https only
   ============================================================ */

const GOOD = 'https://maps.app.goo.gl/abc123';
r = await save({ maps_url: GOOD });
check('a Google Maps link saves', r.location, SAVED);
check('and is stored as given', r.saved.maps_url, GOOD);

for (const bad of [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'http://maps.google.com/x',
  'vbscript:msgbox(1)',
  '//evil.test/maps',
  'not a url at all',
]) {
  const out = await save({ maps_url: bad });
  check(`refused: ${bad.slice(0, 28)}`, out.status, 200);
  check(`not saved: ${bad.slice(0, 28)}`, out.saved, null);
}

/* The public page renders both as things a customer can tap, next to
   the WhatsApp button — not as small print under the shop name. */
const shop = await page(`/@${SLUG}`);
check('the shop page renders the location as a button',
      /<a class="btn btn--quiet btn--maps" href="https:\/\/maps\.app\.goo\.gl\/abc123"/.test(shop), true);
check('the location button opens in a new tab, safely',
      /btn--maps[^>]*rel="noopener noreferrer"/.test(shop), true);
check('the shop page renders the snapchat link',
      shop.includes('https://snapchat.com/add/nafin-shop'), true);

/* ============================================================
   4. what Edit Profile must no longer show
   ============================================================ */

const profile = await page('/app/profile');

check('no slug field', /name="slug"/.test(profile), false);
check('no website field', /name="website"/.test(profile), false);
check('no category manager', /shop-categories|profile-categories/.test(profile), false);
check('no "view my shop" link', /link-card__view/.test(profile), false);
check('no raw shop URL printed', profile.includes(`>http`), false);
check('the workers.dev host is never rendered as text',
      /<[^>]*>[^<]*workers\.dev/.test(profile), false);
check('but the copy button still carries the link',
      profile.includes(`data-url="http`), true);
check('snapchat is a real input, not disabled',
      /id="f-snapchat"[^>]*disabled/.test(profile), false);
check('snapchat input exists', /id="f-snapchat"/.test(profile), true);
check('maps is a real input, not disabled',
      /id="f-maps"[^>]*disabled/.test(profile), false);
check('maps input exists', /name="maps_url"/.test(profile), true);

/* ============================================================
   5. @username is gone from every visible surface
   ============================================================ */

const surfaces = [
  ['public shop', `/@${SLUG}`],
  ['owner profile', '/app'],
  ['edit profile', '/app/profile'],
  ['search results', `/search?q=${encodeURIComponent('نافین')}`],
  ['onboarding step 2', '/onboarding/slug'],
];

for (const [name, path] of surfaces) {
  const html = await page(path);
  check(`${name}: no @slug in the markup`, html.includes(`@${SLUG}<`), false);
  check(`${name}: no username element`,
        /shop-username|srch-shop__username|shop-row__username|slug-row__prefix/.test(html), false);
}

/* The slug still has to work as a URL — that is the whole product. */
const live = await fetch(`${APP}/@${SLUG}`, { redirect: 'manual' });
check('/@slug still renders', live.status, 200);
check('/@slug still carries the OG image tag',
      (await live.text()).includes('og:'), true);

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
