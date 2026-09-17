/**
 * Bazaro — what a crawler reads.
 *
 * Google and the crawlers behind AI answers see none of the app: they
 * see robots.txt, sitemap.xml, the head, and the JSON-LD. Each of those
 * fails silently — a sitemap full of 404s, a Disallow that hides the
 * shops, a JSON-LD block with a stray character in it — and the only
 * symptom is traffic that never arrives. So they are asserted here.
 *
 * The sharpest check is the last one: every URL the sitemap advertises
 * is fetched, and has to answer 200. The first version of this sitemap
 * percent-encoded the `@` in /@slug, and every shop and product URL in
 * it 404'd; nothing else in this file would have noticed.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/seo-test.mjs
 */
import { SITE_ORIGIN, SITE_IDENTITY, APP_NAME, APP_NAME_LATIN } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const SHOP_PATH = '/@nafin-boutique';
const PRODUCT_PATH = `${SHOP_PATH}/p/bbbbbbbb-1111-4111-8111-111111111111`;

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const control = (p) => fetch(STUB + p).then((r) => r.json());
const text = (p) => fetch(APP + p).then((r) => r.text());
const head = (html, re) => html.match(re)?.[1] ?? null;
const blocks = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);

/** Parse every block, or fail loudly — an unparseable block is invisible to Google. */
function parsed(html, label) {
  return blocks(html).map((raw) => {
    try { return JSON.parse(raw); } catch (e) {
      check(`${label}: JSON-LD parses`, e.message, 'no error');
      return null;
    }
  }).filter(Boolean);
}

const flatten = (ld) => (ld['@graph'] ? ld['@graph'] : [ld]);
const typed = (all, type) => all.flatMap(flatten).find((n) => n['@type'] === type) ?? null;

// The stub shop needs the public details the Store block reports.
await control('/__mode/shop');
await control('/__rows/1');

/* ============================================================
   1. robots.txt
   ============================================================ */

const robots = await text('/robots.txt');

