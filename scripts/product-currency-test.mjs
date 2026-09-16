/**
 * Shop Web — a product is priced in dinars or in dollars, never both.
 *
 * The rule this pins, which reverses migration 0012:
 *
 *   * One price, one currency, chosen per product. Default IQD.
 *   * Nothing converts. Switching the selector leaves the number the
 *     seller typed exactly as they typed it — there is no rate in this
 *     app, and inventing one silently is the worst thing this screen
 *     could do.
 *   * IQD reads `25,000 د.ع`. USD reads `$25`, symbol first, no space.
 *   * The currency follows the product into every view: the feed, the
 *     public shop profile, search, saved, the detail page, its link
 *     preview, the seller's manager and back into the edit form.
 *   * Wayl, subscriptions and payments are untouched and still IQD.
 *
 * Drives the real Worker against scripts/stub-supabase.mjs:
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8810 --local
 *   node scripts/product-currency-test.mjs
 */

import { moneyText, moneyHtml, currencyOf, symbolOf } from '../worker/render/money.js';
import { DEFAULT_CURRENCY, PRODUCT_CURRENCIES, PRODUCT as P } from '../worker/config.js';

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
const setCurrency = (c) => control(`/__currency/${c}`);
const writes = () => control('/__writes');
const resetCalls = () => control('/__calls/reset');

const img = (n) => ({ card: `products/${SHOP}/${DRAFT}/${n}-card.webp`,
                      full: `products/${SHOP}/${DRAFT}/${n}-full.webp` });
const gallery = (n = 1) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => img(i + 1)));

const get = (path, headers) =>
  fetch(`${APP}${path}`, { redirect: 'manual', headers: headers || {} });
const html = async (path, headers) => (await get(path, headers)).text();
const asSeller = (path) => html(path, { cookie: COOKIE });

async function publish(fields) {
  const res = await fetch(`${APP}/app/new`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: COOKIE, origin: APP,
               'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ draft_id: DRAFT, ...fields }),
  });
  return { status: res.status, location: res.headers.get('location'),
           html: res.status === 200 ? await res.text() : '' };
}

const MINIMUM = { images: gallery(), title: 'کراسی کوردی', price: '25000' };

/** The currency of the last row the Worker sent to the products table. */
async function lastWrittenCurrency() {
  const all = await writes();
  const rows = all.filter((w) => /products/.test(w.table ?? w.path ?? '')
                                 && (w.method === 'POST' || w.method === 'PATCH'));
  const body = rows[rows.length - 1]?.body;
  return body ? { has: 'currency' in body, value: body.currency, price: body.price } : null;
}

await setMode('shop');
await control('/__plan/year_1');
await control('/__sub/20');

/* ============================================================
   1. the formatter — the two shapes, decided in one place
   ============================================================ */

check('IQD reads as the mockups do', moneyText(25000, 'IQD'), '25,000 د.ع');
check('USD puts the symbol first, with no space', moneyText(25, 'USD'), '$25');
check('a bigger USD price keeps the separators', moneyText(1500, 'USD'), '$1,500');

// v1 is integer-only: the seller cannot type cents, and a stray fraction
// must not render half a price.
check('USD is whole dollars in v1', moneyText(49.99, 'USD'), '$50');
check('IQD is whole dinars too', moneyText(25000.6, 'IQD'), '25,001 د.ع');

// The read path is forgiving, because a price has to render as
// something and dinars is what every product was.
check('a row with no currency reads as the default',
  moneyText(25000, undefined), '25,000 د.ع');
check('and so does an unknown one', moneyText(25000, 'EUR'), '25,000 د.ع');
check('the default is IQD', DEFAULT_CURRENCY, 'IQD');
check('exactly two currencies exist', Object.keys(PRODUCT_CURRENCIES), ['IQD', 'USD']);
check('currencyOf folds anything unknown home', currencyOf('GBP'), 'IQD');
check('and keeps a real one', currencyOf('USD'), 'USD');
check('symbolOf answers the form', [symbolOf('IQD'), symbolOf('USD')], ['د.ع', '$']);

// The markup, and the two facts a view needs from it.
const iqdHtml = moneyHtml(25000, 'IQD', { cls: 'card__price', amountClass: 'card__amount', currencyClass: 'card__currency' });
const usdHtml = moneyHtml(25, 'USD', { cls: 'card__price', amountClass: 'card__amount', currencyClass: 'card__currency' });
check('IQD emits the number before the symbol',
  iqdHtml.indexOf('25,000') < iqdHtml.indexOf('د.ع'));
check('USD emits the symbol before the number',
  usdHtml.indexOf('$') < usdHtml.indexOf('>25<'));
check('each price says which currency it is in',
  /data-currency="USD"/.test(usdHtml) && /data-currency="IQD"/.test(iqdHtml));
