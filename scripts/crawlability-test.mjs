/**
 * Bazaro — a crawler with no JavaScript can read every public page.
 *
 * /@slug is the whole product: a seller pastes it into TikTok, and
 * Google, Bing and the crawlers behind AI answers all have to be able
 * to read what is on it. None of them run JavaScript, and none of them
 * send a cookie. So the rule this pins is narrow and absolute: the
 * title, the price, the link and the photo of every public product are
 * in the first response, in the markup, for an anonymous caller.
 *
 * It also pins the thing that is easy to break by accident — that a
 * crawler is served exactly what a person is served. The app has no
 * user-agent branching and must never grow any: cloaking is what gets
 * a domain removed from an index, and a "just for Googlebot" shortcut
 * is how it starts.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/crawlability-test.mjs
 */
const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const SLUG = 'nafin-boutique';
const PRODUCT = 'bbbbbbbb-1111-4111-8111-111111111111';
const SHOP_PATH = `/@${SLUG}`;
const PRODUCT_PATH = `/@${SLUG}/p/${PRODUCT}`;

/** The three the owner named, plus the two big search engines. */
const CRAWLERS = {
  Googlebot:
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'OAI-SearchBot': 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  'ChatGPT-User': 'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)',
  Bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  Twitterbot: 'Twitterbot/1.0',
};

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const set = (path) => fetch(STUB + path).then((r) => r.json());
const text = (path, headers = {}) => fetch(APP + path, { headers }).then((r) => r.text());

