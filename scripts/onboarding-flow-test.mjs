/**
 * Shop Web — signup through onboarding to the first published product.
 *
 * This is the half nobody had tested. Four real people signed up on the
 * live site and not one shop exists, so the wizard has never once run to
 * completion. It drives the real Worker, carrying cookies between steps
 * the way a phone does, because the bug that blocked it lived in a
 * cookie: the draft was base64'd with btoa, which throws on any code
 * point above 255 — that is every Kurdish shop name.
 *
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/onboarding-flow-test.mjs
 */

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

// A fresh address per run: ten shops a day is the real limit, and a
// test that reran eleven times would start failing on its own merits.
const CLIENT_IP = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: got === want });

const setMode = (m) => fetch(`${STUB}/__mode/${m}`).then((r) => r.json());
const createdShop = () => fetch(`${STUB}/__created`).then((r) => r.json());

/** A tiny cookie jar, so the draft really travels between steps. */
function jar() {
  const store = new Map([['sb-access', 'stub-token']]);
  return {
    header: () => [...store].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb(res) {
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        if (value === '' || /Max-Age=0/i.test(raw)) store.delete(name);
        else store.set(name, value);
      }
    },
  };
}

/**
 * The logo step is the one multipart post in the wizard, so it needs a
 * poster of its own. Built by hand rather than with FormData so the
 * bytes and the declared type can be set independently — which is what
 * makes "a .webp that is not an image" testable.
 */
