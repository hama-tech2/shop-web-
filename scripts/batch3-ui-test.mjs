/** Real-phone regressions. Uses the existing local Worker + Supabase stub only.
 * CHROME=/path/to/chrome node scripts/batch3-ui-test.mjs [app] [stub]
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { layout } from '../worker/render/layout.js';
import { productPage } from '../worker/render/product-page.js';
import { stepSlug, completeSlug } from '../worker/render/onboarding.js';
import { cardHtml } from '../worker/render/feed.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let checks = 0;
function check(name, value) { assert.ok(value, name); checks++; console.log('PASS ' + name); }
const shop = { id: 'aaaaaaaa-1111-4111-8111-111111111111', slug: 'test-shop', name: 'دوکانی تاقیکردنەوە', city: 'erbil', whatsapp: '07510000002' };
const id = 'bbbbbbbb-1111-4111-8111-111111111111';
const product = { id, title: 'بەرهەمێکی جوان بە ناوێکی درێژ بۆ تاقیکردنەوە', price: 72000, description: 'پێناسەی بەرهەم', shop, images: ['tall', 'wide', 'square'].map(full => ({ full })) };
const more = Array.from({ length: 4 }, (_, i) => ({ id: String(i), title: product.title, price: 45000, images: ['tall'], shopName: shop.name, shopSlug: shop.slug }));
const pdp = layout({ title: 'تاقیکردنەوە', body: productPage({ product, more, origin: APP }), scripts: ['/js/shop.js', '/js/favorites.js'] });
const slugPage = layout({ title: 'تاقیکردنەوە', body: stepSlug({ draft: { name: 'Bilal Bazar Fruit66' } }), scripts: ['/js/app.js'] });

try {
  for (const width of [360, 390, 430]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await ctx.route('**/batch3/product', route => route.fulfill({ contentType: 'text/html', body: pdp }));
    await ctx.route('**/img/**', route => {
      const key = new URL(route.request().url()).pathname.split('/').pop();
      const [w, h] = key === 'tall' ? [900, 1600] : key === 'wide' ? [1600, 900] : [1000, 1000];
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#EFEBE3"/><circle cx="${w / 2}" cy="${h / 2}" r="200" fill="#14563D"/></svg>` });
    });
    await ctx.route('**/api/favorites', route => route.fulfill({ json: { signedIn: false, ids: [] } }));
    await page.goto(APP + '/batch3/product');
    await page.waitForFunction(() => document.querySelector('.carousel__img').complete);
    const sizes = await page.evaluate(() => {
      const rail = document.querySelector('.carousel'), r = rail.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, width: r.width, height: r.height,
        slides: [...rail.children].map(img => { const b = img.getBoundingClientRect(); return [b.width, b.height, getComputedStyle(img).objectFit]; }),
        dotsBelow: document.querySelector('#pdp-dots').getBoundingClientRect().top >= r.bottom,
        columns: getComputedStyle(document.querySelector('.more .grid')).gridTemplateColumns.split(' ').length,
        cta: document.querySelector('.pdp-order .btn').getBoundingClientRect().height,
        sellerLogo: document.querySelector('.shop-row__logo').getBoundingClientRect().width,
        cards: [...document.querySelectorAll('.more .card')].every(c => c.querySelector('.card__title').getBoundingClientRect().bottom <= c.querySelector('.card__price').getBoundingClientRect().top),
        heart: document.querySelector('[data-fav]').getBoundingClientRect().width };
    });
    check(`${width}: no overflow, full-width gallery`, !sizes.overflow && sizes.width === width);
    check(`${width}: tall/wide/square slides share the 4:5 frame without letterboxing`, sizes.slides.every(([w, h, fit]) => w === sizes.width && Math.abs(h - sizes.height) < 1 && fit === 'cover') && Math.abs(sizes.height / sizes.width - 1.25) < .01);
    check(`${width}: dots sit below gallery`, sizes.dotsBelow);
    check(`${width}: two-column related cards, title above price`, sizes.columns === 2 && sizes.cards);
    check(`${width}: compact CTA, seller row, accessible heart`, sizes.cta >= 44 && sizes.cta <= 50 && sizes.sellerLogo === 44 && sizes.heart >= 44);
    await page.locator('#pdp-carousel').evaluate(el => el.scrollLeft = -el.clientWidth);
    await page.waitForFunction(() => document.querySelectorAll('#pdp-dots .dot')[1].classList.contains('is-active'));
    check(`${width}: RTL swiping updates dots`, true);
    if (width === 390) await page.screenshot({ path: join(tmpdir(), 'batch3-product-390.png'), fullPage: true });
    check(`${width}: no browser errors`, errors.length === 0);
    await ctx.close();
  }

  // Slug typing, paste, short/empty values, availability and server fallback.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('**/batch3/slug', route => route.fulfill({ contentType: 'text/html', body: slugPage }));
    let verdict = { available: true };
    await ctx.route('**/api/slug-check?**', route => route.fulfill({ json: verdict }));
    const page = await ctx.newPage(); await page.goto(APP + '/batch3/slug');
    const input = page.locator('#f-slug');
    check('slug: suggestion comes from shop name', await input.inputValue() === 'bilal-bazar-fruit66');
    await input.fill('bilal bazar fruit66');
    check('slug: pasted words sanitize immediately', await input.inputValue() === 'bilal-bazar-fruit66');
    await input.fill(''); await input.pressSequentially('bilal bazar fruit66');
    check('slug: typing spaces retains word separation', await input.inputValue() === 'bilal-bazar-fruit66');
    await input.fill('__BIG___SHOP!!!--');
    check('slug: uppercase, underscores, repeated hyphens, punctuation', await input.inputValue() === 'big-shop');
    await input.fill('a'.repeat(60)); check('slug: long paste truncates', (await input.inputValue()).length === 40);
    await input.fill('a'); await input.blur();
    check('slug: short names complete without blocking Next', (await input.inputValue()).length >= 3 && await page.locator('#slug-next').isEnabled());
    await input.fill(''); await input.blur();
    check('slug: blank input restores suggestion', await input.inputValue() === 'bilal-bazar-fruit66');
    verdict = { available: false, reason: 'taken' }; await input.fill('taken-link');
    await page.waitForFunction(() => document.querySelector('#slug-next').disabled);
    check('slug: taken link blocks', true);
    verdict = { available: true }; await input.fill('free-link');
    check('slug: correcting taken link immediately enables Next', await page.locator('#slug-next').isEnabled());
    check('slug: Kurdish names get a valid suggestion', /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(completeSlug('', 'دوکانی بلال')));
    await ctx.close();
  }

  // An authenticated save must paint before the delayed response, then roll back on failure.
  for (const saved of [false, true]) {
    const ctx = await browser.newContext();
    let release, writes = [];
    await ctx.route('**/batch3/product', route => route.fulfill({ contentType: 'text/html', body: saved ? pdp.replace('page--pdp', 'page--pdp page--saved') : pdp }));
    await ctx.route('**/api/favorites', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { signedIn: true, ids: saved ? [id] : [] } });
      writes.push(route.request().postDataJSON());
      await new Promise(resolve => release = resolve);
      return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    });
    const page = await ctx.newPage(); await page.goto(APP + '/batch3/product');
    await page.waitForTimeout(150);
    const heart = page.locator('#pdp-heart');
    await heart.click();
    check(`heart ${saved ? 'unsave' : 'save'}: optimistic before network`, await heart.getAttribute('aria-pressed') === String(!saved));
    if (!saved) check('heart: saved icon fills red', await heart.evaluate(el => getComputedStyle(el.querySelector('svg')).fill) === 'rgb(214, 47, 69)');
    while (!release) await page.waitForTimeout(10);
    release(); await page.waitForFunction(want => document.querySelector('#pdp-heart').getAttribute('aria-pressed') === String(want), saved);
    check(`heart ${saved ? 'unsave' : 'save'}: failed write rolls back`, true);
    check('heart: actual toggle payload', writes[0].id === id && writes[0].on === !saved);
    await ctx.close();
  }

  // A failed unsave must restore the removed Saved card, and retry must succeed.
  {
    const ctx = await browser.newContext();
    let release, fail = true;
    const body = `<div class="page page--saved" data-signed-in="1"><div id="grid">${cardHtml({ ...more[0], id }, 0, { saved: true })}</div><div id="saved-empty" hidden><a href="/">گەڕانەوە</a></div></div>`;
    await ctx.route('**/batch3/saved', route => route.fulfill({ contentType: 'text/html', body: layout({ title: 'تاقیکردنەوە', body, scripts: ['/js/favorites.js'] }) }));
    await ctx.route('**/api/favorites', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { signedIn: true, ids: [id] } });
      await new Promise(resolve => release = resolve);
      return route.fulfill({ status: fail ? 503 : 200, json: { ok: !fail } });
    });
    const page = await ctx.newPage(); await page.goto(APP + '/batch3/saved'); await page.waitForTimeout(150);
    await page.locator('[data-fav]').click();
    check('saved: unsave removes card immediately', await page.locator('.card').count() === 0);
    while (!release) await page.waitForTimeout(10);
    release(); await page.waitForSelector('.card');
    check('saved: failure restores card and saved state', await page.locator('[data-fav]').getAttribute('aria-pressed') === 'true');
    fail = false; release = null;
    await page.locator('[data-fav]').click();
    while (!release) await page.waitForTimeout(10);
    release(); await page.waitForTimeout(100);
    check('saved: successful retry leaves empty state', await page.locator('.card').count() === 0 && await page.locator('#saved-empty').isVisible());
    await ctx.close();
  }

  // Real product form, generated phone photos, local crop output and cancellation.
  await fetch(STUB + '/__mode/shop'); await fetch(STUB + '/__rows/1');
  await fetch(STUB + '/__plan/year_1'); await fetch(STUB + '/__sub/20');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addCookies([{ name: 'sb-access', value: 'TEST', url: APP }]);
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(APP + '/app/new');
    check('publish: feed toggle removed, active status retained', await page.locator('#visibility').count() === 0 && await page.locator('#status-field').inputValue() === 'active');
    check('publish: back opens owner profile', await page.locator('.publish-head a').getAttribute('href') === '/app');
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 1600; const x = c.getContext('2d'); x.fillStyle = '#EFEBE3'; x.fillRect(0, 0, 900, 1600); x.fillStyle = '#14563D'; x.fillRect(220, 350, 400, 700); return c.toDataURL().split(',')[1]; });
    await page.locator('#photo-input').setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `phone-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
    await page.waitForFunction(() => document.querySelectorAll('.publish-photo').length === 5 && !document.querySelector('#save-btn').disabled);
    check('publish: still limited to five photos', await page.locator('.publish-photo').count() === 5 && await page.locator('#add-photo').isHidden());
    const select = page.locator('.thumb__select').first();
    const original = await select.locator('img').getAttribute('src');
    await select.click(); await page.waitForFunction(() => !document.querySelector('#cover-save').disabled);
    const cdp = await ctx.newCDPSession(page);
    const stage = await page.locator('#cover-stage').boundingBox();
    const x = stage.x + stage.width / 2, y = stage.y + stage.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 35, y, id: 1 }, { x: x + 35, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 65, y, id: 1 }, { x: x + 65, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => Number(document.querySelector('#cover-zoom').value) > 1);
    check('cover: two-finger pinch changes zoom', true);
    const beforeDrag = await page.locator('#cover-canvas').evaluate(c => c.toDataURL());
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y + 35, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(50);
    check('cover: drag repositions the image', await page.locator('#cover-canvas').evaluate(c => c.toDataURL()) !== beforeDrag);
    check('cover: removed controls and preview sections absent', await page.locator('#cover-left,#cover-right,#cover-reset,#cover-strip,#cover-previews,[name="cover-ratio"]').count() === 0);
    await page.locator('#cover-plus').click(); await page.locator('#cover-rotate').click();
    await page.locator('#cover-stage').press('ArrowRight');
    await page.locator('#cover-cancel').click();
    check('cover: cancel preserves previous image', await select.locator('img').getAttribute('src') === original);
    await select.click(); await page.waitForFunction(() => !document.querySelector('#cover-save').disabled);
    await page.locator('#cover-plus').click(); await page.locator('#cover-rotate').click();
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      check(`cover ${width}: no horizontal overflow`, await page.locator('#cover-editor').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(tmpdir(), 'batch3-cover-390.png') });
    await page.locator('#cover-save').click(); await page.waitForFunction(() => !document.querySelector('#cover-editor').open);
    const ratio = await select.locator('img').evaluate(async img => { await img.decode(); return img.naturalHeight / img.naturalWidth; });
    check('cover: saved rotated/zoomed image is 4:5', Math.abs(ratio - 1.25) < .01);
    check('cover: saved image actually changes', await select.locator('img').getAttribute('src') !== original);
    await page.goto(APP + '/app/products?e=errGone');
    check('management list: reachable with error, and one list with no filters', await page.locator('.alert').count() > 0 && await page.locator('.manager-filters').count() === 0);
    check('browser: no form/editor errors', errors.length === 0);
    await ctx.close();
  }
  console.log(`\nAll ${checks} Batch 3 checks passed.`);
} finally { await browser.close(); }
