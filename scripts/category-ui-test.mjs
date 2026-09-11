/**
 * Shop Web — the two screens where a seller touches categories.
 *
 * Both are browser behaviour, so both are tested in a browser against
 * the real Worker: the assertions are about what survives an action,
 * which no amount of HTML checking can see.
 *
 *  - Add Product: creating a category must not navigate. The title, the
 *    price, the description and the prepared images have to still be
 *    there afterwards, and the new category has to come back selected.
 *    On failure the form stays put and one line says why.
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
const CAT_NEW = 'dddddddd-3333-4333-8333-333333333333';

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
   Add Product — a new category without losing the form
   ============================================================ */

{
  const { ctx, page, navigations } = await open(NEW_PRODUCT);
  const before = navigations.length;

  // Fill the form the way a seller would before noticing they need a
  // section. This is exactly the state the old link threw away.
  await page.fill('#f-title', 'کراسی کوردی');
  await page.fill('#f-price', '25000');
  await page.fill('#f-description', 'وەسفێکی کورت');

  // Stand in for a prepared image: the hidden field is what the publish
  // actually reads, and it is what a page reload would clear.
  await page.evaluate(() => {
    document.getElementById('images-field').value = '[{"card":"x","full":"y"}]';
  });

  check('the old manage link is gone', await page.locator('.category-manage').count(), 0);
  check('there is an inline opener instead',
        await page.locator('#category-add-open').count(), 1);
  check('the inline form starts hidden',
        await page.locator('#category-add-form').isHidden(), true);

  await page.click('#category-add-open');
  check('tapping it opens the input', await page.locator('#category-add-form').isVisible(), true);
  check('and focuses it',
        await page.evaluate(() => document.activeElement.id), 'category-add-name');

  await page.fill('#category-add-name', 'شەڵ');
  await page.click('#category-add-save');
  await page.waitForFunction(() => document.getElementById('f-own-category').value !== '');

  check('the new category is selected',
        await page.inputValue('#f-own-category'), CAT_NEW);
  check('by name, in the list',
        await page.locator(`#f-own-category option[value="${CAT_NEW}"]`).textContent(), 'شەڵ');
  check('the inline form closes again',
        await page.locator('#category-add-form').isHidden(), true);

  check('the page never navigated', navigations.length, before);
  check('the title survived', await page.inputValue('#f-title'), 'کراسی کوردی');
  check('the price survived', await page.inputValue('#f-price'), '25,000');
  check('the description survived', await page.inputValue('#f-description'), 'وەسفێکی کورت');
  check('the prepared images survived',
        await page.inputValue('#images-field'), '[{"card":"x","full":"y"}]');

  /* Enter must create the category, not publish a half-typed product. */
  await page.click('#category-add-open');
  await page.fill('#category-add-name', 'پێڵاو');
  await page.press('#category-add-name', 'Enter');
  await page.waitForTimeout(300);
  check('Enter does not submit the product form', navigations.length, before);
  check('Enter created the category instead',
        await page.locator('#category-add-form').isHidden(), true);

  /* A failure keeps everything and says so in one line. */
  await ctx.route('**/api/categories', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await page.click('#category-add-open');
  await page.fill('#category-add-name', 'شتێک');
  await page.click('#category-add-save');
  await page.waitForSelector('#category-add-error:not([hidden])');

  check('a failure shows a local error',
        (await page.locator('#category-add-error').textContent()).length > 0, true);
  check('a failure does not navigate', navigations.length, before);
  check('a failure keeps the title', await page.inputValue('#f-title'), 'کراسی کوردی');
  check('a failure keeps the images',
        await page.inputValue('#images-field'), '[{"card":"x","full":"y"}]');
  check('a failure keeps what was typed',
        await page.inputValue('#category-add-name'), 'شتێک');

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
