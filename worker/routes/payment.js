/**
 * Subscription payment: Wayl hosted checkout, and the trusted result.
 *
 * The whole flow, and where each part is decided:
 *
 *   plans        the seller picks 6 months or 1 year          browser
 *   checkout     price, shop and intent                       server
 *   Wayl         FIB or SuperQi, and the money                Wayl
 *   webhook      "something happened for this payment"        Wayl
 *   verify       "has this payment actually been made?"       server
 *   activate     the plan moves                               database
 *   result       what the seller is told                      server
 *
 * The browser is never asked and never believed. A redirect back from
 * Wayl carries a reference and nothing else — no status, no amount, no
 * signature — and this file treats it as a reason to go and ask.
 *
 * Deliberately not imported by routes/account.js: the account screens
 * do not render a payment result, and a test pins that.
 */

import { PLANS, WAYL } from '../config.js';
import { paymentResultPage } from '../render/payment-result.js';
import { asUser } from '../supabase.js';
import { getOwnShop, resolveSession, sameOrigin, setSessionCookies } from '../auth.js';
import { redirect } from './auth.js';
import {
  createLink, fetchLink, mapStatus, newReference, newWebhookSecret, paymentsEnabled,
  readCode, readCheckoutUrl, readCurrency, readEventId, readLinkId, readMethod,
  readRawStatus, readReference, readTotal, signatureValid, waylConfigured, waylEnv,
} from '../wayl.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^[A-Za-z0-9-]{6,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/i;

/**
 * The reference, from whichever name the URL carries it under.
 *
 * Wayl sends the seller back to `?referenceId=...&orderid=...`, having
 * replaced the query we asked for. Our own status polling uses `ref`.
 * Both are read; neither is believed. A reference only says which of
 * this seller's payments to go and ask Wayl about — RLS decides whether
 * it is theirs at all, and the answer comes from Wayl.
 *
 * `orderid` is Wayl's own link id. It is deliberately ignored: it adds
 * nothing the reference does not already settle.
 */
function referenceFrom(url) {
  const value = String(url.searchParams.get('referenceId') || url.searchParams.get('ref') || '');
  return REFERENCE.test(value) ? value : null;
}

const INTENT_COLUMNS =
  'id,shop_id,plan,amount,currency,status,reference_id,payment_method,' +
  'activated_at,checkout_url,env,created_at';

/** JSON, never cached, never stored. */
const json = (data, status = 200, headers) => {
  const h = new Headers(headers || undefined);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
};

/**
 * The ordinary 404 — the same one an unknown path gets.
 *
 * A fresh GET rather than the request itself: the webhook has usually
 * read its body by the time it decides to refuse, and a used body
 * cannot be handed on to the assets binding.
 */
const miss = (request, env) =>
  env.ASSETS.fetch(new Request(request.url, { method: 'GET' }));

async function guard(request, env, next) {
  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);

  if (!user) return { redirect: redirect(`/login?next=${encodeURIComponent(next)}`, headers) };
  const shop = await getOwnShop(env, token, user.id);
  if (!shop) return { redirect: redirect('/onboarding', headers) };
  return { user, token, shop, headers };
}

/* ============================================================
   PostgREST as the service key
   ============================================================

   There is no session in a webhook, and activation must not depend on
   one: the same function has to run whether Wayl knocked or the
   seller's phone polled. Everything that decides anything is inside
   the database function; this only carries the call.
   ============================================================ */

