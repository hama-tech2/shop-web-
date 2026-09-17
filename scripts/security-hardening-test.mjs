#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyTooLarge, uploadRateAllows } from '../worker/abuse.js';
import { sendRecovery, signInPassword, signUp } from '../worker/auth.js';
import { cleanOrphanShopImages } from '../worker/cron.js';
import worker, { harden } from '../worker/index.js';
import { loginPost, resetGet, resetPost } from '../worker/routes/auth.js';

let checks = 0;
const check = (name, value) => {
  assert.ok(value, name);
  checks += 1;
  console.log(`PASS ${name}`);
};

const originalFetch = globalThis.fetch;

// Supabase's native CAPTCHA field is present on every protected Auth call.
for (const [name, invoke] of [
  ['signup', () => signUp({ SUPABASE_URL: 'https://db.test', SUPABASE_PUBLISHABLE_KEY: 'public' }, 'a@b.co', '12345678', 'captcha-ok')],
  ['password login', () => signInPassword({ SUPABASE_URL: 'https://db.test', SUPABASE_PUBLISHABLE_KEY: 'public' }, 'a@b.co', '12345678', 'captcha-ok')],
  ['password recovery', () => sendRecovery({ SUPABASE_URL: 'https://db.test', SUPABASE_PUBLISHABLE_KEY: 'public' }, 'a@b.co', 'challenge', 'https://bazarnow.xyz/auth/callback', 'captcha-ok')],
]) {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return Response.json({ error: 'expected test refusal' }, { status: 400 });
  };
  await invoke();
  const sent = JSON.parse(seen.init.body);
  check(`${name} sends CAPTCHA in GoTrue security metadata`,
    sent.gotrue_meta_security?.captcha_token === 'captcha-ok');
  check(`${name} does not send a Turnstile secret`,
    !('secret' in sent) && !JSON.stringify(sent).includes('TURNSTILE_SECRET'));
}

// A missing token or missing public site key is rejected before Auth is called.
for (const [name, env] of [
  ['missing token', { TURNSTILE_SITE_KEY: 'site-key' }],
  ['missing site key', {}],
]) {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not call upstream'); };
  const body = new URLSearchParams({ email: 'seller@example.com', password: '12345678' });
  const response = await loginPost(new Request('https://bazarnow.xyz/login', {
    method: 'POST', headers: { origin: 'https://bazarnow.xyz' }, body,
  }), env);
  check(`${name} fails safely`, response.status === 200 && calls === 0);
}

globalThis.fetch = originalFetch;

// An expired recovery session renders a complete login form, including
// the CAPTCHA needed for the very first replacement login attempt.
for (const [name, response] of [
  ['GET', await resetGet(new Request('https://bazarnow.xyz/reset'), {
    TURNSTILE_SITE_KEY: 'reset-site-key',
  })],
  ['POST', await resetPost(new Request('https://bazarnow.xyz/reset', {
    method: 'POST', headers: { origin: 'https://bazarnow.xyz' },
  }), { TURNSTILE_SITE_KEY: 'reset-site-key' })],
]) {
  const body = await response.text();
  check(`expired reset ${name} includes a usable login CAPTCHA`,
    body.includes('action="/login"') && body.includes('data-sitekey="reset-site-key"'));
}

// Request-size checks reject a known oversized body before multipart parsing.
check('oversized request is detected', bodyTooLarge(new Request('https://x.test', {
  headers: { 'content-length': '9000' },
}), 8000));
check('normal request size remains allowed', !bodyTooLarge(new Request('https://x.test', {
  headers: { 'content-length': '7000' },
}), 8000));

// Upload limiting is keyed only from the authenticated shop supplied by the route.
let limiterCall;
check('upload limiter allows a legitimate request', await uploadRateAllows({}, 'shop-1',
  async (env, rpc, key) => { limiterCall = { rpc, key }; return true; }));
check('upload limiter calls the dedicated RPC',
  limiterCall.rpc === 'rate_limit_upload' && limiterCall.key === 'shop-1');
check('upload limiter fails closed when its dependency fails', !(await uploadRateAllows({}, 'shop-1',
  async () => false)));
check('upload limiter fails closed without a trusted shop', !(await uploadRateAllows({}, '',
  async () => true)));

