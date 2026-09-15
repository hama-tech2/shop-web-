/** Approved gate, renewal and Account UI against the real Worker + local stub.
 * node scripts/plan-screens-ui-test.mjs [app URL] [stub URL]
 * Browser-only fixtures are intercepted here, never installed in production.
 * Every checkout/Free form submission below is intercepted: no real charge.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { settingsPanel } from '../worker/render/settings.js';
import { subscriptionPage } from '../worker/render/subscription.js';
import { bottomNav } from '../worker/render/appshell.js';
import { layout } from '../worker/render/layout.js';
import { planState } from '../worker/plan-state.js';
import { SUPPORT_WHATSAPP, FREE_PRODUCT_LIMIT } from '../worker/config.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const screenshots = join(tmpdir(), 'bazaro-plan-screens');
await mkdir(screenshots, { recursive: true });
const control = async (path) => { const r = await fetch(STUB + path); assert.ok(r.ok); };
const fresh = async () => {
  for (const path of ['/__mode/shop','/__rows/1','/__admin/0','/__products/0','/__plan/free','/__sub/0','/__intent/none','/__calls/reset']) await control(path);
};
let count = 0;
const check = (label, condition) => { assert.ok(condition, label); count++; };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  await fresh();
  // The gate is deliberately tested without JS: choosing a paid plan must never
  // fall back to the Free action when scripts fail or have not arrived yet.
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  await ctx.addCookies([{ name:'sb-access', value:'TEST', url:APP }]);
  const page = await ctx.newPage();
  const submissions = [];
  await page.route(APP + '/app/subscription/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions.push({ path:new URL(route.request().url()).pathname, fields:new URLSearchParams(route.request().postData()) });
    return route.fulfill({ status:204 });
  });
  for (const [width, height] of [[320,844],[360,640],[390,844],[430,844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(APP + '/app/new');
    await page.evaluate(() => document.fonts.ready);
    const submissionsBefore = submissions.length;
    check('gate RTL/overflow ' + width, await page.locator('html').getAttribute('dir') === 'rtl' && !await overflow(page));
    check('Free is selected without writing ' + width, await page.locator('input[name="gate-plan"][value="free"]').isChecked());
    check('cap in the Free explanation ' + width,
      (await page.locator('.gate-free__explanation').innerText()).includes(`تا ${FREE_PRODUCT_LIMIT} بەرهەم`) &&
      !/تا \d+ بەرهەم/.test(await page.locator('.billing-features').innerText()));
    check('paid options in approved order ' + width,
      JSON.stringify(await page.locator('.gate-plan').evaluateAll((els) => els.map((el) => el.dataset.plan))) === JSON.stringify(['free','months_6','year_1']));
    // Layout-relative, not viewport-relative: selecting a card scrolls it
    // clear of the dock, so a viewport box would move without anything
    // having reflowed. offsetTop/offsetHeight answer the real question.
    const box = () => page.locator('#gate-options')
      .evaluate((el) => [el.offsetTop, el.offsetHeight, el.offsetWidth]);
    const before = await box();
    for (const selected of ['months_6','year_1','free','year_1','months_6','free']) {
      await page.locator(`[data-plan="${selected}"]`).click();
      check('native gate choice ' + selected + ' ' + width, await page.locator(`input[name="gate-plan"][value="${selected}"]`).isChecked());
      check('one visible continue action ' + selected + ' ' + width, await page.locator('.gate-actions button:visible').count() === 1);
      check('matching action ' + selected + ' ' + width, await page.locator(`.gate-actions [data-choice="${selected}"]`).isVisible());
      check('badge stays yearly ' + selected + ' ' + width, await page.locator('[data-plan="year_1"] .billing-best').innerText() === 'باشترین هەڵبژاردە');
    }
    check('selection never submits ' + width, submissions.length === submissionsBefore);
    check('gate choices do not shift ' + width, JSON.stringify(await box()) === JSON.stringify(before));
    for (const selected of ['free','months_6','year_1']) {
      await page.locator(`[data-plan="${selected}"]`).click();
      const button = page.locator('.gate-actions button:visible');
      check('normal sized gate CTA ' + selected + ' ' + width, await button.evaluate((el) => el.offsetHeight >= 44 && el.offsetHeight <= 58));
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), button.click()]);
      const sent = submissions.at(-1);
      check('explicit correct POST with JS off ' + selected + ' ' + width,
        sent.path === (selected === 'free' ? '/app/subscription/free' : '/app/subscription/checkout') &&
        (selected === 'free' || sent.fields.get('plan') === selected));
    }
    await page.locator('[data-plan="free"]').click();
    await page.waitForTimeout(220);

    // The whole point of the dock: the action is on screen the moment
    // the page loads, without scrolling past the benefits. An available
    // Free plan that looks unavailable is the bug this fixes.
    check('the Free action is on screen without scrolling ' + width,
      await page.locator('.gate-actions button:visible').evaluate((el) => {
        const b = el.getBoundingClientRect();
        return b.top >= 0 && b.bottom <= innerHeight;
      }));
    check('the dock is fixed, not the end of the page ' + width,
      await page.locator('.gate-actions').evaluate((el) => getComputedStyle(el).position === 'fixed'));
    check('and it sits outside the scrolling content ' + width,
      await page.locator('.gate-actions').evaluate((el) => !el.closest('.billing--gate')));
    check('the benefits do not decide where it is ' + width,
      await page.evaluate(() => {
        const dock = document.querySelector('.gate-actions');
        const features = document.querySelector('.billing-features');
        return features !== null && !features.contains(dock);
      }));
    check('one action only, no duplicate CTA ' + width,
      await page.locator('.gate-actions button:visible').count() === 1
      && await page.locator('.billing--gate button[type="submit"]').count() === 0);

    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    check('gate action clears bottom navigation ' + width,
      await page.locator('.gate-actions button:visible').evaluate((el) => el.getBoundingClientRect().bottom <= document.querySelector('.nav').getBoundingClientRect().top));
    check('it is still there at the bottom of the page ' + width,
      await page.locator('.gate-actions button:visible').evaluate((el) => {
        const b = el.getBoundingClientRect();
        return b.top >= 0 && b.bottom <= innerHeight;
      }));
    check('and the last content is not hidden under it ' + width,
      await page.evaluate(() => {
        const last = document.querySelector('.billing-features li:last-child');
        const dock = document.querySelector('.gate-actions').getBoundingClientRect();
        return last.getBoundingClientRect().bottom <= dock.top + 1;
      }));
    check('no horizontal overflow with the dock ' + width,
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check('RTL still ' + width, await page.locator('html').getAttribute('dir') === 'rtl');

    // Paid selection swaps the action to the payment one, same dock.
    await page.locator('[data-plan="year_1"]').click();
    check('a paid plan shows the payment action in the dock ' + width,
      await page.locator('.gate-actions [data-choice="year_1"] button').isVisible()
      && await page.locator('.gate-actions button:visible').count() === 1);
    check('and the dinar charge rides with it ' + width,
      await page.locator('.gate-actions [data-choice="year_1"] .billing-charge').isVisible());
    await page.locator('[data-plan="free"]').click();
    await page.screenshot({ path:join(screenshots, `gate-${width}.png`), fullPage:true });
  }
  check('no write reached the backend while selecting', (await (await fetch(STUB + '/__writes')).json()).every((w) => w.table === 'rpc/subscription_state'));
  await page.locator('input[name="gate-plan"][value="free"]').focus();
  await page.keyboard.press('ArrowDown');
  check('gate keyboard changes selection', await page.locator('input[name="gate-plan"][value="months_6"]').isChecked());
  check('gate focus visible', await page.locator('input[name="gate-plan"][value="months_6"] + span').evaluate((el) => getComputedStyle(el).outlineStyle === 'solid'));
  await page.emulateMedia({ reducedMotion:'reduce' });
  check('gate reduced motion', await page.locator('.billing-choice__surface').first().evaluate((el) => getComputedStyle(el).transitionDuration === '0s'));
  await control('/__products/5');
  await page.goto(APP + '/app/subscription/start');
  check('full Free cannot continue', await page.locator('[data-plan="free"] input').isDisabled() && await page.locator('#start-trial').count() === 0);
  check('full-Free gate defaults to a paid plan', await page.locator('input[name="gate-plan"][value="year_1"]').isChecked() && await page.locator('.gate-actions button:visible').count() === 1);
  await ctx.close();

  const ui = await browser.newContext();
  await ui.addCookies([{ name:'sb-access', value:'TEST', url:APP }]);
  const view = await ui.newPage();
  const errors = [];
  view.on('pageerror', (e) => errors.push(e.message));
  const shop = { name:'دوکانی بەرهەمە ناوخۆییەکان و پێداویستییەکانی ماڵ و خێزان', slug:'a-very-long-real-shop-link', whatsapp:'٠٧٥١٢٣٤٥٦٧٨', city:'erbil' };
  const expiry = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const scenarios = [
    ['free', { plan:'free', status:'free', tier:'free', expires_at:expiry(25) }, 'بینینی پلانەکان'],
    ['active', { plan:'year_1', status:'active', expires_at:expiry(120) }, 'بینینی پلانەکان'],
    ['ending', { plan:'months_6', status:'active', expires_at:expiry(3) }, 'نوێکردنەوەی پلان'],
    ['grace', { plan:'year_1', status:'active', tier:'free', expires_at:expiry(-1) }, 'بینینی پلانەکان'],
    ['expired', { plan:'year_1', status:'active', tier:'free', expires_at:expiry(-10) }, 'بینینی پلانەکان'],
    ['none', { plan:'none', status:'none' }, 'بینینی پلانەکان'],
    ['missing', null, 'بینینی پلانەکان'],
  ];
  await view.route(APP + '/_fixture/account?**', (route) => {
    const [key, state] = scenarios.find(([key]) => key === new URL(route.request().url()).searchParams.get('state'));
    const profile = key === 'missing' ? {...shop, city:null, whatsapp:null} : shop;
    const body = settingsPanel({ shop:profile, subscription:state ? {state,plan:planState(state)} : null }) + bottomNav('account', {accountLabel:'هەژمار'});
    return route.fulfill({ contentType:'text/html', body:layout({ title:'Account fixture', body, scripts:['/js/account.js'] }) });
  });
  for (const width of [320,360,390,430]) {
    await view.setViewportSize({ width, height:844 });
    for (const [key, state, cta] of scenarios) {
      await view.goto(APP + '/_fixture/account?state=' + key + '#account-settings');
      check('Account no overflow ' + key + width, !await overflow(view));
      check('one plan card/CTA ' + key + width, await view.locator('.settings-plan').count() === 1 && await view.locator('#settings-subscription').innerText() === cta);
      check('no cap, payment info or duplicate banner ' + key + width,
        await view.locator('#account-settings .plan-banner, .settings-plan__limit').count() === 0 && !/تا \d+ بەرهەم|Wayl|FIB|PIN|OTP/.test(await view.locator('.settings-plan').innerText()));
      check('real expiry only ' + key + width, await view.locator('.settings-plan time').count() === (state?.expires_at && state?.tier !== 'free' ? 1 : 0));
      if (key === 'free') {
        // Free carries no clock at all now: not a countdown, and not a
        // line about there being no countdown either.
        check('permanent Free has no date/countdown ' + width, (await view.locator('.settings-plan').innerText()).includes('بەخۆڕایی') && !/ڕۆژ ماوە|کۆتایی|سنووری کات/.test(await view.locator('.settings-plan').innerText()));
        check('Latin phone digits ' + width, !/[٠-٩۰-۹]/.test(await view.locator('.settings-identity').innerText()));
        await view.evaluate(() => document.fonts.ready);
        await view.evaluate(() => scrollTo(0, document.body.scrollHeight));
        check('logout clears bottom navigation ' + width,
          await view.locator('.settings-logout button').evaluate((el) => el.getBoundingClientRect().bottom <= document.querySelector('.nav').getBoundingClientRect().top));
        await view.screenshot({ path:join(screenshots, `account-${width}.png`), fullPage:true });
      }
    }
    check('fallback avatar ' + width, await view.locator('.settings-avatar svg').isVisible());
    check('configured support destination ' + width, await view.locator('.settings-row[href^="https://wa.me/"]').getAttribute('href') === 'https://wa.me/' + SUPPORT_WHATSAPP.replace(/\D/g, ''));
    check('public link unchanged ' + width, await view.locator('a[href="/@' + shop.slug + '"]').count() === 1);
    check('three existing nav destinations ' + width, JSON.stringify(await view.locator('.nav a').evaluateAll((els) => els.map((el) => el.getAttribute('href')))) === JSON.stringify(['/','/saved','/app']));
    check('missing contact/location leaves no empty rows ' + width, await view.locator('.settings-identity__body p').count() === 0);
  }
  await control('/__plan/free'); await control('/__sub/25');
  await view.goto(APP + '/app#account-settings');
  await view.locator('#settings-subscription').click();
  check('Account plans link opens existing plans', new URL(view.url()).pathname === '/app/subscription');
  await view.goto(APP + '/app#account-settings');
  await view.locator('.settings-edit').click();
  check('Edit Profile opens existing form', new URL(view.url()).pathname === '/app/profile' && await view.locator('form[action="/app/profile"]').count() === 1);
  await view.goto(APP + '/app#account-settings');
  const publicLink = await view.locator('.settings-row[href^="/@"]').getAttribute('href');
  await view.locator('.settings-row[href^="/@"]').click();
  check('Public Profile opens directly', new URL(view.url()).pathname === publicLink);
  await view.goto(APP + '/app#account-settings');
  await view.locator('.settings-logout button').click();
  // /app itself now answers a signed-out visitor with the visitor page
  // rather than a login form — a customer needs no account, and
  // scripts/entry-points-test.mjs pins that screen. So the proof that
  // logout worked is that the owner view is gone from it and the gated
  // seller screens send this browser back to log in.
  const afterLogout = await ui.request.get(APP + '/app', { maxRedirects:0 });
  const afterLogoutHtml = afterLogout.status() === 200 ? await afterLogout.text() : '';
  // /app/products is retired and redirects to /app for everybody, so
  // it no longer proves anything about a session. /app/profile is
  // still genuinely seller-only.
  const gated = await ui.request.get(APP + '/app/profile', { maxRedirects:0 });
  check('logout still clears the authenticated session',
    !afterLogoutHtml.includes('settings-logout')
    && !afterLogoutHtml.includes('owner-controls')
    && gated.status() === 303
    && gated.headers().location.startsWith('/login'));
  check('no browser script errors', errors.length === 0);
  await ui.close();
  // Exercise server-controlled form rendering without enabling payments anywhere.
  const on = subscriptionPage({ state:scenarios[1][1], paymentsEnabled:true });
  check('enabled server state uses existing hosted checkout', /method="post" action="\/app\/subscription\/checkout" id="plan-form"/.test(on));
  check('no chooser/manual flow in primary plans', !/payment-method-form|subscription\/pay"|SW-/.test(on));
} finally { await browser.close(); }
console.log(`All ${count} approved-screen UI checks passed. Screenshots: ${screenshots}`);
