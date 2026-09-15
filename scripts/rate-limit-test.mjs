/**
 * Shop Web — the Worker half of the signup throttle.
 *
 * The database half is scripts/rate-limit-db-test.sql, and the race is
 * scripts/rate-limit-race-test.sh. What is pinned here is the part the
 * database cannot see: which header the key is built from, that the
 * secret is required, that no address ever leaves the Worker, and that
 * every way the limiter can break ends in a refusal rather than a
 * shrug.
 *
 *   node scripts/rate-limit-test.mjs
 */

import { clientRateKey, rateLimitAllows } from '../worker/supabase.js';
import { AUTH, ONBOARDING } from '../worker/config.js';

const results = [];
const check = (name, got, want = true) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const SALT = 'a-real-secret-salt';
const req = (headers) => new Request('https://bazarnow.xyz/signup', { headers });

/* ============================================================
   1. the key
   ============================================================ */

const key = await clientRateKey(req({ 'cf-connecting-ip': '5.5.5.5' }), { VIEW_SALT: SALT });
check('a key is produced from cf-connecting-ip', /^[0-9a-f]{64}$/.test(key || ''));

const same = await clientRateKey(req({ 'cf-connecting-ip': '5.5.5.5' }), { VIEW_SALT: SALT });
check('the same address gives the same key', key, same);

const other = await clientRateKey(req({ 'cf-connecting-ip': '5.5.5.6' }), { VIEW_SALT: SALT });
check('a different address gives a different key', other !== key);

// The whole point of hashing: what goes to the database identifies a
// caller without identifying a person.
check('the address is not in the key', key.includes('5.5.5.5'), false);
check('the address is not in the key in any encoding',
  [Buffer.from('5.5.5.5').toString('hex'), Buffer.from('5.5.5.5').toString('base64')]
    .some((s) => key.includes(s)), false);

// A different salt must give a different key, or the salt is doing
// nothing and anyone could compute another address's key.
const salted = await clientRateKey(req({ 'cf-connecting-ip': '5.5.5.5' }), { VIEW_SALT: 'other' });
check('the salt changes the key', salted !== key);

/* ============================================================
   2. VIEW_SALT is required
   ============================================================ */

for (const [label, env] of [
  ['missing', {}],
  ['empty', { VIEW_SALT: '' }],
  ['undefined', { VIEW_SALT: undefined }],
  // The old viewToken() falls back to SUPABASE_URL, which is printed in
  // the page source. For a security control that is no salt at all, so
  // this must NOT be accepted as one.
  ['only SUPABASE_URL', { SUPABASE_URL: 'https://project.supabase.co' }],
]) {
  check(`no key when VIEW_SALT is ${label}`,
    await clientRateKey(req({ 'cf-connecting-ip': '5.5.5.5' }), env), null);
}

/* ============================================================
   3. only the header Cloudflare sets
   ============================================================ */

// x-forwarded-for is set by the caller. Accepting it would let an
// attacker mint a fresh allowance per request by changing one header.
check('x-forwarded-for alone produces no key',
  await clientRateKey(req({ 'x-forwarded-for': '9.9.9.9' }), { VIEW_SALT: SALT }), null);

const spoofed = await clientRateKey(
  req({ 'cf-connecting-ip': '5.5.5.5', 'x-forwarded-for': '9.9.9.9' }), { VIEW_SALT: SALT });
check('a forged x-forwarded-for cannot change the key', spoofed, key);

check('no headers at all produce no key',
  await clientRateKey(req({}), { VIEW_SALT: SALT }), null);

/* ============================================================
   4. the limiter fails closed
   ============================================================ */

check('no key is a refusal',
  await rateLimitAllows({ SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_URL: 'x' },
    'rate_limit_signup', null), false);

check('no service key is a refusal',
  await rateLimitAllows({ SUPABASE_URL: 'x' }, 'rate_limit_signup', key), false);

// An unreachable database must refuse, not wave the caller through: the
// moment a limiter is most likely to be broken is the moment somebody
// is hammering it.
check('an unreachable database is a refusal',
  await rateLimitAllows(
    { SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_URL: 'http://127.0.0.1:1' },
    'rate_limit_signup', key), false);

/* ---------- and what it does when the database answers ---------- */

const realFetch = globalThis.fetch;
let seen = null;
const withReply = async (status, body) => {
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  };
  const out = await rateLimitAllows(
    { SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_URL: 'https://db.test' },
    'rate_limit_signup', key);
  globalThis.fetch = realFetch;
  return out;
};

check('true from the database allows', await withReply(200, true), true);
check('the call went to the right function',
  seen.url, 'https://db.test/rest/v1/rpc/rate_limit_signup');
check('the key is what was sent, and only the key',
  JSON.parse(seen.init.body), { p_key: key });
check('no address is sent to the database', seen.init.body.includes('5.5.5.5'), false);
check('the service key authorises the call',
  seen.init.headers.authorization, 'Bearer service-key');

check('false from the database refuses', await withReply(200, false), false);
check('a non-boolean answer refuses', await withReply(200, 'yes'), false);
check('null refuses', await withReply(200, null), false);
check('an error status refuses', await withReply(500, true), false);
check('a 403 refuses', await withReply(403, true), false);

/* ============================================================
   5. both flows have something to say
   ============================================================ */

check('signup has a refusal message', typeof AUTH.errTooMany === 'string' && AUTH.errTooMany.length > 10);
check('onboarding has one too',
  typeof ONBOARDING.errTooMany === 'string' && ONBOARDING.errTooMany.length > 10);
// The seller must not be told which of "too many" and "the limiter is
// broken" happened — one is a fact about them, the other is a fact
// about us, and only the first is any of their business.
check('the two say the same thing', AUTH.errTooMany, ONBOARDING.errTooMany);

/* ============================================================
   6. the routes actually call it
   ============================================================ */

const { readFileSync } = await import('node:fs');
const auth = readFileSync(new URL('../worker/routes/auth.js', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../worker/routes/onboarding.js', import.meta.url), 'utf8');

const signupBody = auth.slice(auth.indexOf('export async function signupPost'),
                              auth.indexOf('export async function', auth.indexOf('export async function signupPost') + 10));
check('signup checks the limit', signupBody.includes('rate_limit_signup'));
// Before Supabase is touched, or the account exists and the limit is a
// decoration on top of it.
check('signup checks it before creating the account',
  signupBody.indexOf('rate_limit_signup') < signupBody.indexOf('signUp(env'));

const shopBody = onboarding.slice(onboarding.indexOf('export async function contactPost'),
                                  onboarding.indexOf('/* ---------- step 4'));
check('shop creation checks the limit', shopBody.includes('rate_limit_shop'));
check('shop creation checks it before the insert',
  shopBody.indexOf('rate_limit_shop') < shopBody.indexOf("'shops'"));

/* ---------- report ---------- */

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass) console.log(`FAIL ${r.name}\n  got  ${JSON.stringify(r.got)}\n  want ${JSON.stringify(r.want)}`);
}
console.log(failed.length
  ? `${failed.length} of ${results.length} FAILED`
  : `all ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
