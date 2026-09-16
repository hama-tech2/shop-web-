/** Approved mobile layout + local image preparation. All writes intercepted. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { feedHtml } from '../worker/render/feed.js';
import { shopPage } from '../worker/render/shop.js';
import { productForm } from '../worker/render/product-form.js';
import { layout } from '../worker/render/layout.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const out = process.env.BAZARO_SHOTS || join(tmpdir(), 'bazaro-mobile-card-polish');
await mkdir(out, { recursive: true });
let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); checks++; };
const shop = { id: 'fixture', slug: 'fixture-shop', name: 'دوکانی تاقیکردنەوە', products_visible: true, whatsapp: '07510000002', maps_url: 'https://maps.app.goo.gl/fixture' };
const products = Array.from({ length: 6 }, (_, i) => ({ id: String(i), title: i === 0 ? 'کورسی مۆدێرن بە ناوێکی زۆر درێژ' : 'کاڵای تاقیکردنەوە', price: [120000, 450000, 7000, 125, 25000, 999999999][i], currency: i === 3 ? 'USD' : 'IQD', images: ['fixture-' + i], shopName: shop.name, shopSlug: shop.slug, shopWhatsapp: shop.whatsapp, shopMapsUrl: i % 2 ? null : shop.maps_url }));
const feed = (query = null, category = null) => feedHtml({ products, query, category, offset: 0, pageSize: 6, hasMore: false });
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Serve actual assets directly so unrelated local Worker tests cannot
  // leave this fixture with missing styles or scripts after a runtime restart.
  await ctx.route(/\/((styles|js)\/[^/]+\.(css|js))$/, async route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(new URL('../public' + path, import.meta.url)) });
  });
  let session = { signedIn: true, ids: [] }, failed = false, calls = 0;
  await ctx.route(APP + '/api/favorites', route => { calls++; return failed ? route.abort() : route.fulfill({ json: session }); });
  await ctx.route(APP + '/img/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#EFEBE3"/><circle cx="400" cy="500" r="180" fill="#14563D"/></svg>' }));
  await ctx.route(APP + '/_mobile/**', route => {
    const url = new URL(route.request().url()), screen = url.pathname.split('/').pop();
    const body = screen === 'shop' ? shopPage({ shop, products, categories: [], origin: APP })
      : screen === 'form' ? productForm({ mode: 'new', draftId: 'fixture-draft', categories: [], values: {} })
      : feed(url.searchParams.get('q'), url.searchParams.get('category'));
    return route.fulfill({ contentType: 'text/html', body: layout({ title: 'Local mobile review', body, scripts: screen === 'form' ? ['/js/product.js'] : ['/js/favorites.js'] }) });
  });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const screen of ['home', 'shop']) {
      await page.goto(APP + '/_mobile/' + screen);
      await page.evaluate(() => document.fonts.ready);
      check(`${width} ${screen}: existing Kurdish font loaded`, await page.evaluate(() => [...document.fonts].some(face => face.family === 'Vazirmatn' && face.status === 'loaded')));
      check(`${width} ${screen}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check(`${width} ${screen}: compact grid spacing`, await page.locator('.grid').evaluate(el => getComputedStyle(el).rowGap === '8px' && getComputedStyle(el).columnGap === '8px'));
      check(`${width} ${screen}: square cropped covers`, await page.locator('.card__media').evaluateAll(els => els.every(el => Math.abs(el.clientWidth - el.clientHeight) <= 1 && getComputedStyle(el.querySelector('img')).objectFit === 'cover')));
      check(`${width} ${screen}: consistent card heights`, await page.locator('.card').evaluateAll(els => Math.max(...els.map(el => el.offsetHeight)) - Math.min(...els.map(el => el.offsetHeight)) <= 1));
      check(`${width} ${screen}: compact height`, await page.locator('.card').first().evaluate(el => el.offsetHeight - el.querySelector('.card__media').offsetHeight <= 120));
      check(`${width} ${screen}: RTL information and one-line titles`, await page.locator('.card__body').evaluateAll(els => els.every(el => getComputedStyle(el).direction === 'rtl' && getComputedStyle(el).textAlign === 'right' && getComputedStyle(el.querySelector('.card__title')).textOverflow === 'ellipsis' && getComputedStyle(el.querySelector('.card__title')).whiteSpace === 'nowrap')));
      check(`${width} ${screen}: conditional locations`, await page.locator('.card__action--location').count() === 3);
      check(`${width} ${screen}: WhatsApp correct and no text`, await page.locator('.card__action--whatsapp').evaluateAll(els => els.every(el => el.href === 'https://wa.me/9647510000002')));
      check(`${width} ${screen}: seller identity only on feed`, await page.locator('.card__shop').count() === (screen === 'home' ? 6 : 0));
      if (screen === 'home') {
        await page.waitForFunction(() => document.querySelector('.seller-prompt').hidden);
        check(`${width}: signed-in CTA hidden`, await page.locator('.seller-prompt').isHidden());
        check(`${width}: exactly three customer destinations`, JSON.stringify(await page.locator('.nav__tab').evaluateAll(els => els.map(el => el.getAttribute('href')))) === JSON.stringify(['/', '/saved', '/app']));
        check(`${width}: category slug order`, JSON.stringify(await page.locator('.chips--categories a').evaluateAll(els => els.map(el => new URL(el.href).searchParams.get('category')))) === JSON.stringify([null, 'clothing', 'beauty', 'home', 'food', 'electronics', 'other']));
        check(`${width}: accessible outline category icons`, await page.locator('.chips--categories svg[aria-hidden="true"]').count() === 7);
      }
      if (width === 390) await page.screenshot({ path: join(out, screen + '-390.png'), fullPage: true });
    }
  }
  await page.goto(APP + '/_mobile/home?q=test&category=beauty');
  check('category controls keep the query', await page.locator('.chips--categories a').evaluateAll(els => els.every(el => new URL(el.href).searchParams.get('q') === 'test')));
  check('filtered feed has no seller promo', await page.locator('.seller-prompt').count() === 0);
  session = { signedIn: false, ids: [] };
  await page.goto(APP + '/_mobile/home');
  await page.locator('.seller-prompt').waitFor({ state: 'visible' });
  check('signed-out CTA preserved', await page.locator('.seller-prompt__cta').getAttribute('href') === '/signup');
  const before = calls;
  session = { signedIn: true, ids: [] };
  await Promise.all([
    page.waitForResponse(APP + '/api/favorites'),
    page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))),
  ]);
  await page.waitForFunction(() => document.querySelector('.seller-prompt').hidden);
  check('back/forward cache rechecks session', calls === before + 1 && await page.locator('.seller-prompt').isHidden());
  await page.evaluate(() => localStorage.setItem('shopweb:favorites', '["local-favorite"]'));
  await ctx.route(APP + '/api/favorites/merge', route => route.abort());
  await page.goto(APP + '/_mobile/home');
  await page.waitForFunction(() => document.querySelector('[data-fav]').getAttribute('aria-busy') !== 'true');
  check('failed favorite merge does not show seller CTA to a signed-in user', await page.locator('.seller-prompt').isHidden());
  failed = true;
  await page.goto(APP + '/_mobile/home');
  await page.locator('.seller-prompt').waitFor({ state: 'visible' });
  check('failed session read keeps signed-out access', await page.locator('.seller-prompt__cta').isVisible());

  // Generated wide source has red/blue edges: full image must retain both.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP + '/_mobile/form');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 600;
    const x = c.getContext('2d'); x.fillStyle = '#eee'; x.fillRect(0, 0, 1200, 600); x.fillStyle = 'red'; x.fillRect(0, 0, 150, 600); x.fillStyle = 'blue'; x.fillRect(1050, 0, 150, 600);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#photo-input').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => document.querySelector('.thumb__select img') && !document.querySelector('#save-btn').disabled);
  const thumb = page.locator('.thumb__select img').first();
  check('new upload preview is square before editing', await thumb.evaluate(async img => { await img.decode(); return img.naturalWidth === img.naturalHeight && Math.abs(img.clientWidth - img.clientHeight) <= 1; }));
  await page.locator('.thumb__select').first().click();
  await page.waitForFunction(() => !document.querySelector('#cover-save').disabled);
  check('square crop explained', await page.locator('.cover-intro bdi').textContent() === '1:1');
  await page.locator('#cover-plus').click();
  await page.locator('#cover-rotate').click();
  await page.screenshot({ path: join(out, 'crop-390.png') });
  await page.locator('#cover-save').click();
  await page.locator('#cover-editor').waitFor({ state: 'hidden' });
  check('edited crop preview stays square', await thumb.evaluate(async img => { await img.decode(); return img.naturalWidth === img.naturalHeight; }));
  let uploaded, posted;
  await ctx.route(APP + '/app/upload', async route => {
    const req = route.request();
    const form = await new Request(req.url(), { method: 'POST', headers: req.headers(), body: req.postDataBuffer() }).formData();
    uploaded = {};
    for (const key of ['card', 'full']) uploaded[key] = [...new Uint8Array(await form.get(key).arrayBuffer())];
    return route.fulfill({ json: { card: 'fixture-card', full: 'fixture-full' } });
  });
  await ctx.route(APP + '/app/new', route => { posted = new URLSearchParams(route.request().postData()); return route.fulfill({ status: 204 }); });
  await page.locator('#f-title').fill('بەرهەمی تاقیکردنەوە');
  check('upload fixture title is valid', await page.locator('#f-title').evaluate(el => el.validity.valid));
  await page.locator('#f-price').fill('125');
  await page.locator('.seg__option').filter({ has: page.locator('input[value="USD"]') }).click();
  try {
    await Promise.all([page.waitForResponse(APP + '/app/new', { timeout: 10000 }), page.locator('#save-btn').click()]);
  } catch (error) {
    console.error(await page.evaluate(() => ({ message: document.querySelector('#product-message').textContent, invalid: [...document.querySelectorAll(':invalid')].map(el => el.id), images: document.querySelector('#images-field').value })), { uploaded: !!uploaded, posted: !!posted, errors });
    throw error;
  }
  const dims = await page.evaluate(async uploaded => {
    const card = await createImageBitmap(new Blob([new Uint8Array(uploaded.card)])), full = await createImageBitmap(new Blob([new Uint8Array(uploaded.full)]));
    const c = document.createElement('canvas'); c.width = full.width; c.height = full.height; const x = c.getContext('2d'); x.drawImage(full, 0, 0);
    const a = x.getImageData(10, 10, 1, 1).data, b = x.getImageData(full.width - 10, 10, 1, 1).data;
    const result = { square: card.width === card.height, full: [full.width, full.height], edges: a[0] > 200 && a[2] < 30 && b[2] > 200 && b[0] < 30 }; card.close(); full.close(); return result;
  }, uploaded);
  check('uploaded card variant square', dims.square);
  check('uncropped full variant retains proportions and edge pixels', JSON.stringify(dims.full) === '[1200,600]' && dims.edges);
  check('existing image-key contract retained', JSON.stringify(JSON.parse(posted.get('images'))) === '[{"card":"fixture-card","full":"fixture-full"}]');
  check('upload leaves selected currency and price intact', posted.get('currency') === 'USD' && posted.get('price') === '125');
  check('no browser errors', errors.length === 0);
  await ctx.close();
} finally { await browser.close(); }
console.log(`All ${checks} mobile polish checks passed. Screenshots: ${out}`);
