/** Bazaro product visibility switch — browser behavior and mobile layout. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const PRODUCT_ID = 'bbbbbbbb-1111-4111-8111-111111111111';
const out = process.env.BAZARO_SHOTS || join(tmpdir(), 'bazaro-visibility-toggle');
await mkdir(out, { recursive: true });

let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks += 1; };
const control = (path) => fetch(STUB + path).then((response) => response.json());

await control('/__rows/1');
await control('/__mode/shop');
await control('/__plan/year_1');
await control('/__sub/20');
await control('/__products/1');
await control('/__visibility/everyone');

const browser = await chromium.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: 'sb-access', value: 'TEST', url: APP }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(APP + '/app/new', { waitUntil: 'networkidle' });

    const field = page.locator('#visibility-field');
    const toggle = page.locator('#visibility-toggle');
    const track = page.locator('.visibility-switch__track');
    const label = page.locator('.visibility-row__label');
    const hint = page.locator('#visibility-hint');

    check(`${width}: one checkbox switch`,
      await toggle.count() === 1 && await field.locator('input[type="radio"]').count() === 0);
    check(`${width}: default is ON`, await toggle.isChecked());
    check(`${width}: ON is Bazaro green`,
      await track.evaluate((element) => getComputedStyle(element).backgroundColor) === 'rgb(20, 86, 61)');
    check(`${width}: exact label`,
      (await label.textContent()).trim() === 'پیشاندانی لە «بۆ تۆ»');
    check(`${width}: ON helper`,
      (await hint.textContent()).trim() === 'بەرهەمەکە لە «بۆ تۆ» دەردەکەوێت.');
    check(`${width}: label right, toggle left`, await Promise.all([
      label.boundingBox(), page.locator('.visibility-switch').boundingBox(),
    ]).then(([labelBox, switchBox]) => labelBox.x > switchBox.x));
    check(`${width}: compact row and touch target`,
      await field.locator('.visibility-row').evaluate((element) =>
        element.getBoundingClientRect().height >= 48 && element.getBoundingClientRect().height <= 56));
    check(`${width}: no horizontal overflow`,
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    if (width === 390) await field.screenshot({ path: join(out, 'new-on-390.png') });

    await toggle.click();
    await page.waitForFunction(() =>
      getComputedStyle(document.querySelector('.visibility-switch__track')).backgroundColor ===
      'rgb(216, 213, 206)');
    check(`${width}: tap turns it OFF`, !(await toggle.isChecked()));
    check(`${width}: OFF is gray`,
      await track.evaluate((element) => getComputedStyle(element).backgroundColor) === 'rgb(216, 213, 206)');
    check(`${width}: OFF helper`,
      (await hint.textContent()).trim() ===
      'لە «بۆ تۆ» دەرناکەوێت، بەڵام لە گەڕان و پڕۆفایلی دوکان هەر دیارە.');
    check(`${width}: OFF submits profile`,
      JSON.stringify(await page.locator('#product-form').evaluate((form) =>
        new FormData(form).getAll('visibility'))) === '["profile"]');
    if (width === 390) await field.screenshot({ path: join(out, 'new-off-390.png') });

    await toggle.click();
    check(`${width}: ON submits everyone last`,
      JSON.stringify(await page.locator('#product-form').evaluate((form) =>
        new FormData(form).getAll('visibility'))) === '["profile","everyone"]');
  }

  await control('/__visibility/profile');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${APP}/app/products/${PRODUCT_ID}`, { waitUntil: 'networkidle' });
  check('edit form restores profile as OFF', !(await page.locator('#visibility-toggle').isChecked()));
  check('edit form shows the OFF helper',
    (await page.locator('#visibility-hint').textContent()).trim() ===
    'لە «بۆ تۆ» دەرناکەوێت، بەڵام لە گەڕان و پڕۆفایلی دوکان هەر دیارە.');
  await page.locator('#visibility-field').screenshot({ path: join(out, 'edit-off-390.png') });

  check('no browser errors', errors.length === 0);
  await context.close();
} finally {
  await browser.close();
}

console.log(`All ${checks} visibility UI checks passed. Screenshots: ${out}`);
