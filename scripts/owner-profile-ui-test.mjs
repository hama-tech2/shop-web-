import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { ownerProfileFixture } from './owner-profile-fixture.mjs';
import { getOwnShop } from '../worker/auth.js';

const preview = await ownerProfileFixture();
const before = process.argv.includes('--before');
const capture = process.argv.includes('--capture') || before;
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--disable-background-networking'] });
let checks = 0;
const check = (label, value) => { assert.ok(value, label); checks++; console.log('PASS ' + label); };
async function screenshot(page, path) {
  // Fit full content in the capture viewport so the fixed nav is at the
  // screenshot bottom, not painted across the middle of a long page.
  const original = page.viewportSize();
  await page.setViewportSize({ width: original.width, height: Math.max(original.height, await page.evaluate(() => document.documentElement.scrollHeight)) });
  await page.screenshot({ path, fullPage: true });
  await page.setViewportSize(original);
}
try {
  const originalFetch = globalThis.fetch;
  let ownerReads = 0;
  globalThis.fetch = async (url, options) => {
    ownerReads++;
    const query = new URL(url).searchParams;
    assert.equal(query.get('owner_id'), 'eq.synthetic-owner');
    assert.equal(query.get('limit'), '1');
    assert.equal(options.headers.authorization, 'Bearer synthetic-token');
    const selected = query.get('select').split(',');
    for (const field of ['cover_key', 'bio', 'phone', 'instagram', 'tiktok', 'facebook', 'snapchat', 'maps_url']) assert.ok(selected.includes(field), field);
    assert.ok(!selected.includes('owner_id') && !selected.includes('email'));
    return Response.json([Object.fromEntries(selected.map(field => [field, preview.fixture.shop[field] ?? null]))]);
  };
  try {
    const shop = await getOwnShop({ SUPABASE_URL: 'https://synthetic.test', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public' }, 'synthetic-token', 'synthetic-owner');
    check('owner query preserves ownership filter and complete saved public profile fields', shop.cover_key === preview.fixture.shop.cover_key);
    await getOwnShop({}, 'synthetic-token', null);
    check('owner query cannot read a shop without a user identity', ownerReads === 1);
  } finally { globalThis.fetch = originalFetch; }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === preview.origin ? route.continue() : route.abort());
  await context.addInitScript(() => { window.copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => copied.push(text) } }); });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(preview.origin + '/app');
  await page.waitForSelector('.owner-product-menu');
  await page.evaluate(() => document.fonts.ready);
  check('existing brand fonts load from offline fixtures', await page.evaluate(() => document.fonts.check('14px Vazirmatn') && document.fonts.check('700 18px "Noto Kufi Arabic"')));
  await page.locator('.card__img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  if (capture) {
    await mkdir('docs/images/owner-profile', { recursive: true });
    for (const width of before ? [320, 390] : [320, 360, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: width > 500 ? 950 : 844 });
      await screenshot(page, `docs/images/owner-profile/${before ? 'before' : 'after'}-${width}.png`);
    }
  }
  if (before) { console.log('Baseline screenshots captured before owner UI changes.'); }
  else {
    check('fixture loads uploaded product images', await page.locator('.card__img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)));
    for (const width of [320, 360, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      check(width + ': RTL without page overflow', await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.scrollWidth <= innerWidth));
      check(width + ': exactly three existing navigation tabs', await page.locator('.nav__tab').count() === 3);
      check(width + ': one prominent Add Product action uses existing flow', await page.locator('.owner-control--primary').count() === 1 && await page.locator('.owner-control--primary').getAttribute('href') === '/app/new');
      check(width + ': actions share a row without overlap or wrapping', await page.locator('.owner-controls').evaluate(node => {
        const primary = node.querySelector('.owner-control--primary').getBoundingClientRect();
        const manage = node.querySelector('summary').getBoundingClientRect();
        return Math.abs(primary.top - manage.top) < 1 && primary.height <= 52 && manage.height <= 52 && (primary.right <= manage.left || manage.right <= primary.left);
      }));
      const smallTargets = await page.locator('.page--owner a, .page--owner button, .page--owner summary').evaluateAll(elements => elements.filter(element => {
        const rect = element.getBoundingClientRect();
        return element.getClientRects().length && rect.width && rect.height && (rect.height < 43.5 || rect.width < 43.5);
      }).map(element => element.className));
      check(width + ': visible controls have 44px touch targets: ' + smallTargets.join(', '), smallTargets.length === 0);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      check(width + ': bottom product controls can scroll clear of navigation', await page.locator('.card').last().evaluate(node => node.getBoundingClientRect().bottom <= document.querySelector('.nav').getBoundingClientRect().top));
      await page.evaluate(() => scrollTo(0, 0));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    check('no draft card without unfinished work', await page.locator('[data-resume-draft]').count() === 0);
    check('no fake verification or product statistics', !/verified|verification|توثیق|پشتڕاستکراو/.test(await page.locator('.shop-head').innerHTML()));
    const productTitles = await page.locator('.card__title').allTextContents();
    check('real catalog names are reused', JSON.stringify(productTitles) === JSON.stringify(preview.fixture.products.map(product => product.title)));
    for (const product of preview.fixture.products) {
      const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: product.title, exact: true }) });
      check('actual price retained: ' + product.title, (await card.innerText()).includes(Number(product.price).toLocaleString('en-US')));
    }
    await page.locator('#shop-copy').click();
    check('existing copy handler copies full canonical URL', await page.evaluate(slug => copied.at(-1) === 'https://bazarnow.xyz/@' + slug, preview.fixture.shop.slug));
    check('one QR link retains existing route', await page.locator('.seller-sharing a[href="/app/qr"]').count() === 1);

    const toggle = page.locator('#owner-management-toggle');
    await toggle.focus(); await page.keyboard.press('Enter');
    check('keyboard opens native management disclosure', await page.locator('#owner-management').getAttribute('open') !== null);
    const links = page.locator('#owner-management-links a');
    check('exactly four preserved management destinations', JSON.stringify(await links.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))) === JSON.stringify(['/app/profile', '#account-settings', '/app/categories', '/@' + preview.fixture.shop.slug]));
    await page.keyboard.press('ArrowDown');
    check('arrow key focuses first management action', await links.first().evaluate(node => node === document.activeElement));
    await page.keyboard.press('End');
    check('End reaches last action', await links.last().evaluate(node => node === document.activeElement));
    await page.keyboard.press('Escape');
    check('Escape closes and returns focus', await toggle.evaluate(node => node === document.activeElement && !node.closest('details').open));
    await page.keyboard.press('ArrowUp');
    check('ArrowUp from the trigger starts at last action', await links.last().evaluate(node => node === document.activeElement));
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => !document.getElementById('owner-management').open);
    check('Tab can leave the disclosure without trapping focus', await links.evaluateAll(nodes => !nodes.includes(document.activeElement)));
    await toggle.click();
    check('management menu fits narrow screen', await page.locator('#owner-management-links').evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }));
    if (capture) await screenshot(page, 'docs/images/owner-profile/management-390.png');
    await page.locator('#shop-copy').click();
    check('outside click closes management', await page.locator('#owner-management').getAttribute('open') === null);
    await toggle.click(); await page.locator('#settings-open').click();
    check('Settings and subscription remain accessible', await page.locator('#account-settings').isVisible() && await page.locator('#settings-subscription').isVisible());
    check('Settings preserves profile/support/logout', await page.locator('.settings-edit').isVisible() && await page.locator('.settings-logout').isVisible() && await page.getByText('پشتیوانی و یاسایی', { exact: true }).isVisible());
    await page.locator('#settings-back').click();
    await page.waitForFunction(() => document.activeElement.id === 'owner-management-toggle');
    check('Settings Back restores a visible management focus target', await toggle.isVisible());

    const chips = page.locator('#owner-products .chips');
    check('category add is the final item, not a separate toolbar', await chips.evaluate(node => node.lastElementChild.id === 'category-manage' && node.lastElementChild.textContent === '+ زیادکردنی پۆلێن'));
    check('categories have horizontal overflow within their rail', await chips.evaluate(node => node.scrollWidth > node.clientWidth && getComputedStyle(node).direction === 'rtl'));
    await chips.evaluate(node => { node.scrollLeft = -node.scrollWidth; });
    check('scrolling to RTL end reveals add-category action', await page.locator('#category-manage').evaluate(node => { const rect = node.getBoundingClientRect(), rail = node.parentElement.getBoundingClientRect(); return rect.left >= rail.left && rect.right <= rail.right; }));
    if (capture) await screenshot(page, 'docs/images/owner-profile/category-end-390.png');
    await page.locator('#category-manage').click();
    check('add opens existing editor and focuses new category', await page.locator('.cat-edit__row--add input').evaluate(node => node === document.activeElement));
    const firstCategory = page.locator('.cat-edit__row:not(.cat-edit__row--add)').first();
    await firstCategory.locator('input').fill('ناوی نوێ');
    const renamed = page.waitForResponse(response => response.url().includes('/api/categories/') && response.request().method() === 'POST');
    await firstCategory.locator('.cat-edit__save').click(); await renamed;
    check('rename reuses existing endpoint', preview.writes.some(write => write.values.name === 'ناوی نوێ' && /\/api\/categories\//.test(write.path)));
    await page.locator('.cat-edit__row--add input').fill('پۆلێنی نوێ'); await page.locator('.cat-edit__create').click();
    await page.waitForFunction(() => document.querySelectorAll('.cat-edit__row:not(.cat-edit__row--add)').length === 7);
    check('creation reuses category API', preview.writes.some(write => write.path === '/api/categories' && write.values.name === 'پۆلێنی نوێ'));
    const beforeDelete = preview.writes.length;
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('.cat-edit__remove').first().click();
    check('cancelled category deletion does not write', preview.writes.length === beforeDelete);
    page.once('dialog', dialog => dialog.accept()); await page.locator('.cat-edit__remove').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.cat-edit__row:not(.cat-edit__row--add)').length === 6);
    check('confirmed category delete reuses existing route', preview.writes.at(-1).path.endsWith('/delete'));
    await page.locator('.cat-edit__done').click(); await page.waitForSelector('.cat-edit[hidden]', { state: 'attached' });
    await toggle.click(); await page.locator('#owner-categories-open').click();
    check('Management opens same inline category editor', await page.locator('.cat-edit').isVisible() && await page.locator('.cat-edit__name').first().evaluate(node => node === document.activeElement));
    await page.keyboard.press('Escape');
    check('Escape closes category editor', await page.locator('.cat-edit').isHidden());
    await page.locator('.chips a').nth(1).click(); await page.waitForSelector('.chip[aria-current="true"]');
    check('existing category query/selection is preserved', new URL(page.url()).searchParams.has('category') && await page.locator('.chip[aria-current="true"]').count() === 1);

    await page.goto(preview.origin + '/app'); await page.waitForSelector('.owner-product-menu');
    const owner = preview.fixture.shop.id;
    const draftId = '60000000-0000-4000-8000-000000000001';
    const imagePath = '/img/' + preview.fixture.products[0].images[0];
    await page.evaluate(async ({ owner, draftId, imagePath }) => {
      const blob = await fetch(imagePath).then(response => response.blob());
      await ProductDrafts.put(owner, { id: draftId, fields: { title: 'بەرهەمی ناتەواوی تاقیکردنەوە' }, items: [{ cardBlob: blob, backupCard: blob }] });
    }, { owner, draftId, imagePath });
    await page.reload(); await page.waitForSelector('.owner-draft img');
    await page.locator('.owner-draft img').evaluate(image => image.decode());
    check('one compact resume card uses the actual unfinished draft', await page.locator('.owner-draft').count() === 1 && (await page.locator('.owner-draft').getAttribute('href')).includes('draft=' + draftId));
    check('draft thumbnail uses stored image Blob', await page.locator('.owner-draft img').evaluate(image => image.complete && image.naturalWidth > 0));
    check('displaying draft preserves all fields and image blobs', await page.evaluate(async owner => { const draft = await ProductDrafts.get(owner); return draft.items[0].cardBlob instanceof Blob && draft.fields.title === 'بەرهەمی ناتەواوی تاقیکردنەوە'; }, owner));
    if (capture) await screenshot(page, 'docs/images/owner-profile/after-draft-390.png');
    await page.evaluate(({ owner, draftId }) => ProductDrafts.complete(owner, draftId), { owner, draftId });
    await page.reload(); await page.waitForSelector('.owner-product-menu');
    check('already completed work never shows a draft card', await page.locator('[data-resume-draft]').count() === 0);
    await page.evaluate(owner => ProductDrafts.clear(owner), owner);

    Object.assign(preview.fixture.shop, { name: 'دوکانێکی ناوی درێژ بۆ تاقیکردنەوەی ڕووکاری مۆبایل', slug: 'shop-' + 'a'.repeat(35), logo_key: null, cover_key: null,
      bio: 'زانیاری '.repeat(50), instagram: 'test_shop', facebook: 'test_shop', tiktok: 'test_shop', snapchat: 'test_shop', phone: '+9647000000000', maps_url: 'https://example.com/map' });
    await page.setViewportSize({ width: 320, height: 844 }); await page.goto(preview.origin + '/app'); await page.waitForSelector('.owner-product-menu');
    check('long names, maximum slug, missing images and social links fit 320px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check('all existing social and WhatsApp actions remain', await page.locator('.shop-actions a').count() === 7);
    check('empty image fallbacks do not invent a banner or logo', await page.locator('.shop-banner__img--empty').count() === 1 && await page.locator('.shop-logo--initial').count() === 1);
    await toggle.click();
    check('Management fits at 320px with long profile content', await page.locator('#owner-management-links').evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }));
    preview.fixture.products = [];
    await page.reload(); await page.waitForSelector('#category-manage');
    check('empty shop keeps Add Product and category creation', await page.locator('.card').count() === 0 && await page.locator('.owner-control--primary').isVisible() && await page.locator('#category-manage').count() === 1);
    check('no JavaScript errors', errors.length === 0);
  }
  await context.close();
} finally { await browser.close(); await preview.close(); }
console.log(`${checks} owner profile checks passed`);
