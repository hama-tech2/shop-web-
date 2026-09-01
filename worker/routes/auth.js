/**
 * Auth routes. Every one of them renders on the server; the browser
 * only ever posts a form or follows a redirect.
 */

import { APP_NAME, AUTH } from '../config.js';
import { layout } from '../render/layout.js';
import { forgotPage, loginPage, resetPage, signupPage } from '../render/auth.js';
import {
  challengeFor, clearSessionCookies, clearVerifierCookie, createVerifier,
  exchangePkce, getOwnShop, googleAuthorizeUrl, readCookies, readVerifier,
  RECOVERY_VERIFIER_AGE, resolveSession, sameOrigin, sendRecovery, setSessionCookies,
  setVerifierCookie, signInPassword, signOut, signUp, updateUser,
} from '../auth.js';

const html = (body, title, extraHeaders) =>
  new Response(layout({ title, description: APP_NAME, body, scripts: ['/js/app.js'] }), {
    headers: mergeHeaders({ 'content-type': 'text/html; charset=utf-8',
                            'cache-control': 'no-store' }, extraHeaders),
  });

function mergeHeaders(base, extra) {
  const h = new Headers(base);
  if (extra) for (const [k, v] of extra.entries()) h.append(k, v);
  return h;
}

function redirect(location, extraHeaders) {
  const h = mergeHeaders({ location, 'cache-control': 'no-store' }, extraHeaders);
  return new Response(null, { status: 303, headers: h });
}

/** Only ever redirect inside this site — never to a URL a caller supplied. */
function safeNext(value, fallback = '/app') {
  if (!value || typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (/\\|%5c/i.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return fallback;

  try {
    const base = new URL('https://local.invalid');
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');

async function form(request) {
  const data = await request.formData();
  const out = {};
  for (const [k, v] of data.entries()) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

/**
 * Where an authenticated account belongs.
 * Sellers may follow a safe internal deep link. A no-shop account may
 * only bypass seller onboarding for the explicit customer destination.
 */
async function landingFor(env, token, next) {
  const safe = safeNext(next, '');
  const shop = await getOwnShop(env, token);
  if (shop) return safe || '/app';
  return safe === '/saved' ? '/saved' : '/onboarding';
}

/* ============================================================
   /signup
   ============================================================ */

export async function signupGet(request, url) {
  const next = safeNext(url.searchParams.get('next'), '');
  return html(signupPage({ next }), `${AUTH.signupTitle} — ${APP_NAME}`);
}

export async function signupPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const { email, password, next: rawNext } = await form(request);
  const next = safeNext(rawNext, '');

  if (!validEmail(email)) {
    return html(signupPage({ error: AUTH.errEmail, email, next }), AUTH.signupTitle);
  }
  if (!password || password.length < 8) {
    return html(signupPage({ error: AUTH.errPassword, email, next }), AUTH.signupTitle);
  }

  const res = await signUp(env, email, password);
  if (!res.ok) {
    const already = /already|registered|exists/i.test(res.error || '');
    return html(
      signupPage({ error: already ? AUTH.errTaken : AUTH.errGeneric, email, next }),
      AUTH.signupTitle,
    );
  }

  // With confirmations off, signup returns a session immediately.
  const session = res.data?.access_token ? res.data : res.data?.session;
  if (!session?.access_token) {
    return html(loginPage({ notice: AUTH.forgotSent, email, next }), AUTH.loginTitle);
  }

  const headers = new Headers();
  setSessionCookies(headers, session);
  return redirect(next === '/saved' ? '/saved' : '/onboarding', headers);
}

/* ============================================================
   /login
   ============================================================ */

export async function loginGet(request, url) {
  return html(
    loginPage({ next: safeNext(url.searchParams.get('next'), '') }),
    `${AUTH.loginTitle} — ${APP_NAME}`,
  );
}

export async function loginPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const { email, password, next: rawNext } = await form(request);
  const next = safeNext(rawNext, '');

  const res = await signInPassword(env, email, password);
  if (!res.ok || !res.data?.access_token) {
    return html(loginPage({ error: AUTH.errCredentials, email, next }), AUTH.loginTitle);
  }

  const headers = new Headers();
  setSessionCookies(headers, res.data);
  return redirect(await landingFor(env, res.data.access_token, next), headers);
}

/* ============================================================
   /logout
   ============================================================ */

export async function logoutPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });

  const cookies = readCookies(request);
  const token = cookies['sb-access'];
  // Best effort: revoke the refresh token server-side too.
  if (token) await signOut(env, token).catch(() => {});

  const headers = new Headers();
  clearSessionCookies(headers);
  return redirect('/', headers);
}

