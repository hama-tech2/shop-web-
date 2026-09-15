/**
 * Shop Web — how a customer and a shopkeeper each get in.
 *
 * The product rule these pin: a customer needs no account. Browsing is
 * free and ordering happens on WhatsApp. An account is for the other
 * kind of visitor, the one with something to sell. Every screen a
 * visitor can reach before signing in has to say that, or it says the
 * opposite by omission — which is what the Account tab used to do by
 * redirecting a shopper straight into a login form.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/entry-points-test.mjs
 */

import { UI, VISITOR, AUTH } from '../worker/config.js';

const APP = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8810';

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const get = (path, headers) =>
  fetch(`${APP}${path}`, { redirect: 'manual', headers: headers || {} });
const html = async (path, headers) => (await get(path, headers)).text();

/* ============================================================
   1. the feed: one line for shopkeepers, and nothing else
   ============================================================ */

const feed = await html('/');

check('the feed carries the seller prompt', feed.includes('seller-prompt'));
check('it asks the question in Sorani', feed.includes(UI.sellerPrompt));
check('and offers the short action', feed.includes(UI.sellerCta));
check('which goes to signup',
  /<a[^>]*class="seller-prompt__cta"[^>]*href="\/signup"/.test(feed));

// Small: one row, one sentence, one link. If this ever grows a heading,
// an image or a second button it has stopped being a line and become a
// banner, which is the thing that was asked not to be built.
const block = feed.slice(feed.indexOf('<aside class="seller-prompt"'),
                         feed.indexOf('</aside>') + 8);
check('it is one <aside>, not a section with a heading',
  /<h[1-6]/.test(block), false);
check('it holds exactly one link', (block.match(/<a\s/g) || []).length, 1);
check('and no image', /<img|<svg/.test(block), false);
check('and no close button', /<button/.test(block), false);

// Not an advert: nothing moves, nothing is fixed over the products,
// nothing reappears on a timer.
check('it is not fixed or sticky over the feed',
  /position:\s*(fixed|sticky)/.test(block), false);
check('it does not animate', /animation|transition|@keyframes/.test(block), false);
check('and carries no script of its own', /<script/.test(block), false);

// It sits after the category chips and before the grid: under the tools
// a customer came for, above the products, covering neither.
check('it comes after the search and chips',
  feed.indexOf('seller-prompt') > feed.indexOf('class="chips"'));
check('and before the first product card',
  feed.indexOf('seller-prompt') < feed.indexOf('id="grid"'));

// Somebody who has typed a search or picked a category is looking for a
// thing. That is the worst moment to talk to them about something else.
check('it is absent once a category is chosen',
  (await html('/?category=food')).includes('seller-prompt'), false);
check('and absent during a search',
  (await html('/?q=abc')).includes('seller-prompt'), false);

/* ============================================================
   2. the Account tab, signed out
   ============================================================ */

const tab = await get('/app');
check('the Account tab renders rather than redirecting', tab.status, 200);

const visitor = await tab.text();

// Said first, and plainly. This is the sentence the whole screen exists
// for: nothing here is a wall.
check('it says an account is not needed to browse or buy',
  visitor.includes(VISITOR.noAccountNeeded));
check('and offers a way straight back to the products',
  /class="login__back" href="\/"/.test(visitor) && visitor.includes(VISITOR.back));

// Approved login mockup: explain both roles, then offer Google and the
// existing password form directly. The old signup card is retired.
check('it explains the business case', visitor.includes(VISITOR.sellerBody));
check('the customer explanation precedes sign-in',
  visitor.indexOf(VISITOR.noAccountNeeded) < visitor.indexOf('/auth/google'));
check('Google is immediately available', visitor.includes('href="/auth/google"'));
check('Google precedes the email form', visitor.indexOf('/auth/google') < visitor.indexOf('<form'));
check('password login posts directly to the existing endpoint',
  /<form method="post" action="\/login">/.test(visitor));
