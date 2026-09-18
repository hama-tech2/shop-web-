/**
 * Shop Web — category publishing stays simple while the shop category
 * manager remains available on the owner profile.
 *
 *  - Add Product: one optional marketplace category and no shop-category
 *    picker or inline creation controls.
 *  - Owner Profile: "ڕێکخستن" turns the category chips into rename,
 *    delete and add, in place. No long press, no manager page.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/category-ui-test.mjs
 *
 * Needs Chromium; set CHROME to override the path.
 */
import pw from 'playwright-core';
const { chromium } = pw;

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';
const CAT_A = 'dddddddd-1111-4111-8111-111111111111';

// The stub is shared and stateful, and another suite may have left it
// reporting zero affected rows. Say what this one needs.
await fetch(`${STUB}/__rows/1`);
await fetch(`${STUB}/__mode/shop`);

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

async function open(path) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'sb-access', value: 'TEST', url: APP }]);
  const page = await ctx.newPage();
  const navigations = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' });
  return { ctx, page, navigations };
}

// The plan gate stands in front of Add Product for a Free seller, and
// this file is about the category picker rather than the plan. Coming
// through it is what `?plan=free` means; it grants nothing.
const NEW_PRODUCT = '/app/new?plan=free';

/* ============================================================
   Add Product — one optional marketplace category
   ============================================================ */

{
  const { ctx, page } = await open(NEW_PRODUCT);
  check('there is exactly one product category field',
        await page.locator('select[name="category"]').count(), 1);
  check('the product category label is پۆل',
        (await page.locator('label[for="category-field"]').textContent()).trim().startsWith('پۆل'), true);
  check('the product category is marked optional',
        (await page.locator('label[for="category-field"]').textContent()).includes('ئارەزوومەندانە'), true);
  check('there is no shop-category selector',
        await page.locator('[name="own_category"], #f-own-category').count(), 0);
  check('there is no inline shop-category creation UI',
        await page.locator('#category-add-open, #category-add-form').count(), 0);
  check('the old marketplace label is gone',
        (await page.locator('body').textContent()).includes('پۆلی بازاڕ'), false);
  check('the old shop-category label is gone',
        (await page.locator('body').textContent()).includes('پۆلی دوکان'), false);

  await ctx.close();
}

/* ============================================================
   Owner Profile — the chips are the manager
   ============================================================ */

{
  const { ctx, page, navigations } = await open('/app');
  await page.waitForSelector('#category-manage');
  const before = navigations.length;

  check('the rail has a manage control',
        await page.locator('#category-manage').textContent(), 'ڕێکخستن');
  check('nothing links away to a manager page',
        await page.locator('a[href*="/app/profile#shop-categories"]').count(), 0);
  check('the editor starts closed', await page.locator('.cat-edit').isHidden(), true);

  await page.click('#category-manage');
  check('tapping it opens the editor', await page.locator('.cat-edit').isVisible(), true);
  check('one row per category', await page.locator('.cat-edit__row:not(.cat-edit__row--add)').count(), 2);
  check('plus a row to add one', await page.locator('.cat-edit__row--add').count(), 1);
  check('the control now says done',
        await page.locator('#category-manage').textContent(), 'تەواو');

  /* ---- rename ---- */
  const first = page.locator('.cat-edit__row').first();
  await first.locator('.cat-edit__name').fill('کراسی نوێ');
  const renamed = page.waitForResponse((r) =>
    r.url().includes(`/api/categories/${CAT_A}`) && r.request().method() === 'POST');
  await first.locator('.cat-edit__save').click();
  check('rename posts to the category', (await renamed).status(), 200);
  check('rename does not navigate', navigations.length, before);

  /* ---- add ---- */
  await page.locator('.cat-edit__row--add .cat-edit__name').fill('شەڵ');
  const created = page.waitForResponse((r) =>
    r.url().endsWith('/api/categories') && r.request().method() === 'POST');
  await page.locator('.cat-edit__create').click();
  check('add posts to the collection', (await created).status(), 200);
  await page.waitForFunction(() =>
    document.querySelectorAll('.cat-edit__row:not(.cat-edit__row--add)').length === 3);
  check('the new category appears in the editor',
        await page.locator('.cat-edit__row:not(.cat-edit__row--add)').count(), 3);
  check('add does not navigate', navigations.length, before);

  /* ---- delete: confirmed first, and products are never touched ---- */
  let asked = null;
  page.on('dialog', (d) => { asked = d.message(); d.accept(); });

  const deleted = page.waitForResponse((r) => r.url().includes('/delete'));
  await page.locator('.cat-edit__row:not(.cat-edit__row--add)').first()
    .locator('.cat-edit__remove').click();
  check('delete asked first', Boolean(asked), true);
  check('and said the products survive', /بەرهەم/.test(asked || ''), true);
  check('delete posts to the category', (await deleted).status(), 200);
  check('delete does not navigate', navigations.length, before);

  await ctx.close();
}

/* ---- a cancelled delete deletes nothing ---- */
{
  const { ctx, page } = await open('/app');
  await page.waitForSelector('#category-manage');
  await page.click('#category-manage');

  const calls = [];
  page.on('request', (r) => { if (r.url().includes('/delete')) calls.push(r.url()); });
  page.on('dialog', (d) => d.dismiss());

  await page.locator('.cat-edit__row:not(.cat-edit__row--add)').first()
    .locator('.cat-edit__remove').click();
  await page.waitForTimeout(300);
  check('a cancelled delete sends nothing', calls.length, 0);
  check('and the category is still listed',
        await page.locator('.cat-edit__row:not(.cat-edit__row--add)').count(), 2);

  await ctx.close();
}

await browser.close();

/* ============================================================ */

let failed = 0;
for (const x of results) {
  if (!x.pass) failed += 1;
  console.log(
    `${x.pass ? 'PASS' : 'FAIL'}  ${x.name}` +
    (x.pass ? '' : `\n        got  ${JSON.stringify(x.got)}\n        want ${JSON.stringify(x.want)}`),
  );
}
console.log(failed ? `\n${failed} of ${results.length} FAILED` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
