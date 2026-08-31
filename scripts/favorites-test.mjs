/**
 * Shop Web — favourites behaviour test.
 *
 * Drives public/js/favorites.js in a real browser with the API stubbed,
 * because the interesting part is not the endpoints, it is what the
 * browser does around them: what a signed-out tap stores, what happens
 * to that list when someone signs in, and whether a phone with storage
 * blocked still gets a working heart.
 *
 *   npm i -D playwright-core
 *   node scripts/favorites-test.mjs
 *
 * Needs Chromium; set CHROME to override the path.
 */
import pw from 'playwright-core';
const { chromium } = pw;
import fs from 'node:fs';

const SCRIPT = fs.readFileSync(new URL('../public/js/favorites.js', import.meta.url), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const PAGE = (extra = '') => `<!doctype html><html dir="rtl"><body>
<div class="page ${extra}">
  <article><button data-fav="${A}" aria-pressed="false">A</button></article>
  <article><button data-fav="${B}" aria-pressed="false">B</button></article>
</div></body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

const results = [];
const check = (name, got, want) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want),
                 pass: JSON.stringify(got) === JSON.stringify(want) });

async function open({ signedIn, ids = [], seed = null, page: cls = '' }) {
  const ctx = await browser.newContext();
  const calls = [];

  await ctx.route('**/api/favorites**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push({ method: req.method(), path: url.pathname,
                 body: req.method() === 'POST' ? req.postDataJSON() : null,
                 query: url.searchParams.get('ids') });

    if (url.pathname === '/api/favorites/cards') {
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: `<article><button data-fav="${A}" aria-pressed="true">A</button></article>` });
    }
    if (url.pathname === '/api/favorites/merge') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, ids: req.postDataJSON().ids }) });
    }
    if (req.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ signedIn, ids }) });
  });

  await ctx.route('**/x/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: PAGE(cls) }));

  const page = await ctx.newPage();
  await page.goto('http://local.test/x/');
  if (seed) {
    await page.evaluate((s) => localStorage.setItem('shopweb:favorites', JSON.stringify(s)), seed);
    await page.reload();
  }
  await page.addScriptTag({ content: SCRIPT });
  await page.waitForTimeout(250);
  return { page, ctx, calls };
}

const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('shopweb:favorites') || '[]'));
const pressed = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-fav]')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('data-fav')));

/* 1. signed out: a tap saves locally, no write to the server */
{
  const { page, ctx, calls } = await open({ signedIn: false });
  await page.click(`[data-fav="${A}"]`);
  await page.waitForTimeout(100);
  check('signed out: stored', await stored(page), [A]);
  check('signed out: pressed', await pressed(page), [A]);
  check('signed out: no POST', calls.filter((c) => c.method === 'POST').length, 0);
  await ctx.close();
}

/* 2. signed out: the list survives a reload */
{
  const { page, ctx } = await open({ signedIn: false, seed: [B] });
  check('reload: pressed', await pressed(page), [B]);
  await ctx.close();
}

/* 3. signed out: tapping twice removes it again */
{
  const { page, ctx } = await open({ signedIn: false, seed: [A] });
  await page.click(`[data-fav="${A}"]`);
  await page.waitForTimeout(100);
  check('untap: stored', await stored(page), []);
  check('untap: pressed', await pressed(page), []);
  await ctx.close();
}

/* 4. signed in with a local list: it is merged, then dropped */
{
  const { page, ctx, calls } = await open({ signedIn: true, ids: [B], seed: [A] });
  const merge = calls.find((c) => c.path === '/api/favorites/merge');
  check('merge: called with local ids', merge && merge.body.ids, [A]);
  check('merge: local store cleared', await stored(page), []);
  check('merge: pressed from server', await pressed(page), [A]);
  await ctx.close();
}

/* 5. signed in with nothing local: no merge call */
{
  const { page, ctx, calls } = await open({ signedIn: true, ids: [B] });
  check('no merge when nothing local', calls.some((c) => c.path === '/api/favorites/merge'), false);
  check('signed in: pressed from server', await pressed(page), [B]);
  await ctx.close();
}

/* 6. signed in: a tap writes to the server */
{
  const { page, ctx, calls } = await open({ signedIn: true, ids: [] });
  await page.click(`[data-fav="${A}"]`);
  await page.waitForTimeout(150);
  const post = calls.find((c) => c.path === '/api/favorites' && c.method === 'POST');
  check('signed in: POST body', post && post.body, { id: A, on: true });
  await ctx.close();
}

/* 7. /saved signed out: rows come from the browser's list */
{
  const { page, ctx, calls } = await open({
    signedIn: false, seed: [A], page: 'page--saved',
  });
  const cards = calls.find((c) => c.path === '/api/favorites/cards');
  check('saved: asked for local ids', cards && cards.query, A);
  await ctx.close();
}

/* 8. storage blocked: hearts still toggle, nothing throws */
{
  const ctx = await browser.newContext();
  await ctx.route('**/api/favorites**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ signedIn: false, ids: [] }) }));
  await ctx.route('**/x/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: PAGE() }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://local.test/x/');
  await page.evaluate(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new Error('blocked'); },
    });
  });
  await page.addScriptTag({ content: SCRIPT });
  await page.waitForTimeout(200);
  await page.click(`[data-fav="${A}"]`);
  check('storage blocked: still toggles', await pressed(page), [A]);
  check('storage blocked: no errors', errors, []);
  await ctx.close();
}

await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}` +
              (r.pass ? '' : `\n        got ${r.got}\n       want ${r.want}`));
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