async function postFile(cookies, path, { bytes, type, filename = 'logo.webp' }) {
  const boundary = '----bazaro' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `content-disposition: form-data; name="logo"; filename="${filename}"\r\n` +
    `content-type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookies.header(),
      origin: APP,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'cf-connecting-ip': CLIENT_IP,
    },
    body: Buffer.concat([head, Buffer.from(bytes), tail]),
  });
  cookies.absorb(res);
  return { status: res.status, location: res.headers.get('location'),
           html: res.status === 200 ? await res.text() : '' };
}

/** A real, tiny WebP — what ShopCrop hands back after a confirmed crop. */
const WEBP = Buffer.from(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/vuUAAA=', 'base64');

async function step(cookies, path, fields) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookies.header(),
      origin: APP,
      'content-type': 'application/x-www-form-urlencoded',
      // Cloudflare sets this on every request that reaches the Worker,
      // and the shop-creation throttle refuses without it — a request
      // with no client address cannot be rate limited, so it is not
      // allowed to create anything. wrangler dev does not add it, so
      // the harness has to, or it is testing a request production
      // cannot produce.
      'cf-connecting-ip': CLIENT_IP,
    },
    body: new URLSearchParams(fields),
  });
  cookies.absorb(res);
  const html = res.status === 200 ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location'), html };
}

async function get(cookies, path) {
  const res = await fetch(`${APP}${path}`, {
    headers: { cookie: cookies.header() }, redirect: 'manual',
  });
  cookies.absorb(res);
  const html = res.status === 200 ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location'), html };
}

/**
 * The whole wizard for one shop name. Returns each step's outcome so a
 * failure says which step broke rather than just "onboarding failed".
 */
async function runWizard(name, slug) {
  await setMode('noshop');
  const cookies = jar();

  const nameStep = await step(cookies, '/onboarding/name', { name });
  const slugStep = await step(cookies, '/onboarding/slug', { slug });
  const contact = await step(cookies, '/onboarding/contact',
    { city: 'erbil', whatsapp: '+9647510000002' });

  return { cookies, nameStep, slugStep, contact, shop: (await createdShop())[0] };
}

/* ============================================================
   1. A Kurdish shop name — the case that was broken
   ============================================================ */

let w = await runWizard('بۆتیکی نافین', 'nafin-boutique');

check('kurdish name: step 1 does not 5xx', w.nameStep.status < 500, true);
check('kurdish name: step 1 advances to the slug step', w.nameStep.location, '/onboarding/slug');
check('kurdish name: step 2 advances to contact', w.slugStep.location, '/onboarding/contact');
check('kurdish name: contact step creates the shop', w.contact.location, '/onboarding/logo');
check('kurdish name: the shop actually exists', Boolean(w.shop), true);
check('kurdish name: survived the draft cookie intact', w.shop?.name, 'بۆتیکی نافین');
check('kurdish name: slug survived too', w.shop?.slug, 'nafin-boutique');
check('kurdish name: owner is the signed-in user', Boolean(w.shop?.owner_id), true);

/* A second Kurdish name, with characters outside the first one's range. */
w = await runWizard('شیرینی خانەی دایک', 'daik-sweets');
check('second kurdish name: shop created', w.contact.location, '/onboarding/logo');
check('second kurdish name: name intact', w.shop?.name, 'شیرینی خانەی دایک');

/* A Latin name must keep working — it always did. */
w = await runWizard('HEWLER SCENT', 'hewler-scent');
check('latin name: shop created', w.contact.location, '/onboarding/logo');
check('latin name: name intact', w.shop?.name, 'HEWLER SCENT');

/* ============================================================
   2. The wizard refuses to skip steps
   ============================================================ */

await setMode('noshop');
const bare = jar();
const straightToContact = await step(bare, '/onboarding/contact',
  { city: 'erbil', whatsapp: '+9647510000002' });
check('no draft: contact step does not create a shop', straightToContact.location, '/onboarding');
check('no draft: nothing was created', (await createdShop()).length, 0);

/* A bad WhatsApp number stops at the contact step, with its own message. */
await setMode('noshop');
const badPhone = jar();
await step(badPhone, '/onboarding/name', { name: 'بۆتیکی نافین' });
await step(badPhone, '/onboarding/slug', { slug: 'nafin-boutique' });
const rejected = await step(badPhone, '/onboarding/contact', { city: 'erbil', whatsapp: 'abc' });
check('bad whatsapp: stays on the contact step', rejected.status, 200);
check('bad whatsapp: says so', rejected.html.includes('ژمارەکە'), true);
check('bad whatsapp: no shop created', (await createdShop()).length, 0);

/* ============================================================
   3. Onboarding finished -> the seller can reach /app and publish
   ============================================================ */

w = await runWizard('بۆتیکی نافین', 'nafin-boutique');

const logoSkip = await step(w.cookies, '/onboarding/logo', {});
check('logo step can be skipped', logoSkip.location, '/app');

const app = await get(w.cookies, '/app');
check('seller reaches /app after onboarding', app.status, 200);

const form = await get(w.cookies, '/app/new');
check('seller reaches the add-product form', form.status, 200);

const SHOP_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const DRAFT = 'bbbbbbbb-1111-4111-8111-111111111111';
const published = await step(w.cookies, '/app/new', {
  draft_id: DRAFT,
  images: JSON.stringify([{ card: `products/${SHOP_ID}/${DRAFT}/1-card.webp` }]),
  title: 'کراسی کوردی سەوز',
  price: '85000',
});
// Publishing lands in the seller's own manager, in owner mode. It used
// to land on the customer's copy of the product page, which has no owner
// controls and is publicly cacheable — scripts/publish-flow-test.mjs
// pins that in full.
check('first product publishes into the owner view',
  published.location === '/app', true);

/* ============================================================
   the logo step, and the cropper on it
   ============================================================

   The step used to post whatever came out of the file picker, so a
   phone camera's rectangle was squashed into a square with no say in
   which part survived — while the same seller editing the same logo
   from /app/profile got to place it. It now opens the same ShopCrop,
   with the same PROFILE_VARIANTS.logo settings.

   What the server sees is unchanged: still a multipart post to
   /onboarding/logo, still the same type and size checks. So these
   check the page carries the cropper, and that the upload path still
   accepts what the cropper produces and still refuses what it should.
   ============================================================ */

const logoStep = await fetch(`${APP}/onboarding/logo`, {
  headers: { cookie: w.cookies.header() },
}).then((r) => r.text());

check('the logo step loads the shared cropper',
  logoStep.includes('/js/crop.js'), true);
check('and the wiring that opens it',
  logoStep.includes('/js/onboarding-logo.js'), true);
check('the crop sheet is on the page',
  logoStep.includes('id="crop"'), true);
check('with its stage, done and cancel controls',
  logoStep.includes('id="crop-stage"') && logoStep.includes('id="crop-done"')
  && logoStep.includes('id="crop-cancel"'), true);
check('and the rotate control', logoStep.includes('id="crop-rotate"'), true);

// The same numbers the profile editor uses, read from the same place.
// If these drift, one screen crops the logo differently from the other.
check('a square crop', /data-logo-ratio="1"/.test(logoStep), true);
check('at the profile editor\u2019s logo width', /data-logo-w="400"/.test(logoStep), true);
check('and its quality', /data-logo-q="0\.85"/.test(logoStep), true);

// Not a second cropper: the page pulls in the shared one and nothing else.
check('no second crop implementation is shipped',
  /onboarding-crop|logo-crop\.js|crop2/.test(logoStep), false);

/* ---------- what the server accepts ---------- */

const cropped = await postFile(w.cookies, '/onboarding/logo',
  { bytes: WEBP, type: 'image/webp' });
check('a cropped WebP is accepted', cropped.status, 303);
check('and finishes onboarding at /app', cropped.location, '/app');

// The server cannot tell a cropped file from any other, which is the
// point: every check it ran before still runs.
const badType = await postFile(w.cookies, '/onboarding/logo',
  { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    type: 'image/svg+xml', filename: 'logo.svg' });
check('a type the server does not allow is still refused', badType.status, 200);
check('and the seller is sent back to the logo step, not onward',
  badType.location, null);
check('with the type message', badType.html.includes('JPG'), true);

// An empty part is how "Skip" arrives when the form posts with no file.
const emptyPart = await postFile(w.cookies, '/onboarding/logo',
  { bytes: Buffer.alloc(0), type: 'image/webp' });
check('an empty file is treated as skipping, not as an error',
  emptyPart.location, '/app');

/* ============================================================ */

await setMode('shop');

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