async function service(env, path, { method = 'GET', body, search } = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { ok: false, status: 0, data: null, code: null };

  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${path}`);
  if (search) for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data, code: data?.code ?? null };
  } catch {
    return { ok: false, status: 0, data: null, code: null };
  }
}

/* ============================================================
   the one verification path
   ============================================================ */

/**
 * Ask Wayl, and act only on what Wayl says.
 *
 * Both the webhook and the seller's polling browser end up here, so
 * there is one place where a payment becomes a subscription and one
 * set of refusals guarding it. The refusals are deliberately silent to
 * the caller: a mismatch means "still checking", never "failed", so a
 * seller is never told their money is gone because a field did not
 * line up.
 *
 * Returns { state, method } where state is checking | success |
 * failed | cancelled.
 */
export async function verifyAndActivate(env, intent) {
  // Already granted. Nothing to ask, and nothing that could grant it
  // a second time.
  if (intent.activated_at) {
    return { state: 'success', method: intent.payment_method ?? null };
  }
  if (intent.status === 'cancelled') return { state: 'cancelled', method: null };
  if (!waylConfigured(env) || !intent.reference_id) {
    return { state: 'checking', method: null };
  }

  const res = await fetchLink(env, intent.reference_id);
  // Wayl unreachable, or an error from it. Not a failed payment.
  if (!res.ok) return { state: 'checking', method: null };

  const state = mapStatus(readRawStatus(res.data));
  if (state !== 'paid') {
    return { state: state === 'pending' ? 'checking' : state, method: null };
  }

  // Paid, according to Wayl. Everything it also told us has to agree
  // with the intent before a plan moves.
  const reference = readReference(res.data);
  if (reference && reference !== intent.reference_id) return { state: 'checking', method: null };

  const currency = readCurrency(res.data);
  if (currency && currency.toUpperCase() !== 'IQD') return { state: 'checking', method: null };

  const total = readTotal(res.data);
  if (total !== null && total !== Number(intent.amount)) return { state: 'checking', method: null };

  const method = readMethod(res.data);
  const applied = await service(env, 'rpc/wayl_apply_payment', {
    method: 'POST',
    body: {
      p_intent: intent.id,
      p_reference_id: intent.reference_id,
      // The price the database itself stored, checked there again
      // against app.plan_price. Never a number from Wayl or a browser.
      p_amount: Number(intent.amount),
      p_method: method,
      p_note: 'wayl',
    },
  });

  // The function refused: a mismatched amount, a reference that is not
  // this intent's, a row that is not a payment. Say nothing to the
  // seller beyond "checking" and leave it for the owner to see.
  if (!applied.ok) return { state: 'checking', method: null };

  return { state: 'success', method: method ?? intent.payment_method ?? null };
}

/* ============================================================
   POST /app/subscription/checkout
   ============================================================ */

/**
 * Why a checkout could not be made, said once in the Worker log.
 *
 * Five different things used to come back to the seller as one word,
 * `errCheckout`: no return URL configured, the database refusing, Wayl
 * refusing, Wayl unreachable, or the link failing to store. They are
 * not the same problem and only one of them is Wayl's. Collapsing them
 * is what turned a missing environment variable into a hunt.
 *
 * `detail` may carry Wayl's own status and message. It must never
 * carry the API token, the webhook secret, or the seller's session —
 * none of which is passed in, and `note` below is the only thing that
 * reaches a log line.
 */
function checkoutFailed(where, detail) {
  const note = detail == null ? '' : ` ${String(detail).slice(0, 200)}`;
  console.log(`checkout failed: ${where}${note}`);
}

export async function checkoutPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });

  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const back = (key) => redirect(`/app/subscription?e=${key}`, g.headers);

  // The flag is what keeps this dark until a real checkout has been
  // made and read on a phone. Nothing below runs without it.
  if (!paymentsEnabled(env)) return back('errUnavailable');

  const form = await request.formData();
  const plan = PLANS.find((p) => p.key === String(form.get('plan') || ''));
  if (!plan) return back('errPlan');

  const reference = newReference();
  const secret = newWebhookSecret();

  // Ownership, the price and the rate limit are all decided here, in
  // the database, as the seller. The amount is not sent: a trigger
  // sets it from app.plan_price.
  const started = await asUser(env, g.token, 'rpc/wayl_start_intent', {
    method: 'POST',
    body: {
      p_shop: g.shop.id,
      p_plan: plan.key,
      p_reference_id: reference,
      p_env: waylEnv(env),
      p_secret: secret,
    },
  });

  if (!started.ok) {
    const code = started.data?.code ?? null;
    if (code === 'SW002') return back('errBusy');
    // A hand-made transfer is already waiting on the owner. Send them
    // to the screen that is about it rather than taking money twice.
    if (code === 'SW003') return redirect('/app/subscription/pay', g.headers);
    checkoutFailed('the database refused the attempt', code ?? started.status);
    return back('errCheckout');
  }

  const intent = Array.isArray(started.data) ? started.data[0] : started.data;
  if (!intent?.id) {
    checkoutFailed('the database returned no attempt');
    return back('errCheckout');
  }

  // A checkout they started minutes ago and never finished. Same link,
  // so a second tap does not become a second payment.
  if (intent.reused && intent.checkout_url) {
    return redirect(intent.checkout_url, g.headers);
  }

  // Where Wayl sends the seller back to, and where it calls us. Both
  // come from configuration only. If it is missing or malformed, no
  // checkout is created at all.
  const home = returnUrl(env);
  if (!home) {
    // Wayl is never called in this case, so there is no Wayl error to
    // find — which is exactly what made this one hard to see. It is
    // configuration, and it is ours.
    checkoutFailed('WAYL_RETURN_URL is missing or not a usable https URL');
    return back('errConfig');
  }

  const created = await createLink(env, {
    referenceId: intent.reference_id,
    total: Number(intent.amount),
    lineItemName: `${plan.name} — ${g.shop.name}`,
    // Per payment, so the secret that signs it can be found before the
    // body is parsed.
    webhookUrl: `${new URL(home).origin}/webhooks/wayl/${intent.id}`,
    webhookSecret: secret,
    // Wayl has been seen to drop this query and append its own
    // referenceId and orderid instead. Sent anyway, because the page
    // reads either name and losing it costs nothing.
    redirectionUrl: `${home}?ref=${encodeURIComponent(intent.reference_id)}`,
    customParameter: intent.id,
  });

  // Wayl answers 201 on success, so anything in the 2xx range counts.
  const checkoutUrl = created.ok ? readCheckoutUrl(created.data) : null;
  if (!checkoutUrl) {
    // Wayl's own words, so a refused key or a changed field name is
    // readable in the log instead of being guessed at. The token and
    // the webhook secret are in the REQUEST, never in this message.
    checkoutFailed(
      created.status ? `Wayl answered ${created.status}` : 'Wayl was unreachable',
      created.data?.message ?? (created.ok ? 'no checkout url in the response' : null),
    );
    return back(created.ok ? 'errCheckout' : 'errProvider');
  }

  const attached = await asUser(env, g.token, 'rpc/wayl_attach_link', {
    method: 'POST',
    body: {
      p_intent: intent.id,
      p_link_id: readLinkId(created.data),
      p_code: readCode(created.data),
      p_url: checkoutUrl,
    },
  });
  if (!attached.ok) {
    // The link exists at Wayl but is not stored here, so the webhook
    // would arrive against an attempt that cannot be matched. Better
    // to stop than to send the seller to a payment we have lost.
    checkoutFailed('the link could not be stored', attached.data?.code ?? attached.status);
    return back('errCheckout');
  }

  // The one redirect in this app that leaves the site. The URL was
  // not supplied by anybody: it came back from an authenticated Wayl
  // API call, was checked for https, and is what the database stored.
  // Wayl owns every screen from here until the seller comes back.
  return redirect(checkoutUrl, g.headers);
}

/**
 * The public URL of the result page — from WAYL_RETURN_URL and nowhere
 * else.
 *
 * Never derived from the request. `new URL(request.url)` in a Worker
 * is built from the Host header, which the caller controls, so a
 * forged Host would otherwise decide where Wayl sends a paying seller
 * and where Wayl posts its webhook. Both have to be a value we
 * configured, or there is no checkout.
 *
 * Returns null when it is missing or not a URL we would hand to Wayl.
 * https only, except on the loopback address, which is how the tests
 * and `wrangler dev` run.
 */
export function returnUrl(env) {
  const configured = String(env.WAYL_RETURN_URL || '').trim();
  if (!configured) return null;

  let parsed;
  try { parsed = new URL(configured); } catch { return null; }

  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return null;
  if (!parsed.pathname || parsed.pathname === '/') return null;

  // Anything the deployment appended is dropped: the only query this
  // URL ever carries is the reference, added at the call site.
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/* ============================================================
   GET /app/subscription/status?ref=...
   ============================================================ */

/**
 * What the seller's browser is allowed to know.
 *
 * Sanitised on purpose: no Wayl response, no token, no secret, no
 * intent id, nothing about another shop. The reference is echoed back
 * only because the browser already has it.
 */
export async function statusGet(request, env, url) {
  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const ref = referenceFrom(url);
  if (!ref) return json({ error: 'not found' }, 404, g.headers);

  const intent = await loadIntent(env, g.token, g.shop.id, ref);
  if (!intent) return json({ error: 'not found' }, 404, g.headers);

  const { state, method } = await verifyAndActivate(env, intent);
  const expiresAt = state === 'success' ? await loadExpiry(env, g.token, g.shop.id) : null;

  return json({
    state,
    plan: intent.plan,
    amount: Number(intent.amount),
    expiresAt,
    paymentMethod: method,
    reference: intent.reference_id,
  }, 200, g.headers);
}

/* ============================================================
   GET /app/subscription/result?ref=...
   ============================================================ */

/**
 * Where Wayl sends the seller back to.
 *
 * Measured, from a real test link: Wayl replaces the query we ask for
 * with its own, and returns the seller to
 *   /app/subscription/result/?referenceId=...&orderid=...
 *
 * Neither parameter is evidence of anything. The reference picks out
 * one of this seller's own payments — RLS decides that — and the state
 * on this page comes from the server asking Wayl, every single time it
 * is rendered. A seller who edits that query gets, at most, a different
 * payment of their own to look at.
 */
export async function resultGet(request, env, url) {
  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const ref = referenceFrom(url);
  if (!ref) return redirect('/app/subscription', g.headers);

  const intent = await loadIntent(env, g.token, g.shop.id, ref);
  if (!intent || !PLANS.some((p) => p.key === intent.plan)) {
    return redirect('/app/subscription', g.headers);
  }

  const { state, method } = await verifyAndActivate(env, intent);
  const expiresAt = state === 'success' ? await loadExpiry(env, g.token, g.shop.id) : null;

  // Success is the one state with something to prove. Without the
  // activated expiry the renderer refuses to draw it, and the seller
  // stays on "checking" rather than being shown a plan nobody granted.
  const shopSlug = SLUG.test(String(g.shop.slug || '')) ? g.shop.slug : null;
  const settled = state === 'success' && expiresAt && shopSlug;

  const headers = new Headers(g.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');

  return new Response(
    paymentResultPage({
      state: settled ? 'success' : state === 'success' ? 'checking' : state,
      plan: intent.plan,
      amount: Number(intent.amount),
      expiresAt: settled ? expiresAt : null,
      method: settled ? method : null,
      shopSlug: settled ? shopSlug : null,
      // Only an unfinished payment is worth watching.
      reference: settled ? null : intent.reference_id,
    }, { scripts: settled ? [] : ['/js/payment-result.js'] }),
    { headers },
  );
}

async function loadIntent(env, token, shopId, reference) {
  const res = await asUser(env, token, 'payment_intents', {
    search: {
      select: INTENT_COLUMNS,
      shop_id: `eq.${shopId}`,
      reference_id: `eq.${reference}`,
      limit: '1',
    },
  });
  return res.ok ? res.data?.[0] ?? null : null;
}

async function loadExpiry(env, token, shopId) {
  const res = await asUser(env, token, 'rpc/subscription_state', {
    method: 'POST', body: { p_shop: shopId },
  });
  const state = res.ok ? res.data?.[0] ?? null : null;
  return state?.expires_at ?? null;
}

/* ============================================================
   POST /webhooks/wayl/<intent id>
   ============================================================ */

/**
 * Wayl telling us something happened.
 *
 * The intent id is in the path because the signing secret is per
 * payment: the secret has to be found before the body can be checked,
 * and the body must not be parsed before that. So, in order:
 *
 *   1. the intent, by the id in the path
 *   2. its secret, readable only by the service key
 *   3. HMAC-SHA256 over the exact bytes that arrived, constant time
 *   4. only now, JSON
 *   5. the reference in the body must be this intent's
 *   6. the event id must not have been seen before
 *   7. ask Wayl what actually happened, and act on that
 *
 * Anything that fails 1-3 gets the ordinary 404, the same as an
 * unknown path. Everything after that gets a 200: the event has been
 * taken, and a retry would not change the answer.
 */
export async function webhookPost(request, env, intentId) {
  try {
    if (!waylConfigured(env) || !env.SUPABASE_SERVICE_ROLE_KEY) return miss(request, env);
    if (!UUID.test(String(intentId || ''))) return miss(request, env);

    const found = await service(env, 'payment_intents', {
      search: { select: INTENT_COLUMNS, id: `eq.${intentId}`, limit: '1' },
    });
    const intent = found.ok ? found.data?.[0] ?? null : null;
    if (!intent) return miss(request, env);

    const secretRow = await service(env, 'payment_intent_secrets', {
      search: { select: 'webhook_secret', intent_id: `eq.${intentId}`, limit: '1' },
    });
    const secret = secretRow.ok ? secretRow.data?.[0]?.webhook_secret ?? null : null;
    if (!secret) return miss(request, env);

    // The exact bytes, before anything reads them as a document.
    const raw = await request.text();
    const signature = request.headers.get(WAYL.signatureHeader);
    if (!(await signatureValid(secret, raw, signature))) return miss(request, env);

    let body = null;
    try { body = JSON.parse(raw); } catch { return ok(); }

    const reference = readReference(body);
    if (reference && reference !== intent.reference_id) return ok();

    // Replay protection. The database's unique index is what decides.
    // Wayl's own event id when there is one; otherwise a digest of the
    // exact bytes, so an identical delivery is still caught once and a
    // webhook with no event id is not simply ignored.
    const eventId = readEventId(body) ?? `body:${await digest(raw)}`;
    const first = await service(env, 'rpc/wayl_record_event', {
      method: 'POST',
      body: {
        p_intent: intent.id,
        p_event_id: eventId,
        p_event_type: null,
        p_status: readRawStatus(body),
      },
    });
    if (!first.ok || first.data !== true) return ok();

    // The body has now done everything it is allowed to do: it said
    // that something happened. What happened comes from Wayl.
    await verifyAndActivate(env, intent);
    return ok();
  } catch {
    // Never leak an error body to a public URL.
    return ok();
  }
}

/** Wayl retries anything that is not a 200, so almost everything is one. */
const ok = () => new Response('ok', { status: 200 });

/** SHA-256 of the raw delivery, hex. Only ever used as a dedupe key. */
async function digest(raw) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