/** Every JSON-LD block on a page, parsed. */
function ld(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .flatMap((m) => {
      const parsed = JSON.parse(m[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')
        .replace(/\\u0026/g, '&'));
      return parsed['@graph'] ?? [parsed];
    });
}
const ofType = (html, type) => ld(html).find((node) => node['@type'] === type) ?? null;

await set('/__rows/1');
await set('/__mode/shop');
await set('/__products/1');
await set('/__visibility/everyone');
await set('/__productimg/' + encodeURIComponent('products/dress.jpg'));
await set('/__cover/' + encodeURIComponent('shops/cover.webp'));
await set('/__logo/' + encodeURIComponent('shops/logo.webp'));

/* ================================================================
   1. the shop page, as a crawler receives it
   ================================================================ */
const shop = await text(SHOP_PATH);

check('shop page names the shop', shop.includes('بۆتیکی نافین'));
check('shop page carries the product title in the markup',
  /<h2 class="card__title">کراسی کوردی<\/h2>/.test(shop));
check('and the price as readable text, not only a data attribute',
  /<span class="card__amount">85,000<\/span>/.test(shop));
check('and the currency beside it', /<span class="card__currency">د\.ع<\/span>/.test(shop));
check('and a real link to the product page',
  shop.includes(`href="${PRODUCT_PATH}"`));
check('and a real src on the first product photo, not a data-src placeholder',
  /<img class="card__img is-active" src="\/img\/products\/dress\.jpg"/.test(shop));

// The photo is the product, so it is named. alt="" tells a screen
// reader and an image crawler alike that the image can be skipped.
check('the product photo is named after the product',
  /<img class="card__img is-active"[^>]*alt="کراسی کوردی"/.test(shop));
check('the shop banner is named after the shop',
  /<img class="shop-banner__img"[^>]*alt="بۆتیکی نافین"/.test(shop));

/* ---- the products, said outright rather than left to be parsed ---- */
const list = ofType(shop, 'ItemList');
check('the shop page lists its products as structured data', list !== null);
check('the count is the number of products on the page', list?.numberOfItems, 1);
const entry = list?.itemListElement?.[0];
check('the first entry is a Product', entry?.item?.['@type'], 'Product');
check('with the title that is on the card', entry?.item?.name, 'کراسی کوردی');
check('a link to its own page',
  entry?.item?.url, `https://bazarnow.xyz${PRODUCT_PATH}`);
check('its photo, absolute',
  entry?.item?.image, 'https://bazarnow.xyz/img/products/dress.jpg');
check('the price the seller typed', entry?.item?.offers?.price, '85000');
check('in the currency they chose', entry?.item?.offers?.priceCurrency, 'IQD');
check('and the seller is the Store already on the page, not a second copy',
  entry?.item?.offers?.seller?.['@id'], `https://bazarnow.xyz${SHOP_PATH}#shop`);
check('the Store block is still there too', ofType(shop, 'Store')?.name, 'بۆتیکی نافین');

/* ---- a filtered view describes itself honestly ----
   A category chip shows a subset while the canonical URL still points
   at the whole shop, so the list is left off rather than describing a
   page that address does not serve. */
const filtered = await text(`${SHOP_PATH}?category=fashion`);
check('a category-filtered shop page claims no product list',
  ofType(filtered, 'ItemList'), null);
check('but still says which shop it is', ofType(filtered, 'Store')?.name, 'بۆتیکی نافین');

/* ---- a product with no photo claims no photo ---- */
await set('/__productimg/-');
const imageless = ofType(await text(SHOP_PATH), 'ItemList');
check('an imageless product is listed', imageless?.numberOfItems, 1);
check('but no image is invented for it',
  'image' in (imageless?.itemListElement?.[0]?.item ?? {}), false);
await set('/__productimg/' + encodeURIComponent('products/dress.jpg'));

/* ================================================================
   2. the product page, without JavaScript
   ================================================================ */
const product = await text(PRODUCT_PATH);

check('product page carries the title in the markup', product.includes('کراسی کوردی'));
check('and the shop name', product.includes('بۆتیکی نافین'));
check('and the price as text', /85,000/.test(product));
check('and a real src on the photo',
  /<img class="carousel__img" src="\/img\/products\/dress\.jpg"/.test(product));
check('the photo is named after the product',
  /<img class="carousel__img"[^>]*alt="کراسی کوردی"/.test(product));
check('canonical points at the canonical domain',
  product.includes(`<link rel="canonical" href="https://bazarnow.xyz${PRODUCT_PATH}">`));

const productLd = ofType(product, 'Product');
check('a Product block is present', productLd !== null);
check('named', productLd?.name, 'کراسی کوردی');
check('priced', productLd?.offers?.price, '85000');
check('in a currency', productLd?.offers?.priceCurrency, 'IQD');
check('sold by the shop', productLd?.offers?.seller?.name, 'بۆتیکی نافین');
check('with its photo', productLd?.image?.[0], 'https://bazarnow.xyz/img/products/dress.jpg');
check('and a breadcrumb above it', ofType(product, 'BreadcrumbList') !== null);

/* ================================================================
   3. nothing public is told not to be indexed
   ================================================================ */
for (const path of ['/', SHOP_PATH, PRODUCT_PATH, '/search?q=a']) {
  const res = await fetch(APP + path);
  check(`${path} is 200 for an anonymous caller`, res.status, 200);
  check(`${path} sends no x-robots-tag`, res.headers.get('x-robots-tag'), null);
  check(`${path} carries no noindex meta`,
    /<meta[^>]+name="robots"[^>]*noindex/i.test(await res.text()), false);
}

const imageRes = await fetch(APP + '/img/products/dress.jpg');
check('/img/ is readable', imageRes.status, 200);
check('/img/ sends no x-robots-tag', imageRes.headers.get('x-robots-tag'), null);

/* ================================================================
   4. robots.txt lets the public pages through, and only those
   ================================================================ */
const robots = await text('/robots.txt');
const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1]);
const blocked = (path) => disallowed.some((rule) => path.startsWith(rule));

for (const path of ['/', SHOP_PATH, PRODUCT_PATH, '/img/products/dress.jpg', '/search']) {
  check(`robots.txt leaves ${path} crawlable`, blocked(path), false);
}
for (const path of ['/app', '/app/new', '/onboarding', '/login', '/signup',
                    '/forgot', '/reset', '/logout', '/saved',
                    '/api/feed', '/auth/callback', '/webhooks/wayl/x']) {
  check(`robots.txt keeps ${path} out`, blocked(path), true);
}
check('robots.txt advertises the sitemap',
  robots.includes('Sitemap: https://bazarnow.xyz/sitemap.xml'));
