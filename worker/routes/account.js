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
import { intentPage, subscriptionPage } from '../render/subscription.js';
import { asUser } from '../supabase.js';
import { getOwnShop, resolveSession, sameOrigin, setSessionCookies } from '../auth.js';
import { redirect } from './auth.js';

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

const SHOP_SELECT = 'id,slug,name,bio,city,whatsapp,phone,instagram,tiktok,facebook,logo_key,cover_key';

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

/** Sellers paste whole URLs; keep only the handle. */
function normaliseHandle(raw) {
  let v = String(raw || '').trim();
  if (!v) return null;
  v = v.replace(/^https?:\/\/[^/]+\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return v || null;
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

  for (const handle of [values.instagram, values.tiktok, values.facebook]) {
    if (handle && !HANDLE.test(handle)) return fail(P.errHandle);
  }

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
   subscription
   ============================================================ */

async function loadState(env, token, shopId) {
  const res = await asUser(env, token, 'rpc/subscription_state', {
    method: 'POST', body: { p_shop: shopId },
  });
  return res.ok ? res.data?.[0] ?? null : null;
}

export async function subscriptionGet(request, env, url) {
  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const wanted = url.searchParams.get('plan');
  const selected = PLANS.some((p) => p.key === wanted) ? wanted : PLANS[0].key;

  return page(
    subscriptionPage({ state: await loadState(env, g.token, g.shop.id), selected }),
    S.title, g.headers,
  );
}

export async function subscriptionPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const { plan: wanted } = await form(request);
  const plan = PLANS.find((p) => p.key === wanted) ?? PLANS[0];

  // No processor yet. Record what they asked for, then say so plainly.
  // The amount is snapshotted so a later price change does not rewrite
  // what this seller was shown.
  await asUser(env, g.token, 'payment_intents', {
    method: 'POST',
    body: { shop_id: g.shop.id, plan: plan.key, amount: plan.amount },
  });

  return redirect(`/app/subscription/requested?plan=${plan.key}`, g.headers);
}

export async function subscriptionRequestedGet(request, env, url) {
  const g = await guard(request, env, '/app/subscription');
  if (g.redirect) return g.redirect;

  const plan = PLANS.find((p) => p.key === url.searchParams.get('plan')) ?? PLANS[0];
  return page(
    intentPage({ plan, origin: url.origin, shopName: g.shop.name }),
    S.requestedTitle, g.headers,
  );
}
