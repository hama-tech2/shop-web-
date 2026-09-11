/**
 * Shop Web — the numbers that exist in two places.
 *
 * Prices and the trial product limit are each written twice: once in
 * the database, where they are enforced, and once in worker/config.js,
 * where they are shown to a seller. Nothing at runtime makes the two
 * agree, and the failure is the worst kind — a seller is shown one
 * number and charged another, or told they have slots left and then
 * refused.
 *
 * So the migration is the source of truth and this reads it. Editing
 * app.plan_price or app.trial_product_limit without editing config.js
 * fails here, in the same commit, before it reaches anybody.
 *
 *   node scripts/plan-limits-test.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { FREE_IMAGE_LIMIT, FREE_PRODUCT_LIMIT, PLANS, WAYL } from '../worker/config.js';

const DIR = new URL('../supabase/migrations/', import.meta.url);

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

/** Every migration, newest last: a later one may redefine a function. */
const sql = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(new URL(f, DIR), 'utf8'))
  .join('\n');

/* ---------- prices ---------- */

/**
 * The last definition of app.plan_price wins, the same way it does in
 * the database when the migrations are replayed in order.
 */
function planPriceFromSql() {
  // Anchored on the definition, not on any mention: `comment on
  // function app.plan_price` also contains the name, and matching that
  // ran on into the next function's body and found no prices at all.
  const bodies = [...sql.matchAll(
    /create\s+or\s+replace\s+function\s+app\.plan_price\b[\s\S]*?\$\$([\s\S]*?)\$\$/g,
  )];
  if (!bodies.length) return null;
  const body = bodies[bodies.length - 1][1];
  const prices = {};
  for (const [, key, amount] of body.matchAll(/when\s+'(\w+)'\s+then\s+(\d+)/g)) {
    prices[key] = Number(amount);
  }
  return prices;
}

const dbPrices = planPriceFromSql();
check('app.plan_price is defined in a migration', dbPrices !== null, true);

const configPrices = Object.fromEntries(PLANS.map((p) => [p.key, p.amount]));
check('the database prices the same plans as the app',
      Object.keys(dbPrices ?? {}).sort(), Object.keys(configPrices).sort());

for (const key of Object.keys(configPrices)) {
  check(`${key}: the seller is shown what the database charges`,
        configPrices[key], dbPrices?.[key]);
}

/* ---------- what the Free plan allows ---------- */

/**
 * Both numbers are written twice: once in the database, where they
 * refuse the write, and once in config.js, where they are shown to a
 * seller. A seller told five and refused at four is the failure this
 * prevents.
 */
function scalarFunctionFromSql(schema, name) {
  const bodies = [...sql.matchAll(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${schema}\\.${name}\\b[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, 'g'))];
  if (!bodies.length) return null;
  const m = bodies[bodies.length - 1][1].match(/select\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

check('app.free_product_limit is defined in a migration',
      scalarFunctionFromSql('app', 'free_product_limit') !== null, true);
check('the product limit the app shows is the one the database enforces',
      FREE_PRODUCT_LIMIT, scalarFunctionFromSql('app', 'free_product_limit'));

check('app.free_image_limit is defined in a migration',
      scalarFunctionFromSql('app', 'free_image_limit') !== null, true);
check('the image limit the app shows is the one the database enforces',
      FREE_IMAGE_LIMIT, scalarFunctionFromSql('app', 'free_image_limit'));

/* ---------- and the trial is gone from both ---------- */

/**
 * The trial is retired, and a migration must be what retires it: a
 * function left behind in the database still has its grants, and
 * start_trial could still be called by anything holding a token.
 */
const dropsAt = sql.lastIndexOf('drop function if exists app.trial_days');
check('a migration drops app.trial_days', dropsAt >= 0, true);
check('and nothing defines it again afterwards',
      /create\s+or\s+replace\s+function\s+app\.trial_days\b/.test(sql.slice(dropsAt)),
      false);
check('public.start_trial is dropped too',
      /drop function if exists public\.start_trial/.test(sql), true);

/* ---------- how long a checkout can be reused ---------- */

/**
 * wayl_start_intent hands back a checkout a seller already has rather
 * than making a second one, for as long as this window. Wayl's links
 * live an hour, so the window has to stay well inside that or a reused
 * link could lapse under the seller's thumb.
 */
function reuseMinutesFromSql() {
  const bodies = [...sql.matchAll(
    /create\s+or\s+replace\s+function\s+public\.wayl_start_intent\b[\s\S]*?\$\$([\s\S]*?)\$\$/g,
  )];
  if (!bodies.length) return null;
  // v_live is the checkout the seller already has. The other interval
  // in this function is the per-shop rate limit, which is not this.
  const m = bodies[bodies.length - 1][1].match(/v_live\.created_at\s*>\s*now\(\)\s*-\s*interval\s*'(\d+)\s*minutes'/);
  return m ? Number(m[1]) : null;
}

check('wayl_start_intent has a reuse window', reuseMinutesFromSql() !== null, true);
check('the reuse window the app documents is the one the database applies',
      WAYL.reuseMinutes, reuseMinutesFromSql());
check('and it is well inside the hour a Wayl link lives',
      WAYL.reuseMinutes < 60, true);

/* ---------- the image limit, for the same reason ---------- */

const positionCheck = [...sql.matchAll(
  /constraint\s+product_images_position_check[\s\S]*?position\s*<=\s*(\d+)/g,
)];
check('product_images allows at most as many positions as MAX_IMAGES',
      Number(positionCheck[positionCheck.length - 1]?.[1]), 5);

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
