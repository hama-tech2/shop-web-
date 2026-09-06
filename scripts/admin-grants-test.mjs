// Real Worker routes against stub-supabase; DB semantics are separately tested
// with admin-grants-db-test.sql, inside a rolled-back transaction.
import assert from 'node:assert/strict';
import { grantProof, validGrantProof } from '../worker/admin-grant.js';
import { chromium } from 'playwright-core';
const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const SHOP = 'aaaaaaaa-1111-4111-8111-111111111111';
const path = `/admin/shops/${SHOP}/grant`;
const cookie = 'sb-access=TEST';
let count = 0;
const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); count++; console.log('PASS ' + name); };
const set = (path) => fetch(STUB + path);
const writes = () => fetch(STUB + '/__writes').then((r) => r.json());
const grants = async () => (await writes()).filter((w) => w.table === 'rpc/admin_grant_plan');
const get = (p = path, auth = true) => fetch(APP + p, { headers: auth ? { cookie } : {} });
const post = (fields, origin = APP) => fetch(APP + path, {
  method: 'POST', redirect: 'manual', headers: { cookie, origin }, body: new URLSearchParams(fields),
});
const hidden = (html) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)]
  .map((m) => [m[1], m[2].replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')]));

const review = { shop: SHOP, admin: 'admin', plan: 'months_6', reason: 'gift', request: crypto.randomUUID(), until: Date.now() + 60000 };
const proof = await grantProof('session-secret', review);
check('review signature verifies', await validGrantProof('session-secret', review, proof));
for (const [key, value] of Object.entries({ shop: 'other', admin: 'other', plan: 'year_1', reason: 'changed', request: crypto.randomUUID(), until: Date.now() - 1 })) {
  check(`review binds ${key}`, await validGrantProof('session-secret', { ...review, [key]: value }, proof), false);
}
check('review belongs to one session', await validGrantProof('other-token', review, proof), false);

await set('/__mode/shop'); await set('/__rows/1'); await set('/__admin-active/1'); await set('/__admin/0');
const unknown = await get('/not-a-real-route').then((r) => r.text());
check('anonymous grant page is ordinary 404', (await get(path, false)).status, 404);
check('non-admin grant page is ordinary 404', (await get()).status, 404);
check('non-admin page does not reveal admin UI', await get().then((r) => r.text()), unknown);
check('non-admin cannot POST', (await post({ plan: 'months_6', reason: 'gift' })).status, 404);
await set('/__admin/1'); await set('/__admin-active/0');
check('inactive admin cannot view', (await get()).status, 404);
check('inactive admin cannot POST', (await post({})).status, 404);
await set('/__admin-active/1'); await set('/__calls/reset');
check('active admin can view', (await get()).status, 200);
check('foreign origin rejected', (await post({}, 'https://evil.test')).status, 403);
for (const f of [{ plan: 'trial', reason: 'gift' }, { plan: 'months_6', reason: '  ' }, { plan: 'year_1', reason: 'x'.repeat(501) }]) {
  check('invalid details show validation', (await post(f).then((r) => r.text())).includes('role="alert"'));
}
check('no grants before valid review', (await grants()).length, 0);
let html = await post({ plan: 'months_6', reason: 'friend <test>', step: 'review' }).then((r) => r.text());
check('review names exact plan and escaped reason', html.includes('friend &lt;test&gt;') && html.includes('adm-grant-review'));
check('review makes no grant', (await grants()).length, 0);
const form = { ...hidden(html), step: 'confirm' };
await post({ ...form, reason: 'changed' });
check('tampering makes no grant', (await grants()).length, 0);
html = await post({ ...form, step: 'edit' }).then((r) => r.text());
check('back to edit preserves input', html.includes('friend &lt;test&gt;') && html.includes('id="grant-plan"'));
await set('/__rows/0');
html = await post(form).then((r) => r.text());
check('failure preserves reason and retry request', html.includes('friend &lt;test&gt;') && hidden(html).request === form.request);
await set('/__rows/1');
const success = await post(form);
check('confirmed grant redirects with success', success.headers.get('location'), `/admin/shops/${SHOP}?saved=1`);
const sent = (await grants()).at(-1).body;
check('only intended details reach grant RPC', sent, { p_shop: SHOP, p_plan: 'months_6', p_reason: 'friend <test>', p_request: form.request });
html = await get(`/admin/shops/${SHOP}`).then((r) => r.text());
check('manual history is distinctly labelled', html.includes('مێژووی بەخشینی پلان — بەخۆڕایی'));
check('history includes reason and actor', html.includes('friend &lt;test&gt;') && html.includes('ffffffff-1111-4111-8111-111111111111'));
check('shop finder accepts slug', (await get('/admin/shops?q=nafin').then((r) => r.text())).includes(`/admin/shops/${SHOP}`));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
try {
  // Confirmation is server-rendered and remains usable without JavaScript.
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.addCookies([{ name: 'sb-access', value: 'TEST', url: APP }]);
  const page = await context.newPage();
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(APP + path);
    await page.locator('#grant-plan').selectOption('year_1');
    await page.locator('#grant-reason').fill('بەخشین بۆ یەکەم دوکاندار — '.repeat(12));
    check(`form fits ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('button[value="review"]').click();
    await page.locator('.adm-grant-review').waitFor();
    check(`review fits ${width}px without JS`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`RTL at ${width}px`, await page.locator('html').getAttribute('dir'), 'rtl');
    if (process.env.QA_DIR) await page.screenshot({ path: `${process.env.QA_DIR}/admin-grant-${width}.png`, fullPage: true });
    await page.locator('button[value="edit"]').click();
    check(`edit preserves mobile input at ${width}px`, (await page.locator('#grant-reason').inputValue()).startsWith('بەخشین'));
  }
} finally { await browser.close(); await set('/__admin/0'); }
console.log(`All ${count} admin grant checks passed.`);