check('and carries the finished string for anything copying it',
  /data-money="\$25"/.test(usdHtml));

/* ============================================================
   2. the form: one price input, one currency choice
   ============================================================ */

const form = await asSeller('/app/new');

check('the form offers a currency control', /id="currency-seg"/.test(form));
check('it names the dinar', form.includes(PRODUCT_CURRENCIES.IQD.label));
check('and the dollar', form.includes(PRODUCT_CURRENCIES.USD.label));
check('with both symbols visible', form.includes('د.ع') && form.includes('$'));

// One input. Two radios of one name. Not two price fields.
check('there is exactly one price input',
  (form.match(/name="price"/g) || []).length, 1);
check('and exactly two currency options',
  (form.match(/name="currency"/g) || []).length, 2);
check('they are radios, so the browser enforces exactly one',
  (form.match(/type="radio" name="currency"/g) || []).length, 2);
check('and exactly one of them is checked',
  (form.match(/name="currency"[^>]*checked/g) || []).length, 1);

// Default.
check('a new product starts on IQD',
  /value="IQD"[^>]*checked/.test(form));
check('the dollar is offered but not selected',
  /value="USD"[^>]*checked/.test(form), false);
check('and the unit beside the input matches', /id="price-unit">د\.ع</.test(form));

// Not a dropdown, and not a second amount.
check('no currency dropdown', /<select[^>]*name="currency"/.test(form), false);
check('no second price field', /name="price_usd"|name="usd_price"/.test(form), false);
check('and nothing offering a conversion',
  /نرخی گۆڕین|convert|exchange|rate/i.test(form), false);

/* ============================================================
   3. what gets stored
   ============================================================ */

await resetCalls();
let r = await publish(MINIMUM);
check('publishing with no currency named still publishes', r.location, '/app');
let stored = await lastWrittenCurrency();
check('and stores IQD', stored?.value, 'IQD');

await resetCalls();
r = await publish({ ...MINIMUM, currency: 'IQD' });
check('choosing dinars publishes', r.location, '/app');
check('and stores IQD', (await lastWrittenCurrency())?.value, 'IQD');

await resetCalls();
r = await publish({ ...MINIMUM, currency: 'USD', price: '25' });
check('choosing dollars publishes', r.location, '/app');
stored = await lastWrittenCurrency();
check('and stores USD', stored?.value, 'USD');
check('with the number the seller typed, unconverted', stored?.price, 25);

// Exactly one currency is stored: one key, one scalar, no second amount.
await resetCalls();
await publish({ ...MINIMUM, currency: 'USD', price: '25' });
const row = (await writes())
  .filter((w) => w.method === 'POST' && w.table === 'products').pop()?.body ?? {};
check('the row has one currency key',
  Object.keys(row).filter((k) => /currenc/i.test(k)), ['currency']);
check('and one price key',
  Object.keys(row).filter((k) => /price|amount/i.test(k)), ['price']);
check('the currency is a plain scalar', typeof row.currency, 'string');

/* ---------- the server does not trust the browser ---------- */

for (const bad of ['EUR', 'usd', 'iqd', 'GBP', 'USD;DROP', '1', 'null', '["USD"]', 'IQD,USD']) {
  await resetCalls();
  const res = await publish({ ...MINIMUM, currency: bad });
  check(`${JSON.stringify(bad)} is refused`, res.status, 200);
  check(`${JSON.stringify(bad)} names the currency, not the price`,
    res.html.includes(P.errCurrency), true);
  const wrote = (await writes()).some((w) => w.method === 'POST' && /products/.test(w.table ?? ''));
  check(`${JSON.stringify(bad)} never reached the database`, wrote, false);
}

// Surrounding whitespace is trimmed rather than refused: it resolves to
// a currency the seller can actually pick, and rejecting a form over a
// space the form itself wrote would be a refusal with no cause.
await resetCalls();
const padded = await publish({ ...MINIMUM, currency: '  USD  ' });
check('whitespace around a real currency is trimmed, not refused',
  padded.location, '/app');
check('and the clean value is what gets stored',
  (await lastWrittenCurrency())?.value, 'USD');

// And if a bad value somehow did get through, the database refuses it too. This posts the
// value straight at the stub's products table, past the Worker's check,
// to prove the second lock is real rather than decorative.
const direct = await fetch(`${STUB}/rest/v1/products`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'x', price: 1, currency: 'EUR' }),
});
check('the database refuses a third currency on its own', direct.status, 400);
check('and says which constraint stopped it',
  /products_currency_allowed/.test(await direct.text()), true);

/* ============================================================
   4. the currency follows the product into every view
   ============================================================ */

