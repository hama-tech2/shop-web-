/** Focused owner-card controls and restricted product-edit coverage. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { cardHtml } from '../worker/render/feed.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const COOKIE = 'sb-access=TEST';
const SHOP = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRODUCT = 'bbbbbbbb-1111-4111-8111-111111111111';
const IMAGE = `products/${SHOP}/${PRODUCT}/cover-card.webp`;
const FULL = `products/${SHOP}/${PRODUCT}/cover-full.webp`;
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; };
const control = (path) => fetch(STUB + path).then((response) => response.json());
const seller = (path, init = {}) => fetch(APP + path, {
  ...init,
  redirect: init.redirect || 'manual',
  headers: { cookie: COOKIE, ...(init.headers || {}) },
});

await control('/__mode/shop');
await control('/__rows/1');
await control('/__public/1');
await control('/__plan/year_1');
await control('/__sub/20');
await control('/__productimg/' + encodeURIComponent(IMAGE));

/* Shop contact details are the only source for card actions. */
const base = {
  id: PRODUCT, title: 'کراسی کوردی', price: 85000, currency: 'IQD', images: [IMAGE],
  shopName: 'بۆتیکی نافین', shopSlug: 'nafin-boutique', shopLogo: null,
};
const withContact = cardHtml({ ...base, shopWhatsapp: '+9647510000002', shopMapsUrl: 'https://maps.app.goo.gl/shop' }, 0);
const withoutContact = cardHtml({ ...base, shopWhatsapp: null, shopMapsUrl: null }, 0);
check('shop WhatsApp creates a direct no-message action', withContact.includes('href="https://wa.me/9647510000002"'));
check('shop location creates its action', withContact.includes('card__action--location'));
check('missing shop WhatsApp hides the action', !withoutContact.includes('card__action--whatsapp'));
check('missing shop location hides the action', !withoutContact.includes('card__action--location'));

/* Public customers keep the normal card and never receive owner controls. */
const publicHtml = await (await fetch(APP + '/@nafin-boutique')).text();
check('public shop has no owner menu', !publicHtml.includes('owner-product-menu'));
check('public shop retains favorite control', publicHtml.includes('data-fav'));

/* The edit screen exposes only cover, title and market category. */
const editUrl = `/app/products/${PRODUCT}`;
const edit = await (await seller(editUrl)).text();
check('edit form is cover-only', edit.includes('data-cover-only="true"'));
check('title remains editable', /name="title"/.test(edit));
check('market category remains editable', /name="category"/.test(edit));
check('price is visible as locked context', edit.includes('edit-price__value') && edit.includes('85,000 د.ع'));
for (const forbidden of ['price', 'currency', 'status', 'description', 'own_category', 'whatsapp', 'location']) {
  check(`${forbidden} is not an editable product field`,
    !new RegExp(`<(?:input|select|textarea)[^>]*name="${forbidden}"`).test(edit));
}
check('edit form has no direct delete button', !edit.includes(`/app/products/${PRODUCT}/delete`));
check('edit gallery has no remove or reorder controls', !edit.includes('thumb__x') && !edit.includes('photo-order'));

/* The server also ignores protected fields in a crafted request. */
await control('/__calls/reset');
const form = new URLSearchParams({
  draft_id: PRODUCT,
  images: JSON.stringify([{ card: IMAGE, full: FULL }]),
  title: 'ناوی نوێ',
  category: 'clothing',
  price: '1', currency: 'USD', status: 'hidden', description: 'crafted',
  own_category: 'dddddddd-1111-4111-8111-111111111111',
  whatsapp: '+10000000000', location: 'https://example.com',
});
const saved = await seller(editUrl, {
  method: 'POST',
  headers: { origin: APP, 'content-type': 'application/x-www-form-urlencoded' },
  body: form,
});
check('restricted edit saves successfully', saved.status === 303 && saved.headers.get('location') === '/app');
const writes = await control('/__writes');
const update = writes.find((write) => write.table === 'products' && write.method === 'PATCH');
check('product update occurred', Boolean(update));
// Where a product is shown joined the editor; what it costs did not.
// The list is exact, so a fourth field cannot be added without this
// test being changed on purpose.
check('product update contains only title, market category and visibility',
  JSON.stringify(Object.keys(update.body).sort())
    === JSON.stringify(['platform_category_id', 'title', 'visibility']));
check('the restricted edit still never writes a price, currency or status',
  ['price', 'currency', 'status', 'description'].every((f) => !(f in update.body)));
check('ownership remains scoped in the update query', update.search.includes(`shop_id=eq.${SHOP}`));

/* Owner card menu behavior, including confirmation before deletion. */
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: 'sb-access', value: 'TEST', url: APP }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(APP + '/app');
  const menu = page.locator('.owner-product-menu').first();
  await menu.waitFor();
  check('owner receives one small menu per own product', await page.locator('.owner-product-menu').count() === await page.locator('.card').count());
  check('owner card has no exposed edit/delete controls while closed',
    !(await menu.locator('.owner-product-popover').isVisible()));
  await menu.locator('.owner-product-more').click();
  check('menu opens with exactly two actions', await menu.locator('.owner-product-action').count() === 2);
  check('menu stays inside the compact card with a full touch target', await menu.evaluate((node) => {
    const card = node.closest('.card').getBoundingClientRect();
    const trigger = node.querySelector('.owner-product-more').getBoundingClientRect();
    const popover = node.querySelector('.owner-product-popover').getBoundingClientRect();
    return trigger.width >= 44 && trigger.height >= 44 && popover.left >= card.left && popover.right <= card.right;
  }));
  check('menu actions are Edit then Delete',
    JSON.stringify(await menu.locator('.owner-product-action').allTextContents()) === JSON.stringify(['دەستکاری', 'سڕینەوە']));
  check('Edit points to the owned product edit screen',
    (await menu.locator('.owner-product-edit').getAttribute('href')) === editUrl);

  let deleteRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === `${editUrl}/delete` && request.method() === 'POST') deleteRequests++;
  });
  page.once('dialog', (dialog) => dialog.dismiss());
  await menu.locator('.owner-delete').click();
  await page.waitForTimeout(100);
  check('cancelled confirmation sends no delete request', deleteRequests === 0);
  check('cancelled confirmation keeps the product', await page.locator('.card').count() === 1);

  await menu.locator('.owner-product-more').click();
  page.once('dialog', (dialog) => dialog.accept());
  await menu.locator('.owner-delete').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 0);
  check('accepted confirmation sends one delete request', deleteRequests === 1);
  check('no owner script errors', errors.length === 0);
  await context.close();
} finally {
  await browser.close();
}

console.log(`All ${checks} owner product control checks passed.`);