// /admin answers 404 to everybody who is not an admin, so naming it in
// a Disallow line would publish an address that is otherwise unfindable.
check('robots.txt does not advertise /admin', robots.includes('/admin'), false);

/* ================================================================
   5. the sitemap offers the public pages
   ================================================================ */
const sitemap = await text('/sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check('sitemap lists the homepage', locs.includes('https://bazarnow.xyz/'));
check('sitemap lists the shop', locs.includes(`https://bazarnow.xyz${SHOP_PATH}`));
check('sitemap lists the product', locs.includes(`https://bazarnow.xyz${PRODUCT_PATH}`));
check('every sitemap URL is on the canonical domain',
  locs.every((url) => url.startsWith('https://bazarnow.xyz/')), true);
// A %40 in place of @ is a 404, and a sitemap full of 404s is worse
// than no sitemap at all.
check('no sitemap URL escaped the @', locs.some((url) => url.includes('%40')), false);
for (const url of locs) {
  const res = await fetch(APP + new URL(url).pathname);
  check(`sitemap URL ${new URL(url).pathname} really answers 200`, res.status, 200);
}

/* ================================================================
   6. a crawler is served what a person is served
   ================================================================ */
for (const [name, agent] of Object.entries(CRAWLERS)) {
  for (const [label, path, anonymous] of [
    ['shop', SHOP_PATH, shop],
    ['product', PRODUCT_PATH, product],
  ]) {
    const res = await fetch(APP + path, { headers: { 'user-agent': agent } });
    check(`${name} gets 200 on the ${label} page`, res.status, 200);
    check(`${name} is served byte-for-byte what an anonymous visitor gets (${label})`,
      (await res.text()) === anonymous, true);
  }
  const robotsRes = await fetch(APP + '/robots.txt', { headers: { 'user-agent': agent } });
  check(`${name} can read robots.txt`, robotsRes.status, 200);
}

/* ================================================================
   7. and none of that opened a private door
   ================================================================ */

// Anything that needs a session still sends the crawler to /login.
// Being friendly to a crawler is a property of the public pages only.
for (const path of ['/app/new', '/app/profile', '/app/settings', '/onboarding']) {
  for (const [name, agent] of Object.entries(CRAWLERS)) {
    const res = await fetch(APP + path, {
      headers: { 'user-agent': agent }, redirect: 'manual',
    });
    check(`${name} is sent to login from ${path}`, res.status, 303);
    check(`${name} is sent to login and nowhere else from ${path}`,
      (res.headers.get('location') || '').startsWith('/login'), true);
  }
}

// /app and /saved do answer 200 without a session — they are the
// signed-out Account and Saved shells, which hold nothing of anyone's.
// What matters is that a crawler is given no signed-in content there,
// and that robots.txt keeps both out of an index anyway (checked above).
for (const path of ['/app', '/saved']) {
  for (const [name, agent] of Object.entries(CRAWLERS)) {
    const body = await text(path, { 'user-agent': agent });
    check(`${name} sees no seller content on ${path}`,
      /card__title|بۆتیکی نافین|adm-/.test(body), false);
    check(`${name} sees no sign-out control on ${path}`,
      /action="\/logout"/.test(body), false);
  }
}

// /admin must not even admit to existing, crawler or not.
for (const path of ['/admin', '/admin/shops', `/admin/shops/${PRODUCT}`]) {
  for (const [name, agent] of Object.entries(CRAWLERS)) {
    const res = await fetch(APP + path, {
      headers: { 'user-agent': agent }, redirect: 'manual',
    });
    check(`${name} gets the ordinary 404 for ${path}`, res.status, 404);
  }
}

/* ---------- report ---------- */
for (const r of results) {
  if (r.pass) console.log('PASS ' + r.name);
  else console.log(`FAIL  ${r.name}\n      got  ${JSON.stringify(r.got)}\n      want ${JSON.stringify(r.want)}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} of ${results.length} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