const VIEWS = [
  ['the feed', '/', false],
  ['the public shop profile', '/@nafin-boutique', false],
  ['search results', '/search?q=%DA%A9%D8%B1%D8%A7%D8%B3%DB%8C', false],
  ['the product detail page', `/@nafin-boutique/p/${PRODUCT_ID}`, false],
  // The seller's own list lives on /app, which reuses the public
  // shop's card markup (public/js/owner-profile.js fetches /@slug
  // and transplants its grid). Its prices are the ones already
  // checked under the public shop profile above; the owner-side
  // surface with a price of its own is the edit form, below.
];

for (const [name, path, seller] of VIEWS) {
  await setCurrency('IQD');
  let page = seller ? await asSeller(path) : await html(path);
  check(`${name}: a dinar price reads 85,000 د.ع`, page.includes('85,000'), true);
  check(`${name}: with the dinar symbol`, /data-money="85,000 د\.ع"/.test(page), true);
  check(`${name}: marked as IQD`, /data-currency="IQD"/.test(page), true);
  check(`${name}: and no dollar sign anywhere near the price`,
    /data-money="[^"]*\$/.test(page), false);

  await setCurrency('USD');
  page = seller ? await asSeller(path) : await html(path);
  check(`${name}: a dollar price reads $85,000`, /data-money="\$85,000"/.test(page), true);
  check(`${name}: marked as USD`, /data-currency="USD"/.test(page), true);
  check(`${name}: the symbol comes first in the markup`,
    /data-currency="USD"[^>]*>\s*<span[^>]*>\$<\/span>/.test(page), true);
  check(`${name}: and the dinar symbol is gone from the price`,
    /data-money="[^"]*د\.ع"/.test(page), false);

  // The one case that must never regress into "undefined": a product
  // written before the column existed.
  await setCurrency('-');
  page = seller ? await asSeller(path) : await html(path);
  check(`${name}: a pre-migration product reads as dinars`,
    /data-currency="IQD"/.test(page), true);
  check(`${name}: and never renders undefined`,
    /undefined|NaN|null/.test(page.slice(page.indexOf('data-money'), page.indexOf('data-money') + 120)), false);
}

/* ---------- the link preview WhatsApp shows ---------- */

await setCurrency('USD');
const pdp = await html(`/@nafin-boutique/p/${PRODUCT_ID}`);
check('the share preview quotes the price in its own currency',
  /<meta property="og:description" content="[^"]*\$85,000/.test(pdp)
  || /content="[^"]*\$85,000/.test(pdp), true);
check('and not in dinars', /content="[^"]*85,000 د\.ع/.test(pdp), false);

await setCurrency('IQD');

/* ============================================================
   5. editing
   ============================================================ */

await setCurrency('USD');
let edit = await asSeller(`/app/products/${PRODUCT_ID}`);
check('editing shows the stored dollar price as locked context',
  /class="edit-price__value"[^>]*>[\s\S]*\$85,000/.test(edit), true);
check('and does not offer a currency change',
  /name="currency"|id="currency-seg"/.test(edit), false);
check('or an editable price input', /name="price"/.test(edit), false);

await setCurrency('IQD');
edit = await asSeller(`/app/products/${PRODUCT_ID}`);
check('editing shows the stored dinar price as locked context',
  /class="edit-price__value"[^>]*>[\s\S]*85,000 د\.ع/.test(edit), true);
check('and still has no currency selector', /name="currency"|id="currency-seg"/.test(edit), false);

// The case the whole default exists for.
await setCurrency('-');
edit = await asSeller(`/app/products/${PRODUCT_ID}`);
check('a product from before the column shows its locked price in IQD',
  /class="edit-price__value"[^>]*>[\s\S]*85,000 د\.ع/.test(edit), true);
check('with no empty or undefined money', /edit-price__value[\s\S]{0,160}(undefined|NaN|null)/.test(edit), false);
await setCurrency('IQD');

/* ---------- a rejected form keeps the choice ---------- */

const rejected = await publish({ ...MINIMUM, currency: 'USD', price: '', images: gallery() });
check('a form sent back over a bad price keeps the dollar selected',
  /value="USD"[^>]*checked/.test(rejected.html), true);
check('and still says it was the price that was wrong',
  rejected.html.includes(P.errPrice), true);

/* ---------- switching currency never changes the number ---------- */

await resetCalls();
await publish({ ...MINIMUM, price: '25000', currency: 'USD' });
const switched = await lastWrittenCurrency();
check('a price typed as 25000 and marked USD is stored as 25000',
  switched?.price, 25000);
check('not divided by a rate', switched?.price === 19, false);
check('and marked USD', switched?.value, 'USD');

/* ============================================================
   6. the things this must not have touched
   ============================================================ */

const plans = await asSeller('/app/subscription');
check('subscription prices are still quoted in dinars',
  plans.includes('د.ع'), true);
check('and carry no product currency markup',
  /data-currency="USD"/.test(plans), false);

// Free-plan limits count products and images, never money.
check('the plan screen quotes no product currency',
  /data-currency=/.test(plans), false);

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
