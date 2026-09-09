/** Read-only seller billing UI. Run against the real Worker and local Supabase stub.
 * node scripts/subscription-ui-test.mjs [app URL] [stub URL]
 * CHROME may select a locally installed Chromium browser. No real payments/data.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subscriptionPage, paymentMethodPage } from '../worker/render/subscription.js';
import { layout } from '../worker/render/layout.js';
import { PLANS } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const screenshots = join(tmpdir(), 'bazaro-subscription-ui');
await mkdir(screenshots, { recursive: true });
let count = 0;
const check = (name, ok) => { assert.ok(ok, name); count++; console.log('PASS ' + name); };
const stub = (path) => fetch(STUB + path);
for (const path of ['/__mode/shop', '/__rows/1', '/__admin/0', '/__plan/trial', '/__sub/20', '/__intent/none', '/__calls/reset']) await stub(path);
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'sb-access', value: 'TEST', url: APP }]);
  const page = await ctx.newPage();
  // Chooser is dormant: exercise its preserved code via test-only interception.
  // No production route or fixture switch is installed.
  await page.route(APP + '/_fixture/method?**', (route) => {
    const plan = PLANS.find((p) => p.key === new URL(route.request().url()).searchParams.get('plan'));
    return route.fulfill({ contentType: 'text/html', body: layout({ title:'Test fixture', description:'', body:paymentMethodPage({plan}), scripts:['/js/subscription.js'] }) });
  });
  const errors = [], posts = [], external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.method() !== 'GET') posts.push(r.url());
    if (/wayl|wa\.me|fib\.iq/i.test(r.url())) external.push(r.url());
  });
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const position = (selector) => page.locator(selector).evaluate((el) => ({ top: el.getBoundingClientRect().top, height: el.offsetHeight, scroll: scrollY }));
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(APP + '/app/subscription');
    await page.evaluate(() => document.fonts.ready);
    check('default yearly ' + width, await page.locator('input[value="year_1"]').isChecked());
    check('exactly two plans ' + width, await page.locator('input[name="plan"]').count() === 2);
    check('trial is real RPC state ' + width, await page.locator('.billing-state').getAttribute('data-plan-state') === 'trial');
    check('trial days are real ' + width, await page.locator('.billing-state').getAttribute('data-plan-days') === '20');
    check('prices and monthly equivalents ' + width, (await page.locator('[data-plan="year_1"]').innerText()).includes('90,000') && (await page.locator('[data-plan="year_1"]').innerText()).includes('7,500') && (await page.locator('[data-plan="months_6"]').innerText()).includes('55,000') && (await page.locator('[data-plan="months_6"]').innerText()).includes('9,200'));
    check('1000 product cap ' + width, (await page.locator('.billing-features').innerText()).includes('تا 1000 بەرهەم'));
    check('Plans RTL without overflow ' + width, await noOverflow() && await page.locator('html').getAttribute('dir') === 'rtl');
    const before = await position('.billing-options');
    for (const key of ['months_6', 'year_1', 'months_6']) {
      await page.locator('[data-plan="' + key + '"]').click();
      check('native selected ' + key + ' at ' + width, await page.locator('input[value="' + key + '"]').isChecked());
      check('Best Value stays yearly ' + key + ' at ' + width, await page.locator('[data-plan="year_1"] .billing-best').count() === 1 && await page.locator('[data-plan="months_6"] .billing-best').count() === 0);
    }
    await page.waitForTimeout(220);
    check('no plan layout or scroll jump ' + width, JSON.stringify(await position('.billing-options')) === JSON.stringify(before));
    check('3 existing navigation destinations ' + width, JSON.stringify(await page.locator('.nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) === JSON.stringify(['/','/saved','/app']));
    await page.screenshot({ path: join(screenshots, 'plans-' + width + '.png'), fullPage: true });
    await page.locator('#pay-btn').click();
    await page.waitForURL('**/app/subscription?**');
    check('Pay stays safely on Plans ' + width, await page.locator('#plan-form').count() === 1 && await page.locator('.alert[role="alert"]').isVisible());
    check('chooser absent from active flow ' + width, await page.locator('#payment-method-form').count() === 0);
    await page.goto(APP + '/_fixture/method?plan=months_6');
    check('selected six months carried forward ' + width, (await page.locator('.billing-summary').innerText()).includes('55,000') && !(await page.locator('.billing-summary').innerText()).includes('90,000'));
    check('six month summary has no yearly badge ' + width, await page.locator('.billing-summary .billing-best').count() === 0);
    check('two methods only ' + width, await page.locator('input[name="method"]').count() === 2);
    const methodBefore = await position('.billing-methods');
    for (const [key, name] of [['superqi','SuperQi'], ['fib','FIB'], ['superqi','SuperQi']]) {
      await page.locator('.billing-method').filter({ has: page.locator('input[value="' + key + '"]') }).click();
      check('method and CTA ' + key + ' at ' + width, await page.locator('input[value="' + key + '"]').isChecked() && await page.locator('#method-continue bdi').textContent() === name);
    }
    check('no method layout or scroll jump ' + width, JSON.stringify(await position('.billing-methods')) === JSON.stringify(methodBefore));
    check('method page no overflow ' + width, await noOverflow());
    check('normal CTA height ' + width, await page.locator('#method-continue').evaluate((el) => el.offsetHeight >= 50 && el.offsetHeight <= 54));
    await page.waitForTimeout(220);
    await page.screenshot({ path: join(screenshots, 'methods-' + width + '.png'), fullPage: true });
    await page.locator('#method-continue').click();
    check('Continue gives unavailable feedback ' + width, await page.locator('#payment-unavailable').isVisible());
    check('feedback receives focus ' + width, await page.locator('#payment-unavailable').evaluate((el) => el === document.activeElement));
    check('no legacy manual UI ' + width, await page.locator('a[href="/app/subscription/pay"], form[action="/app/subscription/sent"], #pay-reference').count() === 0);
  }
  await page.goto(APP + '/app/subscription?plan=months_6');
  check('valid explicit plan preserved', await page.locator('input[value="months_6"]').isChecked());
  await page.goto(APP + '/app/subscription?plan=invalid');
  check('invalid plan safely defaults yearly', await page.locator('input[value="year_1"]').isChecked());
  await page.locator('input[value="year_1"]').focus();
  await page.keyboard.press('ArrowDown');
  check('keyboard plan selection', await page.locator('input[value="months_6"]').isChecked());
  check('visible keyboard focus', await page.locator('input[value="months_6"] + span').evaluate((el) => getComputedStyle(el).outlineStyle === 'solid'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check('reduced motion disables transitions', await page.locator('.billing-choice__surface').first().evaluate((el) => getComputedStyle(el).transitionDuration === '0s'));
  await page.goto(APP + '/app/subscription?step=method&plan=year_1');
  check('old chooser bookmark stays dormant', await page.locator('#payment-method-form').count() === 0);
  await page.goto(APP + '/_fixture/method?plan=year_1');
  check('year summary and badge', (await page.locator('.billing-summary').innerText()).includes('90,000') && await page.locator('.billing-summary .billing-best').count() === 1);
  await page.locator('input[value="fib"]').focus(); await page.keyboard.press('ArrowDown');
  check('keyboard method and CTA', await page.locator('input[value="superqi"]').isChecked() && await page.locator('#method-continue bdi').textContent() === 'SuperQi');
  for (const [plan, days, expected] of [['year_1',90,'active'], ['year_1',-1,'grace'], ['year_1',-10,'expired']]) {
    await stub('/__plan/' + plan); await stub('/__sub/' + days);
    await page.goto(APP + '/app/subscription');
    check('real subscription ' + expected, await page.locator('.billing-state').getAttribute('data-plan-state') === expected);
  }
  await stub('/__sub/20'); await stub('/__intent/pending');
  await page.goto(APP + '/app/subscription');
  check('pending status retained without manual entry', await page.locator('.billing-state').getAttribute('data-plan-state') === 'pending' && await page.locator('a[href="/app/subscription/pay"]').count() === 0);
  check('unknown state never claims active or trial', !/data-plan-state=/.test(subscriptionPage({ state:null })));
  check('no client POSTs or provider calls', posts.length === 0 && external.length === 0);
  check('no browser JS errors', errors.length === 0);
  await ctx.close();

  const noJS = await browser.newContext({ javaScriptEnabled: false });
  await noJS.addCookies([{ name:'sb-access', value:'TEST', url:APP }]);
  const plain = await noJS.newPage();
  await plain.goto(APP + '/app/subscription?plan=months_6');
  await plain.locator('#pay-btn').click();
  check('no-JS Pay is read-only unavailable state', new URL(plain.url()).searchParams.get('step') === 'checkout' && await plain.locator('.alert[role="alert"]').isVisible());
  check('no-JS selected plan preserved', await plain.locator('input[value="months_6"]').isChecked());
  check('no-JS cannot open chooser', await plain.locator('#payment-method-form').count() === 0);
  await noJS.close();
  const writes = await (await stub('/__writes')).json();
  check('whole primary journey makes no payment write', writes.every((w) => w.table === 'rpc/subscription_state'));
  const signedOut = await fetch(APP + '/app/subscription?step=method&plan=year_1', { redirect:'manual' });
  check('chooser retains logged-out guard', signedOut.status === 303 && signedOut.headers.get('location').startsWith('/login'));
} finally { await browser.close(); }
console.log(`\nAll ${count} billing UI checks passed. Screenshots: ${screenshots}`);