check('no separate registration panel', /visitor__seller|visitor__cta/.test(visitor), false);
check('no owner controls leak to a visitor',
  /owner-controls|owner-products|account-settings/.test(visitor), false);

// Nothing about this screen is a nag.
check('no popup or dialog', /role="dialog"|<dialog/.test(visitor), false);
check('the visitor page is never cached', tab.headers.get('cache-control'), 'no-store');

// The approved standalone screen uses its small Back action to leave.
check('no fixed bottom navigation crowds the login form', visitor.includes('class="nav"'), false);

/* ---------- deeper seller pages are still login-gated ---------- */

// Only /app itself explains. Anywhere a shopkeeper actually works is
// seller-only, and still sends a stranger to log in with the
// destination remembered.
for (const path of ['/app/new', '/app/profile', '/app/subscription']) {
  const res = await get(path);
  check(`${path} still redirects a stranger`, [302, 303, 307].includes(res.status), true);
  const to = res.headers.get('location') || '';
  check(`${path} sends them to log in`, to.startsWith('/login'), true);
  check(`${path} remembers a seller destination`, /next=/.test(to), true);
}

// /app/products is not in that list any more: it is a retired address
// that redirects to /app for everybody, signed in or not, and /app does
// the gating. scripts/manager-retired-test.mjs pins it in full.
const retired = await get('/app/products');
check('/app/products is retired, not gated',
  retired.headers.get('location'), '/app');

// Where each one remembers, exactly. /app/new points at /app rather
// than at itself: every route in worker/routes/products.js shares one
// guard, and that guard names the seller's home — which is now where
// publishing, editing and deleting all end up anyway.
const remembered = {};
for (const path of ['/app/new', '/app/profile', '/app/subscription']) {
  const to = (await get(path)).headers.get('location') || '';
  remembered[path] = decodeURIComponent(to.split('next=')[1] || '');
}
check('add-product shares the products guard, which names /app',
  remembered['/app/new'], '/app');
check('the profile remembers itself', remembered['/app/profile'], '/app/profile');
check('the plan screen remembers itself',
  remembered['/app/subscription'], '/app/subscription');

/* ============================================================
   3. login and signup
   ============================================================ */

for (const [name, path] of [['signup', '/signup'], ['login', '/login']]) {
  const page = await html(path);
  const google = page.indexOf('/auth/google');
  const form = page.indexOf('<form');

  check(`${name}: Google is offered`, google > -1);
  check(`${name}: Google comes before the email form`, google > -1 && google < form);
  check(`${name}: Google is one compact control`,
    (page.match(/\/auth\/google/g) || []).length, 1);

  // Nothing was removed. Both methods still work, email simply sits
  // under the faster one instead of above it.
  check(`${name}: email is still there`, /name="email"/.test(page));
  check(`${name}: password is still there`, /name="password"/.test(page));
  check(`${name}: the form still posts to ${path}`,
    new RegExp(`<form[^>]*action="${path}"`).test(page));
  check(`${name}: the divider separates the two`, page.includes(AUTH.or));
}

// Signup keeps its existing route and login link. The approved login
// screen omits the registration CTA; the home seller prompt still links it.
check('signup offers a way to log in', (await html('/signup')).includes('/login'));
check('login has no extra signup CTA', (await html('/login')).includes('href="/signup'), false);

// A deep link survives a detour through either screen.
const deep = await html('/login?next=%2Fapp%2Fproducts');
check('login carries a next through to Google',
  deep.includes('/auth/google?next=%2Fapp%2Fproducts'));
check('and through the email form',
  /name="next"[^>]*value="\/app\/products"/.test(deep));

/* ---------- report ---------- */

let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(
    `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}` +
    (r.pass ? '' : `\n        got  ${JSON.stringify(r.got)}\n        want ${JSON.stringify(r.want)}`),
  );
}
console.log(failed ? `\n${failed} of ${results.length} FAILED` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
