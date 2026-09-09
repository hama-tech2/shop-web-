/** Real renderer fixtures, served only through Playwright interception.
 * No fixture route/status flags are shipped in the Worker or public scripts.
 * Requires the existing local Worker adapter + Supabase stub, like subscription-ui.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paymentResult, paymentResultPage } from '../worker/render/payment-result.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const out = join(tmpdir(), 'bazaro-payment-result');
await mkdir(out, {recursive:true});
let count = 0;
function check(name, ok) { assert.ok(ok, name); count++; console.log('PASS ' + name); }
const base = { plan:'year_1', amount:90000, shopSlug:'fixture-shop', expiresAt:'2027-09-07T12:00:00Z' };
const states = ['checking','success','failed','cancelled'];
const titles = ['پارەدانەکەت دەپشکنرێت','پارەدان سەرکەوتوو بوو','پارەدان سەرکەوتوو نەبوو','پارەدان هەڵوەشێنرایەوە'];
for (const invalid of [{}, {...base,state:'unknown'}, {...base,state:'success',expiresAt:null}, {...base,state:'success',shopSlug:'//evil.example'}, {...base,state:'success',amount:'90000'}]) {
  assert.throws(() => paymentResult(invalid), TypeError); count++;
}
check('method omitted without trusted value', !paymentResult({...base,state:'success'}).includes('شێوازی پارەدان'));
check('trusted method escaped', paymentResult({...base,state:'success',method:'<FIB>'}).includes('&lt;FIB&gt;'));
check('checking shows no provider even when supplied', !paymentResult({...base,state:'checking',method:'FIB'}).includes('FIB'));
check('no production result renderer import', !(await readFile('worker/routes/account.js','utf8')).includes('payment-result'));
for (const p of ['/__mode/shop','/__rows/1','/__plan/trial','/__sub/20','/__intent/none','/__wayl/reset','/__calls/reset']) await fetch(STUB+p);
const browser = await chromium.launch({ executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const ctx = await browser.newContext();
  await ctx.addCookies([{name:'sb-access',value:'TEST',url:APP}]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror',e => errors.push(e.message));
  for (const query of ['status=success','step=result&status=success','step=checkout&status=success','step=method&status=success&verified=true','status=checking','status=failed','status=cancelled']) {
    await page.goto(APP+'/app/subscription?'+query);
    check('query cannot create result: '+query, await page.locator('.payment-result').count() === 0 && await page.locator('#payment-method-form').count() === 0);
  }
  const noResultRoute = await fetch(APP+'/app/subscription/result?status=success',{headers:{cookie:'sb-access=TEST'},redirect:'manual'});
  check('unknown result path uses existing app fallback, never a result', !(await noResultRoute.text()).includes('class="payment-result"'));
  await page.route(APP+'/_fixture/result/*', route => {
    const state = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({contentType:'text/html',body:paymentResultPage({...base,state})});
  });
  for (const width of [320,360,390,430]) {
    await page.setViewportSize({width,height:844});
    for (const [i,state] of states.entries()) {
      await page.goto(APP+'/_fixture/result/'+state);
      await page.evaluate(() => document.fonts.ready);
      const suffix = state+' '+width;
      check('correct state heading '+suffix, await page.locator('#payment-result-heading').textContent() === titles[i]);
      check('RTL no overflow '+suffix, await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.scrollWidth <= innerWidth));
      check('no app navigation '+suffix, await page.locator('.nav,nav').count() === 0);
      check('real fixture plan/amount '+suffix, (await page.locator('dl').innerText()).includes('90,000') && (await page.locator('dl').innerText()).includes('1 ساڵ'));
      check('no invented payment details '+suffix, !(await page.locator('main').innerText()).match(/FIB|SuperQi|Wayl|SW-|QR|2026\/03\/15/));
      check('status announced '+suffix, await page.locator('[role="status"][aria-live="polite"]').count() === 1);
      check('44px link targets '+suffix, await page.locator('main a').evaluateAll(as => as.every(a=>a.getBoundingClientRect().height >=44)));
      if (state === 'checking') {
        check('checking only plan and amount '+width, await page.locator('dl > div').count() === 2);
        check('checking has no primary CTA '+width, await page.locator('.payment-result__actions').count() === 0);
        check('calm continuous spinner '+width, await page.locator('.payment-result__spinner').evaluate(el => getComputedStyle(el).animationIterationCount === 'infinite' && getComputedStyle(el).animationDuration === '1.4s'));
      } else if (state === 'success') {
        check('activated status/expiry '+width, (await page.locator('dl').innerText()).includes('2027/09/07') && (await page.locator('.payment-result__active').innerText()).includes('چالاک'));
        check('Account destination '+width, await page.locator('.payment-result__primary').getAttribute('href') === '/app#account-settings');
        check('owned public shop destination '+width, await page.locator('.payment-result__secondary').getAttribute('href') === '/@fixture-shop');
      } else {
        check('retry returns to safe checkout entry '+suffix, await page.locator('.payment-result__primary').getAttribute('href') === '/app/subscription?plan=year_1&step=checkout');
        check('back preserves selected plan '+suffix, await page.locator('.payment-result__secondary').getAttribute('href') === '/app/subscription?plan=year_1');
      }
      await page.screenshot({path:join(out,state+'-'+width+'.png'),fullPage:true});
    }
  }
  await page.goto(APP+'/_fixture/result/checking');
  // Only the fixture harness swaps server-rendered HTML; no such JS ships.
  await page.locator('main').evaluate((el, html) => {el.outerHTML=html;}, paymentResult({...base,state:'success'}));
  check('checking to success uses 220ms fade/scale', await page.locator('.payment-result__content').evaluate(el => getComputedStyle(el).animationName === 'payment-result-reveal' && getComputedStyle(el).animationDuration === '0.22s'));
  await page.emulateMedia({reducedMotion:'reduce'});
  check('success reduced motion', await page.locator('.payment-result__content').evaluate(el => getComputedStyle(el).animationName === 'none'));
  await page.goto(APP+'/_fixture/result/checking');
  check('spinner reduced motion', await page.locator('.payment-result__spinner').evaluate(el => getComputedStyle(el).animationName === 'none'));
  await page.keyboard.press('Tab');
  check('visible keyboard focus', await page.locator('.payment-result__header a').evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle === 'solid'));
  await page.goto(APP+'/_fixture/result/failed');
  await page.locator('.payment-result__primary').click();
  // What the plans screen does with ?step=checkout depends on PAYMENTS_ENABLED, so
  // the test reads the mode off the screen rather than assuming one. What must hold
  // either way: a retry lands on the plans screen, never on a result or the chooser,
  // and a query parameter never starts a payment.
  const paymentsOn = await page.locator('#plan-form[action="/app/subscription/checkout"]').count() === 1;
  check('retry lands on the plans screen only', await page.locator('#plan-form').count() === 1 && await page.locator('.payment-result').count() === 0 && await page.locator('#payment-method-form').count() === 0);
  check('a query parameter creates no Wayl checkout', (await (await fetch(STUB+'/__wayl')).json()).created.length === 0);
  check(paymentsOn ? 'with checkout on, the plan form is a real post' : 'with checkout off, the screen says so', paymentsOn ? await page.locator('#plan-form').getAttribute('method') === 'post' : await page.locator('.alert[role="alert"]').isVisible());
  const writes = await (await fetch(STUB+'/__writes')).json();
  check('no writes beyond subscription read RPC', writes.every(w => w.table === 'rpc/subscription_state'));
  check('no script errors', errors.length === 0);
  await ctx.close();
} finally { await browser.close(); }
console.log(`All ${count} Payment Result checks passed. Screenshots: ${out}`);
