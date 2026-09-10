/**
 * Wayl — the hosted checkout.
 *
 * Bazaro never sees a card, a PIN or a payment app. It asks Wayl for a
 * checkout link, sends the seller there, and afterwards asks Wayl what
 * happened. FIB, SuperQi and anything Wayl adds later are chosen
 * inside Wayl's own screens.
 *
 * Two rules hold this file together:
 *
 *   1. A webhook is a knock at the door. It is signed, it is checked,
 *      and then it is used for one thing only — as a reason to ask
 *      Wayl directly. The body never decides anything.
 *   2. A status this file does not recognise is PENDING. Not success,
 *      not failure. Guessing in either direction is how a seller ends
 *      up paying for a plan they did not get, or losing a plan they
 *      paid for.
 *
 * The token is a Worker secret. It is never sent to the browser, never
 * logged, and never written into a migration.
 */

import { WAYL } from './config.js';
import { secretsMatch } from './telegram.js';

/** Overridable only so the tests can point at a stub. */
const apiBase = (env) => env.WAYL_API_BASE || WAYL.apiBase;

/** 'test' unless the Worker has been told, explicitly, that this is live. */
export const waylEnv = (env) => (env.WAYL_ENV === 'live' ? 'live' : 'test');

/** The credentials are there. Says nothing about whether we may charge. */
export const waylConfigured = (env) => Boolean(env.WAYL_API_TOKEN);

/**
 * May this Worker create a real charge?
 *
 * Off unless PAYMENTS_ENABLED is the string "true" AND the token is
 * present. Anything else — unset, "1", "yes", a typo — is off, because
 * the failure of a feature flag has to be the safe direction.
 */
export const paymentsEnabled = (env) =>
  String(env.PAYMENTS_ENABLED) === 'true' && waylConfigured(env);

const hex = (bytes) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

/**
 * A reference Wayl and this database both know a payment by.
 *
 * Unique per attempt, never reused: the database has a unique index on
 * it, and a reused reference would let one payment answer for another.
 */
export const newReference = (prefix = 'BZ') =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomHex(5).toUpperCase()}`;

/** 32 random bytes. Wayl signs this payment's webhooks with it. */
export const newWebhookSecret = () => randomHex(32);

/* ============================================================
   the API
   ============================================================ */

async function call(env, path, { method = 'GET', body } = {}) {
  const headers = {
    'X-WAYL-AUTHENTICATION': env.WAYL_API_TOKEN,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';

  try {
    const res = await fetch(`${apiBase(env)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data, text };
  } catch {
    // A network failure is not a payment failure. The caller keeps the
    // seller in "checking" and asks again.
    return { ok: false, status: 0, data: null, text: '' };
  }
}

/**
 * Create a hosted checkout link.
 *
 * Only fields the Wayl documentation names are sent. `total` is the
 * server's price for the plan; nothing about the amount comes from the
 * browser.
 */
export function createLink(env, {
  referenceId, total, lineItemName, webhookUrl, webhookSecret, redirectionUrl, customParameter,
}) {
  return call(env, '/api/v1/links', {
    method: 'POST',
    body: {
      env: waylEnv(env),
      referenceId,
      total,
      currency: WAYL.currency,
      customParameter,
      // The shape Wayl actually requires, learned from it refusing
      // anything else: label, amount, and a type of "increase" or
      // "decrease". One line, the whole plan, so it adds up to total.
      lineItem: [{ label: lineItemName, amount: total, type: 'increase' }],
      webhookUrl,
      webhookSecret,
      redirectionUrl,
    },
  });
}

/** What Wayl says about a payment. The only thing allowed to be believed. */
export function fetchLink(env, referenceId) {
  return call(env, `/api/v1/links/${encodeURIComponent(referenceId)}`);
}

/* ============================================================
   reading a Wayl payload
   ============================================================ */

/** Wayl answers `{ data: {...} }`; some endpoints answer the object itself. */
const payloadOf = (body) =>
  (body && typeof body === 'object' && body.data && typeof body.data === 'object')
    ? body.data
    : (body && typeof body === 'object' ? body : {});

const firstString = (object, keys) => {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
};

export const readReference = (body) => firstString(payloadOf(body), WAYL.referenceKeys);
export const readRawStatus = (body) => firstString(payloadOf(body), WAYL.statusKeys);
export const readEventId = (body) => firstString(payloadOf(body), WAYL.eventKeys)
  ?? firstString(body ?? {}, WAYL.eventKeys);
export const readLinkId = (body) => firstString(payloadOf(body), WAYL.linkIdKeys);
export const readCode = (body) => firstString(payloadOf(body), WAYL.codeKeys);
export const readCheckoutUrl = (body) => {
  const url = firstString(payloadOf(body), WAYL.urlKeys);
  return url && /^https:\/\//i.test(url) ? url : null;
};
export const readCurrency = (body) => firstString(payloadOf(body), WAYL.currencyKeys);

/** Only a value worth printing on a receipt, and only one Wayl supplied. */
export function readMethod(body) {
  const method = firstString(payloadOf(body), WAYL.methodKeys);
  return method && /^[A-Za-z0-9 _.-]{1,32}$/.test(method) ? method : null;
}

/** The total Wayl holds for this payment, when it tells us one. */
export function readTotal(body) {
  const raw = firstString(payloadOf(body), WAYL.totalKeys);
  if (raw === null) return null;
  const total = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(total) ? total : null;
}

/**
 * Wayl's word for what happened, in ours.
 *
 * PROVISIONAL. The lists in config.js are what a first real payment is
 * for: until one has been made and its exact values written down,
 * anything not on them is 'pending', which is the state that costs
 * nobody anything.
 */
export function mapStatus(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return 'pending';
  if (WAYL.paidStatuses.includes(value)) return 'paid';
  if (WAYL.cancelledStatuses.includes(value)) return 'cancelled';
  if (WAYL.failedStatuses.includes(value)) return 'failed';
  return 'pending';
}

/* ============================================================
   the signature
   ============================================================ */

const base64 = (bytes) => btoa(String.fromCharCode(...bytes));

/**
 * Is this webhook really from Wayl?
 *
 * HMAC-SHA256 of the exact bytes that arrived, keyed with this
 * payment's own secret. The body is not parsed until this passes — a
 * forged body must not reach a JSON parser, let alone a decision.
 *
 * Hex and base64 are both accepted, and an optional `sha256=` prefix
 * is stripped, because the encoding is not something to be wrong about
 * on the first real payment. The comparison is constant time either
 * way.
 */
export async function signatureValid(secret, rawBody, header) {
  const sent = String(header ?? '').trim().replace(/^sha256=/i, '');
  if (!secret || !sent) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)),
  );

  return secretsMatch(sent.toLowerCase(), hex(mac)) || secretsMatch(sent, base64(mac));
}
