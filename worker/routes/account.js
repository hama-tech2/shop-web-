/**
 * The seller's account screens: profile, categories, subscription.
 *
 * All three follow the same shape as the rest of the app — server
 * rendered, form posts, the seller's own token as the PostgREST bearer
 * so RLS decides what they may touch.
 */

import {
  APP_NAME, CATEGORIES_UI as C, MAX_CATEGORIES, PLANS,
  PROFILE as P, PROFILE_VARIANTS as V, SUBSCRIPTION as S,
} from '../config.js';
import { layout } from '../render/layout.js';
import { profilePage } from '../render/profile.js';
import { categoriesPage } from '../render/categories.js';
import { accessGatePage, payPage, subscriptionPage } from '../render/subscription.js';
import { notifyPending } from '../telegram.js';
import { asUser, subscriptionState } from '../supabase.js';
import { paymentsEnabled } from '../wayl.js';
import { getOwnShop, resolveSession, sameOrigin, setSessionCookies } from '../auth.js';
import { redirect, safeNext } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST answers 200 with an empty body when a write matches no
 * rows, so "ok" alone cannot tell a real change from one RLS discarded.
 * Asking for the representation makes the affected rows the answer.
 */
const AFFECTED = 'return=representation';
const affected = (res) => (res.ok && Array.isArray(res.data) ? res.data.length : 0);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function page(body, title, headers, scripts = ['/js/account.js']) {
  const h = new Headers(headers || undefined);
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(
    layout({ title: `${title} — ${APP_NAME}`, description: APP_NAME, body, scripts }),
    { headers: h },
  );
}

async function guard(request, env, next = '/app') {
  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);

  if (!user) return { redirect: redirect(`/login?next=${encodeURIComponent(next)}`, headers) };
  const shop = await getOwnShop(env, token, user.id);
  if (!shop) return { redirect: redirect('/onboarding', headers) };

  return { user, token, shop, headers };
}

