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
import { PLANS, TRIAL_DAYS, TRIAL_PRODUCT_LIMIT } from '../worker/config.js';

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

/* ---------- the trial product limit ---------- */

function trialLimitFromSql() {
  const bodies = [...sql.matchAll(
    /create\s+or\s+replace\s+function\s+app\.trial_product_limit\b[\s\S]*?\$\$([\s\S]*?)\$\$/g,
  )];
  if (!bodies.length) return null;
  const m = bodies[bodies.length - 1][1].match(/select\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

check('app.trial_product_limit is defined in a migration',
      trialLimitFromSql() !== null, true);
check('the trial limit the app shows is the one the database enforces',
      TRIAL_PRODUCT_LIMIT, trialLimitFromSql());

/* ---------- how long the trial is ---------- */

/**
 * Written twice for the same reason as the limit: the database sets the
 * date, config.js is the number on the button the seller taps. A seller
 * promised 30 days and given 14 is the failure this prevents.
 */
function trialDaysFromSql() {
  const bodies = [...sql.matchAll(
    /create\s+or\s+replace\s+function\s+app\.trial_days\b[\s\S]*?\$\$([\s\S]*?)\$\$/g,
  )];
  if (!bodies.length) return null;
  const m = bodies[bodies.length - 1][1].match(/select\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

check('app.trial_days is defined in a migration', trialDaysFromSql() !== null, true);
check('the free month the app offers is the one the database grants',
      TRIAL_DAYS, trialDaysFromSql());

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
