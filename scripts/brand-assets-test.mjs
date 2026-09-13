/**
 * Bazaro — the brand in the head, and the share card on a link.
 *
 * Two halves. The first checks that every icon the head points at
 * actually exists at the size it claims, because a favicon tag whose
 * file 404s is worse than no tag: the browser caches the miss. These
 * fail until public/brand/bazaro-logo.png is added and
 * `node scripts/brand-icons.mjs` has been run, and that is deliberate.
 *
 * The second checks what a crawler reads. A seller's link is the whole
 * product, so /@slug must preview as the SELLER — their cover, their
 * logo, or their first product — and only fall back to Bazaro when
 * they have no image at all.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/brand-assets-test.mjs
 */
import { existsSync, statSync } from 'node:fs';
import sharp from 'sharp';
import { APP_NAME, APP_NAME_LATIN, BRAND } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const control = (p) => fetch(`${STUB}${p}`).then((r) => r.json());
const page = (p) => fetch(`${APP}${p}`).then((r) => r.text());
const meta = (html, attr, key) =>
  html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1] ?? null;
const link = (html, rel) =>
  [...html.matchAll(/<link rel="([^"]*)"[^>]*href="([^"]*)"/g)]
    .filter(([, r]) => r.split(' ').includes(rel)).map(([, , href]) => href);

/* ---------- 1. the files the head promises ---------- */

const expected = [
  ['public/brand/bazaro-logo.png', null],
  ['public/brand/favicon-16.png', 16],
  ['public/brand/favicon-32.png', 32],
  ['public/brand/favicon-48.png', 48],
  ['public/brand/apple-touch-icon.png', 180],
  ['public/brand/icon-192.png', 192],
  ['public/brand/icon-512.png', 512],
];

for (const [file, size] of expected) {
  const there = existsSync(file);
  check(`${file} exists`, there);
  if (!there || size === null) continue;
  const m = await sharp(file).metadata();
  check(`${file} is ${size}x${size}`, [m.width, m.height], [size, size]);
}

check('public/favicon.ico exists', existsSync('public/favicon.ico'));
if (existsSync('public/favicon.ico')) {
  // 6-byte header, then one 16-byte entry per size. Byte 4 is the count.
  const ico = statSync('public/favicon.ico');
  check('favicon.ico is not empty', ico.size > 100);
}

check('the share card exists', existsSync('public/brand/og-default.png'));
if (existsSync('public/brand/og-default.png')) {
  const m = await sharp('public/brand/og-default.png').metadata();
  check('the share card is 1200x630', [m.width, m.height], [1200, 630]);
}

/* ---------- 2. the head ---------- */

await control('/__mode/shop');
const home = await page('/');

check('the tab icon is linked at 32 and 16', link(home, 'icon').length >= 3);
check('the apple touch icon is linked', link(home, 'apple-touch-icon')[0], BRAND.appleTouch);
check('the manifest is linked', link(home, 'manifest')[0], BRAND.manifest);
check('the .ico is offered for old Windows', link(home, 'icon').includes(BRAND.ico));
check('the home screen name is Latin', /apple-mobile-web-app-title" content="Bazaro"/.test(home));
check('the site name a crawler reads is Bazaro',
  meta(home, 'property', 'og:site_name'), APP_NAME_LATIN);
check('and the visible brand is still Kurdish', home.includes(APP_NAME));

const manifest = await fetch(`${APP}/site.webmanifest`).then((r) => r.json());
check('the manifest names Bazaro', manifest.name, 'Bazaro');
check('and carries both app icon sizes',
  manifest.icons.filter((i) => /192|512/.test(i.sizes)).length >= 2);

/* ---------- 3. a generic page falls back to the Bazaro card ---------- */

check('a generic page has a share image', meta(home, 'property', 'og:image') !== null);
check('and it is the Bazaro card', meta(home, 'property', 'og:image')?.endsWith(BRAND.ogImage));
check('absolute, or every crawler drops it',
  /^https?:\/\//.test(meta(home, 'property', 'og:image') || ''));
check('sized, so it is not re-cropped',
  [meta(home, 'property', 'og:image:width'), meta(home, 'property', 'og:image:height')],
  [String(BRAND.ogWidth), String(BRAND.ogHeight)]);
check('twitter reads the same card',
  meta(home, 'name', 'twitter:image'), meta(home, 'property', 'og:image'));
check('and is told it is a large card',
  meta(home, 'name', 'twitter:card'), 'summary_large_image');

/* ---------- 4. a seller's link previews the SELLER ----------

   The ladder, in order: their cover, then their logo, then their first
   product, and only then Bazaro. A seller's link is the whole product,
   so it must never preview as somebody else's brand while they have an
   image of their own.
   ---------------------------------------------------------------- */

const shopOgFor = async () =>
  meta(await page('/@nafin-boutique'), 'property', 'og:image');

await control('/__cover/' + encodeURIComponent('shops/aaa/cover.webp'));
await control('/__logo/' + encodeURIComponent('shops/aaa/logo.webp'));
await control('/__productimg/' + encodeURIComponent('products/aaa/p1.webp'));
check('the cover wins when there is one', (await shopOgFor())?.endsWith('/img/shops/aaa/cover.webp'));

await control('/__cover/-');
check('then the shop logo', (await shopOgFor())?.endsWith('/img/shops/aaa/logo.webp'));

await control('/__logo/-');
check('then the first product image', (await shopOgFor())?.endsWith('/img/products/aaa/p1.webp'));

await control('/__productimg/-');
const bare = await shopOgFor();
check('and only a shop with no image at all falls back to Bazaro',
  bare?.endsWith(BRAND.ogImage));

// Back to a shop with a cover for the remaining assertions.
await control('/__cover/' + encodeURIComponent('shops/aaa/cover.webp'));
await control('/__productimg/' + encodeURIComponent('products/aaa/p1.webp'));
const shop = await page('/@nafin-boutique');
const shopOg = meta(shop, 'property', 'og:image');

check('the shop title is the shop, then Bazaro',
  /<title>بۆتیکی نافین — بازاڕۆ<\/title>/.test(shop));
check('the preview is absolute', /^https?:\/\//.test(shopOg || ''));
check('server-rendered, so a crawler needs no JavaScript',
  shop.includes('og:image') && shop.includes('<title>'));
check('twitter gets the same seller image', meta(shop, 'name', 'twitter:image'), shopOg);
check('the type says it is a profile', meta(shop, 'property', 'og:type'), 'profile');

/* ---------- 5. a product link previews the product ---------- */

const product = await page('/@nafin-boutique/p/bbbbbbbb-1111-4111-8111-111111111111');
const productOg = meta(product, 'property', 'og:image');

check('the product preview is the product image',
  productOg?.endsWith('/img/products/aaa/p1.webp'));
check('not replaced by the Bazaro logo', productOg?.includes('/brand/'), false);
check('and it is absolute', /^https?:\/\//.test(productOg || ''));
check('the product title leads with the product',
  /<title>کراسی کوردی — /.test(product));

// A product with no image of its own borrows the shop's cover before
// it ever borrows Bazaro's.
await control('/__productimg/-');
const bareProduct = await page('/@nafin-boutique/p/bbbbbbbb-1111-4111-8111-111111111111');
check('a product with no image falls back to the shop cover, not Bazaro',
  meta(bareProduct, 'property', 'og:image')?.endsWith('/img/shops/aaa/cover.webp'));

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}` +
    (r.pass ? '' : `\n     got ${JSON.stringify(r.got)} want ${JSON.stringify(r.want)}`));
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