// A cancelled profile crop no longer leaves a permanent R2 object.
{
  const old = new Date(Date.now() - (25 * 60 * 60 * 1000));
  const recent = new Date();
  const deleted = [];
  globalThis.fetch = async (url) => {
    check('orphan cleanup reads only shop image references',
      String(url).includes('/rest/v1/shops?') && String(url).includes('select=logo_key%2Ccover_key'));
    return Response.json([{ logo_key: 'shops/s1/live.webp', cover_key: null }]);
  };
  const result = await cleanOrphanShopImages({
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    IMAGES: {
      list: async () => ({ truncated: false, objects: [
        { key: 'shops/s1/live.webp', uploaded: old },
        { key: 'shops/s1/abandoned.webp', uploaded: old },
        { key: 'shops/s1/open-form.webp', uploaded: recent },
      ] }),
      delete: async (key) => { deleted.push(key); },
    },
  });
  check('only an old unreferenced shop upload is deleted',
    JSON.stringify(deleted) === JSON.stringify(['shops/s1/abandoned.webp']));
  check('shop cleanup reports what it checked and deleted',
    result.checked === 2 && result.deleted === 1);
  globalThis.fetch = originalFetch;
}

// Production response hardening.
const secured = harden(new Response('<h1>ok</h1>', {
  headers: { 'content-type': 'text/html; charset=utf-8' },
}));
for (const header of [
  'content-security-policy', 'strict-transport-security', 'x-content-type-options',
  'referrer-policy', 'x-frame-options', 'permissions-policy',
]) check(`security header: ${header}`, Boolean(secured.headers.get(header)));
const csp = secured.headers.get('content-security-policy');
check('CSP blocks framing and objects', csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"));
check('CSP allows only the Turnstile external script',
  csp.includes('https://challenges.cloudflare.com') && !csp.includes("'unsafe-inline'"));
check('CSP leaves the server-approved hosted checkout redirect available',
  !csp.includes('form-action'));
const cookieHeaders = new Headers();
cookieHeaders.append('set-cookie', 'a=1; HttpOnly; Secure');
cookieHeaders.append('set-cookie', 'b=2; HttpOnly; Secure');
const cookieResponse = harden(new Response(null, { headers: cookieHeaders }));
check('response hardening preserves both session cookies',
  cookieResponse.headers.getSetCookie().length === 2);

// Unexpected internal errors are logged server-side but never returned to visitors.
let logged = '';
const oldError = console.error;
console.error = (...parts) => { logged = parts.map(String).join(' '); };
const failure = await worker.fetch(new Request('https://bazarnow.xyz/definitely-missing'), {
  ASSETS: { fetch: async () => { throw new Error('postgres password=secret-stack-detail'); } },
}, {});
console.error = oldError;
const publicBody = await failure.text();
check('unexpected failure returns a generic 500', failure.status === 500);
check('raw internal error is absent from the response',
  !publicBody.includes('postgres') && !publicBody.includes('secret-stack-detail'));
check('server log retains a diagnostic', logged.includes('request failed'));

// CSP compatibility and secret-boundary source checks.
const files = [
  '../worker/render/categories.js', '../worker/render/product-form.js',
  '../worker/render/layout.js', '../public/js/confirm-submit.js',
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
check('no inline event handlers remain', !/\son[a-z]+\s*=/.test(files));
check('destructive confirmations remain present', files.includes('data-confirm') && files.includes('window.confirm'));

const publicSources = [
  '../public/js/app.js', '../public/js/login.js', '../public/js/product.js',
  '../worker/render/layout.js', '../worker/render/auth.js',
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
for (const secretName of ['SUPABASE_SERVICE_ROLE_KEY', 'WAYL_API_TOKEN', 'VIEW_SALT']) {
  check(`${secretName} is absent from public/rendered sources`, !publicSources.includes(secretName));
}

const uploadMigration = readFileSync(new URL(
  '../supabase/migrations/20260923090000_upload_rate_limit.sql', import.meta.url,
), 'utf8');
check('upload limiter RPC is service-role only',
  /revoke all[\s\S]*public, anon, authenticated/.test(uploadMigration) &&
  /grant execute[\s\S]*to service_role/.test(uploadMigration));
check('upload limiter has burst and daily caps',
  uploadMigration.includes("30, interval '1 minute'") &&
  uploadMigration.includes("1500, interval '1 day'"));

const reportsMigration = readFileSync(new URL(
  '../supabase/migrations/20260923091000_disable_direct_public_reports.sql', import.meta.url,
), 'utf8');
check('direct public report inserts are revoked',
  reportsMigration.includes('revoke insert on table public.reports from anon, authenticated'));

globalThis.fetch = originalFetch;
console.log(`\nall ${checks} security-hardening checks passed`);
