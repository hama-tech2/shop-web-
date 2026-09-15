/** Local Worker + scripts/stub-supabase.mjs only. No real credentials.
 * node scripts/login-ui-test.mjs [app] [screenshot-directory]
 * CHROME may override the installed Chrome executable.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTH, VISITOR } from '../worker/config.js';
import { loginPage } from '../worker/render/auth.js';
import { layout } from '../worker/render/layout.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const out = process.argv[3] || join(tmpdir(), 'bazaro-login-ui');
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(APP).hostname), 'local tests only');
await mkdir(out, { recursive: true });
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log('PASS ' + name); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  for (const width of [320, 360, 390, 430]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(APP + '/app');
    await page.evaluate(() => document.fonts.ready);
    check(`${width}: actual Kurdish webfont loaded for visual QA`, await page.evaluate(() =>
      [...document.fonts].some(face => face.family === 'Vazirmatn' && face.status === 'loaded')));
    check(`${width}: customer and seller explanations`,
      (await page.locator('h1').innerText()) === VISITOR.noAccountNeeded &&
      (await page.locator('.login__sub').innerText()) === VISITOR.sellerBody);
    const geometry = await page.evaluate(() => {
      const controls = [...document.querySelectorAll('.login a, .login button:not([hidden]), .login input:not([type="hidden"])')];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        rtl: document.documentElement.dir === 'rtl',
        targets: controls.every(el => { const r = el.getBoundingClientRect(); return r.height >= 44 && r.width >= 44; }),
        loginBottom: document.querySelector('[type="submit"]').getBoundingClientRect().bottom,
        background: getComputedStyle(document.body).backgroundColor,
        emailDir: getComputedStyle(document.querySelector('[name="email"]')).direction,
        font: getComputedStyle(document.querySelector('[name="email"]')).fontSize,
      };
    });
    check(`${width}: RTL without horizontal overflow`, geometry.rtl && !geometry.overflow);
    check(`${width}: touch targets at least 44px`, geometry.targets);
    check(`${width}: login fits the reference height`, geometry.loginBottom <= 844);
    check(`${width}: flat approved background`, geometry.background === 'rgb(247, 248, 246)');
    check(`${width}: email LTR and 16px input text`, geometry.emailDir === 'ltr' && geometry.font === '16px');
    check(`${width}: accessible labels and autocomplete`,
      await page.getByLabel(AUTH.email, { exact: true }).getAttribute('autocomplete') === 'email' &&
      await page.getByLabel(AUTH.password, { exact: true }).getAttribute('autocomplete') === 'current-password');
    check(`${width}: one Google method and no owner controls`,
      await page.locator('a[href="/auth/google"]').count() === 1 &&
      await page.locator('.owner-controls, #owner-products, #account-settings').count() === 0);
    await page.screenshot({ path: join(out, `login-${width}.png`), fullPage: true });

    const password = page.getByLabel(AUTH.password, { exact: true });
    await password.fill('Local-test-123');
    const reveal = page.getByRole('button', { name: VISITOR.showPassword });
    await reveal.click();
    check(`${width}: reveal keeps value and exposes state`,
      await password.getAttribute('type') === 'text' && await password.inputValue() === 'Local-test-123' &&
      await reveal.getAttribute('aria-pressed') === 'true');
    await reveal.click();
    check(`${width}: password can be hidden again`, await password.getAttribute('type') === 'password');

    // Resize to the space left by a keyboard; no fixed footer or locked
    // body can prevent reaching the focused field and submit control.
    await page.setViewportSize({ width, height: 400 });
    await password.focus();
    await password.scrollIntoViewIfNeeded();
    check(`${width}: focused field reachable with keyboard-sized viewport`, await password.evaluate(el => {
      const r = el.getBoundingClientRect();
      return document.activeElement === el && r.top >= 0 && r.bottom <= innerHeight &&
        getComputedStyle(el).outlineStyle !== 'none';
    }));
    await page.locator('[type="submit"]').scrollIntoViewIfNeeded();
    check(`${width}: submit reachable by natural scroll`, await page.locator('[type="submit"]').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight));
    check(`${width}: no browser JavaScript errors`, errors.length === 0);
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(APP + '/login?next=%2Fsaved');
  check('deep link survives Google and password form',
    await page.locator('.login__google').getAttribute('href') === '/auth/google?next=%2Fsaved' &&
    await page.locator('[name="next"]').inputValue() === '/saved');
  const google = await ctx.request.get(APP + '/auth/google?next=%2Fsaved', { maxRedirects: 0 });
  const googleLocation = new URL(google.headers().location);
  check('existing Google route starts OAuth with its return target', google.status() === 303 &&
    googleLocation.pathname === '/auth/v1/authorize' && googleLocation.searchParams.get('provider') === 'google' &&
    new URL(googleLocation.searchParams.get('redirect_to')).searchParams.get('next') === '/saved');
  await page.keyboard.press('Tab');
  check('Back is the first keyboard target with a visible focus ring', await page.locator('.login__back').evaluate(el =>
    document.activeElement === el && getComputedStyle(el).outlineStyle !== 'none'));
  await page.locator('.login__back').click();
  check('Back returns to browsing', new URL(page.url()).pathname === '/');
  await page.goto(APP + '/login');
  await page.locator('.login__forgot').click();
  check('forgot password retains the existing recovery form',
    new URL(page.url()).pathname === '/forgot' && await page.locator('form[action="/forgot"]').count() === 1);

  await page.route(APP + '/__test/login-error', route => route.fulfill({ contentType: 'text/html', body: layout({
    title: AUTH.loginTitle, description: '', scripts: [],
    body: loginPage({ error: AUTH.errCredentials, email: 'seller@example.test', next: '/saved' }),
  }) }));
  await page.goto(APP + '/__test/login-error');
  check('error retains the email and return target, never the password',
    await page.locator('.alert--error').innerText() === AUTH.errCredentials &&
    await page.getByLabel(AUTH.email, { exact: true }).inputValue() === 'seller@example.test' &&
    await page.locator('[name="next"]').inputValue() === '/saved' &&
    await page.getByLabel(AUTH.password, { exact: true }).inputValue() === '');
  check('error is announced as an alert', await page.getByRole('alert').count() === 1);
  await page.screenshot({ path: join(out, 'login-error.png'), fullPage: true });
  const hostile = loginPage({ email: '\"><img src=x onerror=alert(1)>', error: '<script>bad()</script>' });
  check('error and submitted email remain escaped', !hostile.includes('<img src=x') && !hostile.includes('<script>bad()'));
  await ctx.close();

  // Real native POST against the local stub, with JavaScript disabled.
  const basic = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const plain = await basic.newPage();
  await plain.goto(APP + '/login?next=%2Fsaved');
  check('no-JS password control stays hidden', await plain.locator('.login__reveal').isHidden());
  await plain.getByLabel(AUTH.email, { exact: true }).fill('s@x.test');
  await plain.getByLabel(AUTH.password, { exact: true }).fill('Local-test-123');
  await Promise.all([plain.waitForURL(APP + '/saved'), plain.getByRole('button', { name: AUTH.loginBtn, exact: true }).click()]);
  check('native login POST preserves next without JavaScript', new URL(plain.url()).pathname === '/saved');
  await basic.close();

  const seller = await browser.newContext({ javaScriptEnabled: false });
  const account = await seller.newPage();
  await account.goto(APP + '/app');
  await account.getByLabel(AUTH.email, { exact: true }).fill('s@x.test');
  await account.getByLabel(AUTH.password, { exact: true }).fill('Local-test-123');
  await Promise.all([
    account.waitForResponse(response => new URL(response.url()).pathname === '/login' && response.request().method() === 'POST'),
    account.getByRole('button', { name: AUTH.loginBtn, exact: true }).click(),
  ]);
  await account.locator('.owner-controls').waitFor();
  check('Account login returns the seller to the existing owner view',
    new URL(account.url()).pathname === '/app' && await account.locator('.login').count() === 0);
  await seller.close();
} finally {
  await browser.close();
}
console.log(`all ${checks} passed; screenshots: ${out}`);