async function form(request) {
  const data = await request.formData();
  const out = {};
  for (const [k, v] of data.entries()) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

/* ============================================================
   profile
   ============================================================ */

const SHOP_SELECT =
  'id,slug,name,bio,city,whatsapp,phone,instagram,tiktok,facebook,snapchat,' +
  'maps_url,logo_key,cover_key';

async function loadShop(env, token, id) {
  const res = await asUser(env, token, 'shops', {
    search: { select: SHOP_SELECT, id: `eq.${id}`, limit: '1' },
  });
  return res.ok ? res.data?.[0] ?? null : null;
}

/** Sellers type 0750…; the database wants +964750…. */
function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+964${digits.slice(1)}`;
  if (digits.startsWith('964')) return `+${digits}`;
  return `+${digits}`;
}

const HANDLE = /^[A-Za-z0-9._]{1,40}$/;
/** Snapchat allows a hyphen where the others do not. */
const SNAP_HANDLE = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * A map link the seller pasted.
 *
 * https only. That is the whole guard: it rejects javascript:, data:
 * and vbscript: outright, and plain http:// too, because this URL is
 * opened straight from the page a customer reached from TikTok. The
 * database CHECK enforces the same rule, so a bad value cannot slip
 * past this function into a row.
 */
function normaliseMaps(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  try {
    const parsed = new URL(v);
    if (parsed.protocol !== 'https:') return { error: true };
    if (v.length > 500) return { error: true };
    return { value: parsed.toString() };
  } catch {
    return { error: true };
  }
}

/** Sellers paste whole URLs; keep only the handle. */
function normaliseHandle(raw) {
  let v = String(raw || '').trim();
  if (!v) return null;
  v = v.replace(/^https?:\/\/[^/]+\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return v || null;
}

/**
 * Snapchat, where the handle is not the first path segment.
 *
 * A Snapchat profile link is snapchat.com/add/<handle> — which is what
 * Snapchat's own share sheet gives a seller to paste. Taking the first
 * segment, as the other three platforms need, saved everybody the
 * handle "add".
 */
function normaliseSnapchat(raw) {
  const v = String(raw || '').trim().replace(/^https?:\/\/[^/]+\//i, '');
  return normaliseHandle(v.replace(/^add\//i, ''));
}

export async function profileGet(request, env, url) {
  const g = await guard(request, env, '/app/profile');
  if (g.redirect) return g.redirect;

  const shop = (await loadShop(env, g.token, g.shop.id)) ?? g.shop;
  return page(
    profilePage({ shop, values: shop, origin: url.origin,
                  saved: url.searchParams.get('saved') === '1' }),
    P.title, g.headers, ['/js/crop.js', '/js/account.js'],
  );
}

export async function profilePost(request, env, url) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, '/app/profile');
  if (g.redirect) return g.redirect;

  const f = await form(request);
  const shop = (await loadShop(env, g.token, g.shop.id)) ?? g.shop;

  const values = {
    ...shop,
    name: (f.name || '').replace(/\s+/g, ' ').trim(),
    bio: (f.bio || '').trim(),
    city: f.city || 'erbil',
    whatsapp: f.whatsapp || '',
    phone: f.phone || '',
    instagram: normaliseHandle(f.instagram),
    tiktok: normaliseHandle(f.tiktok),
    facebook: normaliseHandle(f.facebook),
    snapchat: normaliseSnapchat(f.snapchat),
    maps_url: (f.maps_url || '').trim(),
    cover_key: f.cover_key || null,
    logo_key: f.logo_key || null,
  };

  const fail = (message) =>
    page(profilePage({ shop, values, origin: url.origin, error: message }),
         P.title, g.headers, ['/js/crop.js', '/js/account.js']);

  if (values.name.length < 2 || values.name.length > 80) return fail(P.errName);

  const whatsapp = normalisePhone(values.whatsapp);
  if (!whatsapp || !/^\+?[0-9]{7,20}$/.test(whatsapp)) return fail(P.errWhatsapp);

  const phone = values.phone ? normalisePhone(values.phone) : null;
  if (phone && !/^\+?[0-9]{7,20}$/.test(phone)) return fail(P.errPhone);

  // Every social field is optional. Only a value the seller actually
  // typed is checked; empty stays empty and never blocks the save.
  for (const handle of [values.instagram, values.tiktok, values.facebook]) {
    if (handle && !HANDLE.test(handle)) return fail(P.errHandle);
  }
  if (values.snapchat && !SNAP_HANDLE.test(values.snapchat)) return fail(P.errHandle);

  const maps = normaliseMaps(values.maps_url);
  if (maps?.error) return fail(P.errMaps);

  // Only keys under this shop's prefix — the client sends them back in a
  // hidden field, so they get the same treatment as any other input.
  const prefix = `shops/${g.shop.id}/`;
  for (const key of [values.cover_key, values.logo_key]) {
    if (key && (!key.startsWith(prefix) || key.includes('..'))) return fail(P.errImage);
  }

  const res = await asUser(env, g.token, 'shops', {
    method: 'PATCH',
    search: { id: `eq.${g.shop.id}` },
    body: {
      name: values.name,
      bio: values.bio || null,
      city: values.city,
      whatsapp,
      phone,
      instagram: values.instagram,
      tiktok: values.tiktok,
      facebook: values.facebook,
      snapchat: values.snapchat,
      maps_url: maps?.value ?? null,
      cover_key: values.cover_key,
      logo_key: values.logo_key,
    },
  });

  if (!res.ok) return fail(P.errImage);
  return redirect('/app/profile?saved=1', g.headers);
}

/* ---------- banner / logo upload ---------- */

function sniff(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export async function profileImagePost(request, env) {
  if (!sameOrigin(request)) return Response.json({ error: 'origin' }, { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return Response.json({ error: 'auth' }, { status: 401 });

  let data;
  try { data = await request.formData(); }
  catch { return Response.json({ error: 'form' }, { status: 400 }); }

  const kind = String(data.get('kind') || '');
  if (kind !== 'banner' && kind !== 'logo') {
    return Response.json({ error: 'kind' }, { status: 400 });
  }

  const file = data.get('image');
  if (!file || typeof file === 'string' || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return Response.json({ error: 'size' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const type = sniff(buffer.slice(0, 12));
  if (!type) return Response.json({ error: 'type' }, { status: 400 });

  // The key is built from the session's shop, never from the client.
  const key = `shops/${g.shop.id}/${kind}-${crypto.randomUUID()}.webp`;
  await env.IMAGES.put(key, buffer, { httpMetadata: { contentType: type } });

  // The old key is not deleted here. Saving the form writes the new key,
  // and the shops trigger queues the replaced one into deleted_objects.
  return Response.json({ key, url: `/img/${key}` }, { headers: { 'cache-control': 'no-store' } });
}

/* ============================================================
   categories
   ============================================================ */

async function loadCategories(env, token, shopId) {
  const res = await asUser(env, token, 'categories', {
    search: {
      select: 'id,name,sort_order',
      shop_id: `eq.${shopId}`,
      order: 'sort_order.asc,name.asc',
      limit: '50',
    },
  });
  return res.ok ? res.data ?? [] : [];
}

export async function categoriesGet(request, env, url) {
  const g = await guard(request, env, '/app/categories');
  if (g.redirect) return g.redirect;

  const key = url.searchParams.get('e');
  const error = key && C[key] ? C[key] : null;

  return page(
    categoriesPage({ categories: await loadCategories(env, g.token, g.shop.id), error }),
    C.title, g.headers,
  );
}

const back = (headers, errorKey) =>
  redirect(errorKey ? `/app/categories?e=${errorKey}` : '/app/categories', headers);

export async function categoryAddPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, '/app/categories');
  if (g.redirect) return g.redirect;

  const { name } = await form(request);
  const clean = (name || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 1 || clean.length > 60) return back(g.headers, 'errName');

  const existing = await loadCategories(env, g.token, g.shop.id);
  if (existing.length >= MAX_CATEGORIES) return back(g.headers, 'errLimit');

  const res = await asUser(env, g.token, 'categories', {
    method: 'POST',
    body: {
      shop_id: g.shop.id,
      name: clean,
      sort_order: (existing[existing.length - 1]?.sort_order ?? 0) + 10,
    },
  });

  if (!res.ok) {
    return back(g.headers, res.data?.code === '23505' ? 'errDuplicate' : 'errName');
  }
  return back(g.headers);
}

export async function categoryRenamePost(request, env, id) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, '/app/categories');
  if (g.redirect) return g.redirect;
  if (!UUID.test(id)) return back(g.headers);

  const { name } = await form(request);
  const clean = (name || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 1 || clean.length > 60) return back(g.headers, 'errName');

  const res = await asUser(env, g.token, 'categories', {
    method: 'PATCH',
    search: { id: `eq.${id}`, shop_id: `eq.${g.shop.id}` },
    prefer: AFFECTED,
    body: { name: clean },
  });
  if (!res.ok) {
    return back(g.headers, res.data?.code === '23505' ? 'errDuplicate' : 'errName');
  }
  // Renamed nothing: deleted in another tab, or never this seller's.
  if (affected(res) === 0) return back(g.headers, 'errGone');
  return back(g.headers);
}

export async function categoryDeletePost(request, env, id) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, '/app/categories');
  if (g.redirect) return g.redirect;
  if (!UUID.test(id)) return back(g.headers);

  // products.category_id is ON DELETE SET NULL: the products survive,
  // they just stop belonging to this category.
  const res = await asUser(env, g.token, 'categories', {
    method: 'DELETE',
    search: { id: `eq.${id}`, shop_id: `eq.${g.shop.id}` },
    prefer: AFFECTED,
  });
  if (!res.ok || affected(res) === 0) return back(g.headers, 'errGone');
  return back(g.headers);
}

export async function categoryMovePost(request, env, id) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, '/app/categories');
  if (g.redirect) return g.redirect;
  if (!UUID.test(id)) return back(g.headers);

  const { dir } = await form(request);
  const list = await loadCategories(env, g.token, g.shop.id);
  const i = list.findIndex((c) => c.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return back(g.headers);

  // Swap the two sort_order values. They are not unique, so no
  // constraint dance is needed. Both are scoped to this shop so the
  // affected-row count means something.
  const [a, b] = await Promise.all([
    asUser(env, g.token, 'categories', {
      method: 'PATCH',
      search: { id: `eq.${list[i].id}`, shop_id: `eq.${g.shop.id}` },
      prefer: AFFECTED,
      body: { sort_order: list[j].sort_order },
    }),
    asUser(env, g.token, 'categories', {
      method: 'PATCH',
      search: { id: `eq.${list[j].id}`, shop_id: `eq.${g.shop.id}` },
      prefer: AFFECTED,
      body: { sort_order: list[i].sort_order },
    }),
  ]);

  // Either half missing means the order on screen is not the order in
  // the database. Say so rather than redrawing a list that lies.
  if (affected(a) === 0 || affected(b) === 0) return back(g.headers, 'errGone');
  return back(g.headers);
}

/* ============================================================
   categories — the JSON half
   ============================================================

   Same session, same seller token, same validation as the form posts
   above; only the answer differs. Two screens need it: the category
   rail on the owner profile, and the inline creator inside the product
   form. Both must stay where they are — navigating to a manager page
   is what used to throw away a half-composed product.
   ============================================================ */

async function apiGuard(request, env, { write = false } = {}) {
  // A write still has to come from our own origin. Reads are harmless
  // and are answered for the session that asked.
  if (write && !sameOrigin(request)) {
    return { response: Response.json({ error: 'origin' }, { status: 403 }) };
  }

  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);
  headers.set('cache-control', 'no-store');

  if (!user) return { response: Response.json({ error: 'auth' }, { status: 401, headers }) };
  const shop = await getOwnShop(env, token, user.id);
  if (!shop) return { response: Response.json({ error: 'auth' }, { status: 401, headers }) };

  return { token, shop, headers };
}

const apiJson = (g, body, status = 200) =>
  Response.json(body, { status, headers: g.headers });

export async function categoriesApiGet(request, env) {
  const g = await apiGuard(request, env);
  if (g.response) return g.response;

  const list = await loadCategories(env, g.token, g.shop.id);
  return apiJson(g, {
    categories: list.map(({ id, name }) => ({ id, name })),
    max: MAX_CATEGORIES,
  });
}

export async function categoryApiPost(request, env) {
  const g = await apiGuard(request, env, { write: true });
  if (g.response) return g.response;

  const { name } = await form(request);
  const clean = (name || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 1 || clean.length > 60) return apiJson(g, { error: C.errName }, 400);

  const existing = await loadCategories(env, g.token, g.shop.id);

  // Typing a name that already exists is not a failure here. The caller
  // asked for "a category with this name, selected"; it already has one.
  const same = existing.find((c) => c.name === clean);
  if (same) return apiJson(g, { id: same.id, name: same.name, existed: true });

  if (existing.length >= MAX_CATEGORIES) return apiJson(g, { error: C.errLimit }, 409);

  const res = await asUser(env, g.token, 'categories', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      shop_id: g.shop.id,
      name: clean,
      sort_order: (existing[existing.length - 1]?.sort_order ?? 0) + 10,
    },
  });

  const row = res.ok ? res.data?.[0] ?? null : null;
  if (!row) {
    return apiJson(g, { error: res.data?.code === '23505' ? C.errDuplicate : C.errCreate }, 400);
  }
  return apiJson(g, { id: row.id, name: row.name });
}

export async function categoryApiRename(request, env, id) {
  const g = await apiGuard(request, env, { write: true });
  if (g.response) return g.response;
  if (!UUID.test(id)) return apiJson(g, { error: C.errGone }, 404);

  const { name } = await form(request);
  const clean = (name || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 1 || clean.length > 60) return apiJson(g, { error: C.errName }, 400);

  const res = await asUser(env, g.token, 'categories', {
    method: 'PATCH',
    search: { id: `eq.${id}`, shop_id: `eq.${g.shop.id}` },
    prefer: AFFECTED,
    body: { name: clean },
  });
  if (!res.ok) {
    return apiJson(g, { error: res.data?.code === '23505' ? C.errDuplicate : C.errName }, 400);
  }
  // Renamed nothing: deleted in another tab, or never this seller's.
  if (affected(res) === 0) return apiJson(g, { error: C.errGone }, 404);
  return apiJson(g, { id, name: clean });
}

export async function categoryApiDelete(request, env, id) {
  const g = await apiGuard(request, env, { write: true });
  if (g.response) return g.response;
  if (!UUID.test(id)) return apiJson(g, { error: C.errGone }, 404);

  // products.category_id is ON DELETE SET NULL. The products, their
  // images, price, description and public URL all survive; they only
  // stop belonging to a category. Nothing here touches products.
  const res = await asUser(env, g.token, 'categories', {
    method: 'DELETE',
    search: { id: `eq.${id}`, shop_id: `eq.${g.shop.id}` },
    prefer: AFFECTED,
  });
  if (!res.ok || affected(res) === 0) return apiJson(g, { error: C.errGone }, 404);
  return apiJson(g, { id });
}

/* ============================================================
   subscription and the manual payment flow
   ============================================================

   There is no processor. A seller picks a plan, we file an intent with
   a short reference code, they transfer to the owner's FIB number with
   that code in the note, and they tap "I sent it". The owner confirms
   it by hand on /admin.

   Nothing here ever tells the seller the payment succeeded. The only
   thing this side of the app knows is that they say they sent it.
   ============================================================ */

const loadState = (env, token, shopId) => subscriptionState(env, token, shopId);

/**
 * The intent this seller is in the middle of, if any.
 *
 * 'open' means filed but not yet transferred; 'pending' means they say
 * they have sent the money. Both are live, and the database allows only
 * one of them per plan, so this is the one the screens talk about.
 */
async function loadLiveIntent(env, token, shopId) {
  const res = await asUser(env, token, 'payment_intents', {
    search: {
      select: 'id,plan,amount,status,reference,created_at',
      shop_id: `eq.${shopId}`,
      status: 'in.(open,pending)',
      order: 'created_at.desc',
      limit: '1',
    },
  });
  return res.ok ? res.data?.[0] ?? null : null;
}

async function loadPayments(env, token, shopId) {
  const res = await asUser(env, token, 'payments', {
    search: {
      select: 'id,plan,amount,status,paid_at,created_at,reference',
      shop_id: `eq.${shopId}`,
      // Free grants have a separate, explicitly labelled /admin history.
      // Never present a grant as a confirmed bank transfer to the seller.
      method: 'neq.manual_grant',
      order: 'paid_at.desc',
      limit: '50',
    },
  });
  return res.ok ? res.data ?? [] : [];
}

const subPage = (body, headers) => page(body, S.title, headers, ['/js/account.js']);

export async function subscriptionGet(request, env, url) {
  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const wanted = url.searchParams.get('plan');
  const selected = PLANS.some((p) => p.key === wanted) ? wanted : PLANS[0].key;
  const errorKey = url.searchParams.get('e');

  // Old chooser and old checkout bookmarks land safely here. A query
  // parameter is never a verified result and never a payment: with
  // hosted checkout on, the plan form posts and this branch is dead.
  const enabled = paymentsEnabled(env);
  const checkoutUnavailable =
    !enabled && ['checkout', 'method'].includes(url.searchParams.get('step'));

  const [state, intent, payments] = await Promise.all([
    loadState(env, g.token, g.shop.id),
    loadLiveIntent(env, g.token, g.shop.id),
    loadPayments(env, g.token, g.shop.id),
  ]);

  return subPage(
    subscriptionPage({
      state, selected, intent, payments, paymentsEnabled: enabled,
      error: checkoutUnavailable
        ? S.errUnavailable
        : errorKey && S[errorKey] ? S[errorKey] : null,
    }),
    g.headers,
  );
}

/**
 * The access screen: what stands in front of a first product when no
 * plan has been chosen.
 *
 * A GET only. Rendering it starts nothing — that is the whole point of
 * a screen a seller can back out of.
 */
export async function accessGateGet(request, env, url) {
  const g = await guard(request, env, '/app/subscription/start');
  if (g.redirect) return g.redirect;

  const state = await loadState(env, g.token, g.shop.id);
  // Already entitled: there is nothing to choose here.
  if (state?.can_publish) return redirect('/app/new', g.headers);

  const errorKey = url.searchParams.get('e');
  return subPage(
    accessGatePage({
      trialAvailable: Boolean(state?.trial_available),
      error: errorKey && S[errorKey] ? S[errorKey] : null,
    }),
    g.headers,
  );
}

/**
 * Starting the free trial.
 *
 * The seller's own decision, taken by a form post from the access
 * screen. Everything that decides whether they may is in the database:
 * start_trial checks that the shop is theirs, that no plan is running,
 * and that this account has never taken a trial before — a row keyed on
 * their user id, which outlives the shop, the session and the browser.
 */
export async function subscriptionTrialPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, '/app/subscription/start');
  if (g.redirect) return g.redirect;

  const { next } = await form(request);
  const res = await asUser(env, g.token, 'rpc/start_trial', {
    method: 'POST', body: { p_shop: g.shop.id },
  });

  if (!res.ok) {
    // SW004 the trial is spent, SW006 a plan is already running.
    // Neither is a failure worth a stack trace; both are a sentence.
    const code = res.data?.code ?? null;
    const key = code === 'SW004' ? 'errTrialUsed'
      : code === 'SW006' ? 'errTrialActive'
      : 'errTrial';
    return redirect(`/app/subscription/start?e=${key}`, g.headers);
  }

  return redirect(safeNext(next, '/app/new'), g.headers);
}

export async function subscriptionPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const { plan: wanted } = await form(request);
  const plan = PLANS.find((p) => p.key === wanted);
  if (!plan) return redirect('/app/subscription?e=errPlan', g.headers);

  // Already mid-payment for this plan: send them back to the code they
  // were given rather than filing a second intent the owner would have
  // to reconcile. The partial unique index would refuse it anyway.
  const live = await loadLiveIntent(env, g.token, g.shop.id);
  if (live && live.plan === plan.key) {
    return redirect('/app/subscription/pay', g.headers);
  }

  // The amount is not sent from here: a BEFORE INSERT trigger sets it
  // from app.plan_price, so a crafted post cannot name its own price.
  // The value stored is the price at the time of the intent, which is
  // what an early seller keeps if prices change later.
  const res = await asUser(env, g.token, 'payment_intents', {
    method: 'POST',
    prefer: 'return=representation',
    body: { shop_id: g.shop.id, plan: plan.key, amount: plan.amount },
  });

  if (!res.ok || !res.data?.[0]) {
    return redirect('/app/subscription?e=errIntent', g.headers);
  }
  return redirect('/app/subscription/pay', g.headers);
}

/** Where to transfer, how much, and with which code. */
export async function subscriptionPayGet(request, env, url) {
  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const intent = await loadLiveIntent(env, g.token, g.shop.id);
  if (!intent) return redirect('/app/subscription', g.headers);

  const plan = PLANS.find((p) => p.key === intent.plan) ?? PLANS[0];
  const errorKey = url.searchParams.get('e');

  return subPage(
    payPage({
      plan, intent, shopName: g.shop.name,
      error: errorKey && S[errorKey] ? S[errorKey] : null,
    }),
    g.headers,
  );
}

/**
 * "I sent it".
 *
 * open -> pending, and nothing else. The subscription is untouched:
 * only the owner finding the money moves that. RLS still forbids a
 * seller from updating payment_intents at all; mark_intent_sent is the
 * one door, and it only opens in this direction, on their own intent.
 */
export async function subscriptionSentPost(request, env, ctx) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const { intent: id } = await form(request);
  if (!UUID.test(String(id || ''))) {
    return redirect('/app/subscription/pay?e=errSent', g.headers);
  }

  const res = await asUser(env, g.token, 'rpc/mark_intent_sent', {
    method: 'POST', body: { p_intent: id },
  });

  // Tell the owner, best effort and out of band. The seller has just
  // said they transferred money; Telegram being down is not a reason to
  // show them a failure, and it must not add a second of latency to
  // this response either.
  if (res.ok) {
    const intent = Array.isArray(res.data) ? res.data[0] : res.data;
    const notify = notifyOwner(env, { ...intent, name: g.shop.name });
    if (ctx?.waitUntil) ctx.waitUntil(notify); else await notify.catch(() => {});
  }

  return redirect(
    res.ok ? '/app/subscription/pay' : '/app/subscription/pay?e=errSent',
    g.headers,
  );
}

/**
 * Send the notification and remember where it landed.
 *
 * The message id is stored so the webhook can edit that exact message
 * when the owner taps a button. Written with the service key because
 * the seller must not be able to touch these columns, and swallowed
 * whole on failure: nothing about a payment depends on it.
 */
async function notifyOwner(env, intent) {
  try {
    const messageId = await notifyPending(env, intent);
    if (!messageId || !env.SUPABASE_SERVICE_ROLE_KEY) return;

    await fetch(
      `${env.SUPABASE_URL}/rest/v1/payment_intents?id=eq.${encodeURIComponent(intent.id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          telegram_chat_id: String(env.TELEGRAM_OWNER_CHAT_ID),
          telegram_message_id: messageId,
        }),
      },
    );
  } catch {
    // Best effort, by design. The payment is already pending.
  }
}
