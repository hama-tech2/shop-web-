/**
 * Shop Web — sessions and Supabase Auth.
 *
 * The session lives in HttpOnly cookies set by the Worker, never in
 * JavaScript. Pages are rendered on the server with the seller's own
 * access token as the PostgREST bearer, so RLS decides what they see —
 * the Worker never needs, and never holds, the service_role key.
 *
 * Google sign-in uses the PKCE code flow rather than the implicit flow.
 * Implicit returns the tokens in the URL fragment, which a server can
 * never read; PKCE returns ?code= which we exchange server-side.
 */

const ACCESS = 'sb-access';
const REFRESH = 'sb-refresh';
const VERIFIER = 'sb-pkce';
const DRAFT = 'sb-onboarding';

const YEAR = 60 * 60 * 24 * 400;
const MONTH = 60 * 60 * 24 * 30;
const OAUTH_VERIFIER_AGE = 600;
const RECOVERY_VERIFIER_AGE = 3600;

/* ---------------------------------------------------------------
   cookies
   --------------------------------------------------------------- */

export function readCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAge) {
  return (
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; ` +
    `SameSite=Lax; Max-Age=${maxAge}`
  );
}

const clear = (name) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Attach a freshly issued Supabase session to a response. */
export function setSessionCookies(headers, session) {
  headers.append('set-cookie', cookie(ACCESS, session.access_token, session.expires_in ?? 3600));
  headers.append('set-cookie', cookie(REFRESH, session.refresh_token, MONTH));
}

export function clearSessionCookies(headers) {
  headers.append('set-cookie', clear(ACCESS));
  headers.append('set-cookie', clear(REFRESH));
  headers.append('set-cookie', clear(DRAFT));
}

/* ---------------------------------------------------------------
   Supabase Auth REST
   --------------------------------------------------------------- */

function authHeaders(env, token) {
  const h = {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    'content-type': 'application/json',
    accept: 'application/json',
  };
  h.authorization = `Bearer ${token || env.SUPABASE_PUBLISHABLE_KEY}`;
  return h;
}

async function authFetch(env, path, { method = 'POST', body, token, redirectTo } = {}) {
  const url = new URL(`${env.SUPABASE_URL}/auth/v1${path}`);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);

  const res = await fetch(url, {
    method,
    headers: authHeaders(env, token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    const message =
      data?.error_description || data?.msg || data?.message || data?.error || `auth_${res.status}`;
    return { ok: false, status: res.status, error: message, data };
  }
  return { ok: true, status: res.status, data };
}

export const signUp = (env, email, password) =>
  authFetch(env, '/signup', { body: { email, password } });

export const signInPassword = (env, email, password) =>
  authFetch(env, '/token?grant_type=password', { body: { email, password } });

export const refreshSession = (env, refresh_token) =>
  authFetch(env, '/token?grant_type=refresh_token', { body: { refresh_token } });

export const exchangePkce = (env, auth_code, code_verifier) =>
  authFetch(env, '/token?grant_type=pkce', { body: { auth_code, code_verifier } });

export const getUser = (env, token) =>
  authFetch(env, '/user', { method: 'GET', token });

export const updateUser = (env, token, patch) =>
  authFetch(env, '/user', { method: 'PUT', token, body: patch });

export const signOut = (env, token) =>
  authFetch(env, '/logout', { token, body: {} });

export const sendRecovery = (env, email, codeChallenge, redirectTo) =>
  authFetch(env, '/recover', {
    redirectTo,
    body: { email, code_challenge: codeChallenge, code_challenge_method: 's256' },
  });

/* ---------------------------------------------------------------
   PKCE
   --------------------------------------------------------------- */

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function createVerifier() {
  return b64url(crypto.getRandomValues(new Uint8Array(48)));
}

export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

export const setVerifierCookie = (headers, verifier, maxAge = OAUTH_VERIFIER_AGE) =>
  headers.append('set-cookie', cookie(VERIFIER, verifier, maxAge));

export const clearVerifierCookie = (headers) => headers.append('set-cookie', clear(VERIFIER));

export const readVerifier = (cookies) => cookies[VERIFIER] || null;

/** The URL the "Continue with Google" button sends the browser to. */
export function googleAuthorizeUrl(env, origin, challenge, next) {
  const url = new URL(`${env.SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', `${origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 's256');
  return url.toString();
}

/* ---------------------------------------------------------------
   session resolution
   --------------------------------------------------------------- */

/**
 * Who is this request?
 *
 * The access token is never trusted locally — it is handed to Supabase,
 * which verifies the signature. A forged cookie therefore resolves to
 * no user rather than to somebody else's account.
 *
 * Returns { user, token, refreshed } — `refreshed` carries a new session
 * whose cookies the caller must write onto its response.
 */
export async function resolveSession(request, env) {
  const cookies = readCookies(request);
  const access = cookies[ACCESS];
  const refresh = cookies[REFRESH];

  if (access) {
    const me = await getUser(env, access);
    if (me.ok && me.data?.id) return { user: me.data, token: access, refreshed: null };
  }

  if (refresh) {
    const next = await refreshSession(env, refresh);
    if (next.ok && next.data?.access_token) {
      const me = await getUser(env, next.data.access_token);
      if (me.ok && me.data?.id) {
        return { user: me.data, token: next.data.access_token, refreshed: next.data };
      }
    }
  }

  return { user: null, token: null, refreshed: null };
}

/* ---------------------------------------------------------------
   the seller's own shop
   --------------------------------------------------------------- */

/** RLS lets an owner read their own shop, so the user's token is enough. */
export async function getOwnShop(env, token) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/shops`);
  url.searchParams.set('select', 'id,slug,name,logo_key,city,whatsapp,status');
  url.searchParams.set('limit', '1');

  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}

/* ---------------------------------------------------------------
   onboarding draft (not sensitive, but HttpOnly anyway)
   --------------------------------------------------------------- */

export function readDraft(cookies) {
  try {
    return cookies[DRAFT] ? JSON.parse(atob(cookies[DRAFT])) : {};
  } catch {
    return {};
  }
}

export const setDraft = (headers, draft) =>
  headers.append('set-cookie', cookie(DRAFT, btoa(JSON.stringify(draft)), 3600));

export const clearDraft = (headers) => headers.append('set-cookie', clear(DRAFT));

/* ---------------------------------------------------------------
   CSRF
   --------------------------------------------------------------- */

/**
 * SameSite=Lax already stops a cross-site POST from carrying the session
 * cookie. This is the belt to that pair of braces.
 */
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;                       // same-origin form posts may omit it
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export { ACCESS, REFRESH, VERIFIER, DRAFT, YEAR, OAUTH_VERIFIER_AGE, RECOVERY_VERIFIER_AGE };