check('robots.txt is served', robots.includes('User-agent'), true);
check('it allows every crawler', /User-agent:\s*\*/.test(robots), true);
check('and allows the site root', /^Allow:\s*\/$/m.test(robots), true);
check('it points at the sitemap on the canonical domain',
  robots.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`), true);

// The failure that would quietly delist the whole product.
check('nothing disallows the site root', /^Disallow:\s*\/$/m.test(robots), false);
check('Googlebot is never singled out', /User-agent:\s*Googlebot/i.test(robots), false);
check('no AI or search crawler is named and blocked',
  /(GPTBot|ClaudeBot|Google-Extended|bingbot|PerplexityBot)/i.test(robots), false);

// Public surfaces must not be disallowed, by prefix or by wildcard.
for (const pattern of ['/@', '/search', '/img/']) {
  check(`robots does not disallow ${pattern}`,
    new RegExp(`^Disallow:\\s*\\${pattern[0]}${pattern.slice(1)}`, 'm').test(robots), false);
}

// Signed-in areas are excluded — they have nothing a result could show.
for (const path of ['/app', '/onboarding', '/saved', '/api/', '/auth/']) {
  check(`robots keeps ${path} out of the index`,
    new RegExp(`^Disallow:\\s*${path.replace('/', '\\/')}`, 'm').test(robots), true);
}

/* ---------- /admin is not named, on purpose ----------
   A Disallow line is a public list of a site's paths. /admin answers
   with the ordinary 404 to everyone who is not a signed-in admin, so
   naming it in robots.txt would advertise the one address CLAUDE.md
   says must not be discoverable. */
check('robots.txt never reveals that /admin exists', /admin/i.test(robots), false);

/* ============================================================
   2. sitemap.xml
   ============================================================ */

const sitemap = await text('/sitemap.xml');

check('sitemap declares XML', sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), true);
check('with the sitemaps.org namespace',
  sitemap.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'), true);
check('tags are balanced',
  (sitemap.match(/<url>/g) || []).length === (sitemap.match(/<\/url>/g) || []).length, true);
check('and every loc is closed',
  (sitemap.match(/<loc>/g) || []).length === (sitemap.match(/<\/loc>/g) || []).length, true);

const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check('the homepage is listed', locs.includes(`${SITE_ORIGIN}/`), true);
check('the public shop is listed', locs.includes(`${SITE_ORIGIN}${SHOP_PATH}`), true);
check('the public product is listed', locs.includes(`${SITE_ORIGIN}${PRODUCT_PATH}`), true);

check('every URL is absolute on the canonical domain',
  locs.every((u) => u.startsWith(`${SITE_ORIGIN}/`)), true);
check('none is on the request host',
  locs.some((u) => u.includes('127.0.0.1') || u.includes('workers.dev')), false);
check('no private path is advertised',
  locs.some((u) => /\/(admin|app|login|signup|onboarding|saved|api|auth)\b/.test(u)), false);
check('no URL is listed twice', locs.length, new Set(locs).size);

// The `@` bug: %40 is a different path to the router, and 404s.
check('shop URLs keep the @ unencoded', locs.some((u) => u.includes('%40')), false);

check('lastmod, where present, is a valid date',
  [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)]
    .every((m) => !Number.isNaN(new Date(m[1]).getTime())), true);

/* ---------- the check that matters: they must all resolve ---------- */
for (const url of locs) {
  const path = url.slice(SITE_ORIGIN.length);
  const res = await fetch(APP + path, { redirect: 'manual' });
  check(`sitemap URL resolves: ${path}`, res.status, 200);
}

/* ============================================================
   3. homepage identity
   ============================================================ */

const home = await text('/');
const homeLd = parsed(home, 'home');
const website = typed(homeLd, 'WebSite');
const org = typed(homeLd, 'Organization');

check('the homepage carries a WebSite block', Boolean(website), true);
check('named Bazaro', website?.name, APP_NAME_LATIN);
check('with the Kurdish name as an alternate',
  website?.alternateName?.includes(APP_NAME), true);
check('and the bare domain as an alternate',
  website?.alternateName?.includes('bazarnow.xyz'), true);
check('pointing at the canonical domain', website?.url, `${SITE_ORIGIN}/`);
check('and it is the identity config, not a second copy',
  website?.url, SITE_IDENTITY.url);

check('the homepage carries an Organization block', Boolean(org), true);
check('also named Bazaro', org?.name, APP_NAME_LATIN);
check('the WebSite names that Organization as its publisher',
  website?.publisher?.['@id'], org?.['@id']);

check('og:site_name is Bazaro', head(home, /og:site_name" content="([^"]*)"/), APP_NAME_LATIN);
check('the homepage has a title', (head(home, /<title>([^<]*)<\/title>/) || '').length > 0, true);
check('and explains the marketplace',
  head(home, /name="description" content="([^"]*)"/), SITE_IDENTITY.description);
check('and uses the production canonical',
  head(home, /rel="canonical" href="([^"]*)"/), `${SITE_ORIGIN}/`);

// A filtered view of the feed is the same site, not another one.
check('a search view carries no second WebSite block',
  parsed(await text('/search?q=a'), 'search').some((ld) => typed([ld], 'WebSite')), false);

/* ============================================================
   4. shop page
   ============================================================ */

const shop = await text(SHOP_PATH);
const store = typed(parsed(shop, 'shop'), 'Store');

check('the shop page carries a Store block', Boolean(store), true);
check('with the shop name', store?.name, 'بۆتیکی نافین');
check('its canonical URL', store?.url, `${SITE_ORIGIN}${SHOP_PATH}`);
check('the public WhatsApp number it already shows', store?.telephone, '+9647510000002');
check('the public city it already shows', store?.address?.addressLocality, 'erbil');
check('its intentionally public social profile is discoverable',
  store?.sameAs?.includes('https://snapchat.com/add/nafin-shop'), true);
check('and it belongs to Bazaro', store?.parentOrganization?.['@id'], org?.['@id']);
check('the shop page uses the production canonical',
  head(shop, /rel="canonical" href="([^"]*)"/), `${SITE_ORIGIN}${SHOP_PATH}`);

// Requirement 6: already-public shop detail is in the server HTML.
check('shop name is server-rendered', shop.includes('بۆتیکی نافین'), true);
check('public location is server-rendered', shop.includes('هەولێر'), true);
check('public WhatsApp is server-rendered', shop.includes('wa.me/9647510000002'), true);

// And nothing private leaked in with it.
check('no owner id on the public page', /owner_id|owner-id/.test(shop), false);
check('no email address on the public page', /[\w.]+@[\w.]+\.\w+/.test(store ? JSON.stringify(store) : ''), false);

/* ============================================================
   5. product page
   ============================================================ */

await control('/__platformcategory/clothing');
const productHtml = await text(PRODUCT_PATH);
const all = parsed(productHtml, 'product');
const product = typed(all, 'Product');
const crumbs = typed(all, 'BreadcrumbList');

check('the product page carries a Product block', Boolean(product), true);
check('with the product name', product?.name, 'کراسی کوردی');
check('and its canonical URL', product?.url, `${SITE_ORIGIN}${PRODUCT_PATH}`);
check('an Offer', product?.offers?.['@type'], 'Offer');
check('priced as the seller typed it', product?.offers?.price, '85000');
check('in the currency the seller chose', product?.offers?.priceCurrency, 'IQD');
check('with its public category', product?.category, 'جل');
check('without invented availability', 'availability' in (product?.offers ?? {}), false);
check('without treating the seller as a manufacturer brand', 'brand' in (product ?? {}), false);
check('sold by the shop', product?.offers?.seller?.name, 'بۆتیکی نافین');
check('which links back to the shop page',
  product?.offers?.seller?.url, `${SITE_ORIGIN}${SHOP_PATH}`);
check('the product page uses the production canonical',
  head(productHtml, /rel="canonical" href="([^"]*)"/), `${SITE_ORIGIN}${PRODUCT_PATH}`);

/* ---------- nothing invented ----------
   Google penalises structured data that the page cannot support, and
   Bazaro holds none of these facts about any product. */
for (const field of ['aggregateRating', 'review', 'sku', 'gtin', 'gtin13',
                     'mpn', 'priceValidUntil', 'itemCondition', 'weight']) {
  check(`no invented ${field}`, field in (product ?? {}) || field in (product?.offers ?? {}), false);
}
check('no inventory count is claimed',
  JSON.stringify(product ?? {}).includes('inventoryLevel'), false);
check('no private credential or owner field leaks into public structured data',
  /(SUPABASE_SERVICE_ROLE_KEY|WAYL_API_TOKEN|VIEW_SALT|owner_id)/.test(JSON.stringify(all)), false);

check('a breadcrumb places it under Bazaro and the shop',
  crumbs?.itemListElement?.map((i) => i.name),
  [APP_NAME_LATIN, 'بۆتیکی نافین', 'کراسی کوردی']);

/* ---------- USD renders as USD, not folded to dinars ---------- */
await control('/__currency/USD');
const usd = typed(parsed(await text(PRODUCT_PATH), 'usd'), 'Product');
check('a dollar product is offered in USD', usd?.offers?.priceCurrency, 'USD');
check('at the number the seller typed, unconverted', usd?.offers?.price, '85000');
await control('/__currency/IQD');
await control('/__platformcategory/-');

/* ============================================================
   6. the admin area stays invisible
   ============================================================ */

check('sitemap lists nothing under /admin', sitemap.toLowerCase().includes('admin'), false);
const adminRes = await fetch(APP + '/admin', { redirect: 'manual' });
check('/admin is still the ordinary 404 for a crawler', adminRes.status, 404);

/* ---------- report ---------- */
for (const r of results) {
  if (r.pass) console.log('PASS ' + r.name);
  else console.log(`FAIL  ${r.name}\n      got  ${JSON.stringify(r.got)}\n      want ${JSON.stringify(r.want)}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} of ${results.length} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