/* ============================================================
   Google — PKCE code flow, so the tokens never sit in a URL fragment
   ============================================================ */

export async function googleStart(request, env, url) {
  const verifier = createVerifier();
  const challenge = await challengeFor(verifier);
  const next = safeNext(url.searchParams.get('next'), '/app');

  const headers = new Headers();
  setVerifierCookie(headers, verifier);
  return redirect(googleAuthorizeUrl(env, url.origin, challenge, next), headers);
}

export async function authCallback(request, env, url) {
  const headers = new Headers();
  clearVerifierCookie(headers);

  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (error) return html(loginPage({ error: AUTH.errGeneric }), AUTH.loginTitle, headers);

  const code = url.searchParams.get('code');
  const verifier = readVerifier(readCookies(request));
  if (!code || !verifier) {
    return html(loginPage({ error: AUTH.errSession }), AUTH.loginTitle, headers);
  }

  const res = await exchangePkce(env, code, verifier);
  if (!res.ok || !res.data?.access_token) {
    return html(loginPage({ error: AUTH.errGeneric }), AUTH.loginTitle, headers);
  }

  setSessionCookies(headers, res.data);

  // A recovery link lands here too; send it on to the reset form.
  const next = safeNext(url.searchParams.get('next'), '');
  if (next === '/reset') return redirect('/reset', headers);

  return redirect(await landingFor(env, res.data.access_token, next), headers);
}

/* ============================================================
   password reset
   ============================================================ */

export async function forgotGet() {
  return html(forgotPage({}), `${AUTH.forgotTitle} — ${APP_NAME}`);
}

export async function forgotPost(request, env, url) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const { email } = await form(request);

  if (!validEmail(email)) {
    return html(forgotPage({ error: AUTH.errEmail, email }), AUTH.forgotTitle);
  }

  const verifier = createVerifier();
  const challenge = await challengeFor(verifier);
  const redirectTo = `${url.origin}/auth/callback?next=${encodeURIComponent('/reset')}`;

  // Always report the same thing, so this cannot be used to discover
  // which email addresses have accounts.
  await sendRecovery(env, email, challenge, redirectTo).catch(() => {});

  const headers = new Headers();
  setVerifierCookie(headers, verifier, RECOVERY_VERIFIER_AGE);
  return html(forgotPage({ sent: true }), AUTH.forgotTitle, headers);
}

export async function resetGet(request, env) {
  const { user } = await resolveSession(request, env);
  if (!user) return html(loginPage({ error: AUTH.errSession }), AUTH.loginTitle);
  return html(resetPage({}), `${AUTH.resetTitle} — ${APP_NAME}`);
}

export async function resetPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });

  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);
  if (!user) return html(loginPage({ error: AUTH.errSession }), AUTH.loginTitle, headers);

  const { password } = await form(request);
  if (!password || password.length < 8) {
    return html(resetPage({ error: AUTH.errPassword }), AUTH.resetTitle, headers);
  }

  const res = await updateUser(env, token, { password });
  if (!res.ok) return html(resetPage({ error: AUTH.errGeneric }), AUTH.resetTitle, headers);

  return html(resetPage({ done: true }), AUTH.resetTitle, headers);
}

export { redirect, safeNext, form, mergeHeaders, html };