/**
 * /admin — the operator screen.
 *
 * Access is decided by the `admins` table, and a non-admin does not get
 * a redirect or a "forbidden": the guard hands the request to the asset
 * handler, which is byte-for-byte what any unknown path returns. A
 * seller who guesses the URL learns nothing from the response.
 *
 * Every write goes through the seller-style PostgREST path with the
 * admin's own token, so RLS still decides what may change, and the
 * audit triggers record who did it.
 */

import { ADMIN as A, APP_NAME } from '../config.js';
import { layout } from '../render/layout.js';
import {
  adminHome, adminIntents, adminReports, adminShop, adminShops,
} from '../render/admin.js';
import { asUser } from '../supabase.js';
import { resolveSession, sameOrigin, setSessionCookies } from '../auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['all', 'active', 'trial', 'expired', 'suspended'];

function page(body, headers) {
  const h = new Headers(headers || undefined);
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'no-store');
  // Nothing under /admin should ever reach a crawler or a shared cache.
  h.set('x-robots-tag', 'noindex, nofollow');
  return new Response(
    layout({
      title: `${A.title} — ${APP_NAME}`,
      description: A.title,
      body,
      scripts: ['/js/admin.js'],
    }),
    { headers: h },
  );
}

const redirect = (location, headers) => {
  const h = new Headers(headers || undefined);
  h.set('location', location);
  h.set('cache-control', 'no-store');
  return new Response(null, { status: 303, headers: h });
};

/**
 * Admin, or nothing.
 *
 * Returns { token, headers } for an admin, and { miss } otherwise —
 * `miss` is the ordinary 404 the router would have produced anyway.
 */
async function guard(request, env) {
  const miss = () => ({ miss: env.ASSETS.fetch(request) });

  const { user, token, refreshed } = await resolveSession(request, env);
  if (!user) return miss();

  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);

  // RLS on `admins` lets anyone read their own row and nobody else's,
  // so a row coming back is proof, not a hint.
  const res = await asUser(env, token, 'admins', {
    search: { select: 'user_id,role', user_id: `eq.${user.id}`, limit: '1' },
  });
  if (!res.ok || !res.data?.length) return miss();

  return { user, token, headers };
}

async function form(request) {
  const data = await request.formData();
  const out = {};
  for (const [k, v] of data.entries()) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

/* ============================================================
   reads
   ============================================================ */

const INTENT_SELECT = 'id,shop_id,plan,amount,status,created_at,shops(name,slug,whatsapp)';

async function loadIntents(env, token) {
  const res = await asUser(env, token, 'payment_intents', {
    search: {
      select: INTENT_SELECT,
      status: 'eq.open',
      order: 'created_at.asc',
      limit: '100',
    },
  });
  return res.ok ? res.data ?? [] : [];
}

async function loadStats(env, token) {
  const res = await asUser(env, token, 'rpc/admin_stats', { method: 'POST', body: {} });
  return res.ok ? res.data?.[0] ?? null : null;
}

export async function homeGet(request, env) {
  const g = await guard(request, env);
  if (g.miss) return g.miss;

  const [stats, intents] = await Promise.all([
    loadStats(env, g.token),
    loadIntents(env, g.token),
  ]);
  return page(adminHome({ stats, intents }), g.headers);
}

export async function shopsGet(request, env, url) {
  const g = await guard(request, env);
  if (g.miss) return g.miss;

  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const wanted = url.searchParams.get('status');
  const status = STATUSES.includes(wanted) ? wanted : 'all';

  const res = await asUser(env, g.token, 'rpc/admin_shops', {
    method: 'POST',
    body: { p_search: q || null, p_status: status, p_limit: 200 },
  });

  return page(
    adminShops({ rows: res.ok ? res.data ?? [] : [], q, status }),
    g.headers,
  );
}

export async function intentsGet(request, env) {
  const g = await guard(request, env);
  if (g.miss) return g.miss;
  return page(adminIntents({ intents: await loadIntents(env, g.token) }), g.headers);
}

export async function reportsGet(request, env) {
  const g = await guard(request, env);
  if (g.miss) return g.miss;

  const res = await asUser(env, g.token, 'reports', {
    search: {
      select:
        'id,reason,details,status,created_at,product_id,shop_id,' +
        'products(id,title,status,shops(name,slug)),shops(name,slug)',
      status: 'eq.open',
      order: 'created_at.asc',
      limit: '100',
    },
  });

  return page(adminReports({ reports: res.ok ? res.data ?? [] : [] }), g.headers);
}

/* ============================================================
   one shop
   ============================================================ */

async function loadShop(env, token, id) {
  const shopFirst = await asUser(env, token, 'shops', {
    search: {
      select: 'id,name,slug,city,status,created_at,whatsapp,owner_id',
      id: `eq.${id}`, limit: '1',
    },
  });
  const shop = shopFirst.ok ? shopFirst.data?.[0] ?? null : null;
  if (!shop) return null;

  const [subRes, prodRes, noteRes, rowRes] = await Promise.all([
    asUser(env, token, 'subscriptions', {
      search: {
        select: 'plan,status,expires_at,grace_days,started_at',
        shop_id: `eq.${id}`, limit: '1',
      },
    }),
    asUser(env, token, 'products', {
      search: {
        select: 'id,title,price,status,created_at',
        shop_id: `eq.${id}`, order: 'created_at.desc', limit: '200',
      },
    }),
    asUser(env, token, 'shop_notes', {
      search: { select: 'note', shop_id: `eq.${id}`, limit: '1' },
    }),
    // admin_shops is the one place the owner's email and the derived
    // "days left" / "visible" flags come from. The slug narrows it to
    // this shop rather than pulling the whole table back.
    asUser(env, token, 'rpc/admin_shops', {
      method: 'POST', body: { p_search: shop.slug, p_status: 'all', p_limit: 20 },
    }),
  ]);

  const derived = rowRes.ok ? (rowRes.data ?? []).find((r) => r.id === id) : null;
  const sub = subRes.ok ? subRes.data?.[0] ?? null : null;

  return {
    shop: { ...shop, owner_email: derived?.owner_email ?? null },
    sub: sub && {
      ...sub,
      days_left: derived?.days_left ?? null,
      visible: derived?.visible ?? null,
    },
    products: prodRes.ok ? prodRes.data ?? [] : [],
    note: noteRes.ok ? noteRes.data?.[0]?.note ?? '' : '',
  };
}

export async function shopGet(request, env, url, id) {
  const g = await guard(request, env);
  if (g.miss) return g.miss;
  if (!UUID.test(id)) return env.ASSETS.fetch(request);

  const data = await loadShop(env, g.token, id);
  if (!data) return env.ASSETS.fetch(request);

  return page(
    adminShop({
      ...data,
      origin: url.origin,
      saved: url.searchParams.get('saved') === '1',
      error: url.searchParams.get('e') ? A.intentFailed : null,
    }),
    g.headers,
  );
}

/* ============================================================
   writes
   ============================================================ */

async function post(request, env, id) {
  // The admin check comes first: a cross-origin POST from a non-admin
  // must look like any other 404, not like a rejected CSRF attempt.
  const g = await guard(request, env);
  if (g.miss) return { deny: g.miss };
  if (!sameOrigin(request)) return { deny: new Response('bad origin', { status: 403 }) };
  if (id && !UUID.test(id)) return { deny: env.ASSETS.fetch(request) };
  return g;
}

/** Suspend or reopen a shop. `shops_guard_columns` allows this for admins only. */
export async function shopStatusPost(request, env, id) {
  const g = await post(request, env, id);
  if (g.deny) return g.deny;

  const { to } = await form(request);
  const status = to === 'suspended' ? 'suspended' : 'active';

  const res = await asUser(env, g.token, 'shops', {
    method: 'PATCH', search: { id: `eq.${id}` }, body: { status },
  });

  return redirect(`/admin/shops/${id}?${res.ok ? 'saved=1' : 'e=1'}`, g.headers);
}

/** Manual expiry override. The subscriptions audit trigger records it. */
export async function shopExpiryPost(request, env, id) {
  const g = await post(request, env, id);
  if (g.deny) return g.deny;

  const { expires_at } = await form(request);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires_at || '')) {
    return redirect(`/admin/shops/${id}?e=1`, g.headers);
  }

  // A date alone is midnight UTC; push it to the end of that day so
  // "expires on the 30th" means the 30th is still a full day.
  const res = await asUser(env, g.token, 'subscriptions', {
    method: 'PATCH',
    search: { shop_id: `eq.${id}` },
    body: { expires_at: `${expires_at}T23:59:59Z` },
  });

  return redirect(`/admin/shops/${id}?${res.ok ? 'saved=1' : 'e=1'}`, g.headers);
}

export async function shopNotePost(request, env, id) {
  const g = await post(request, env, id);
  if (g.deny) return g.deny;

  const { note } = await form(request);
  const res = await asUser(env, g.token, 'shop_notes', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: {
      shop_id: id,
      note: (note || '').slice(0, 4000) || null,
      updated_at: new Date().toISOString(),
      updated_by: g.user.id,
    },
  });

  return redirect(`/admin/shops/${id}?${res.ok ? 'saved=1' : 'e=1'}`, g.headers);
}

/* ---------- payment intents ---------- */

export async function intentActivatePost(request, env, id) {
  const g = await post(request, env, id);
  if (g.deny) return g.deny;

  // One RPC: it extends the subscription, writes the payment row and
  // closes the intent in a single transaction, so the intent can never
  // read "paid" while the subscription has not moved.
  const res = await asUser(env, g.token, 'rpc/admin_activate_intent', {
    method: 'POST', body: { p_intent: id, p_note: 'admin screen' },
  });

  return redirect(`/admin/intents${res.ok ? '' : '?e=1'}`, g.headers);
}

/* ---------- reports ---------- */

export async function reportHidePost(request, env, id) {
  const g = await post(request, env, id);
  if (g.deny) return g.deny;

  const res = await asUser(env, g.token, 'reports', {
    search: { select: 'id,product_id', id: `eq.${id}`, limit: '1' },
  });
  const report = res.ok ? res.data?.[0] : null;
  if (!report) return redirect('/admin/reports', g.headers);

  if (report.product_id) {
    await asUser(env, g.token, 'products', {
      method: 'PATCH',
      search: { id: `eq.${report.product_id}` },
      body: { status: 'hidden' },
    });
  }

  await closeReport(env, g, id, 'resolved');
  return redirect('/admin/reports', g.headers);
}

export async function reportDismissPost(request, env, id) {
  const g = await post(request, env, id);
  if (g.deny) return g.deny;
  await closeReport(env, g, id, 'dismissed');
  return redirect('/admin/reports', g.headers);
}

const closeReport = (env, g, id, status) =>
  asUser(env, g.token, 'reports', {
    method: 'PATCH',
    search: { id: `eq.${id}` },
    body: { status, handled_by: g.user.id, handled_at: new Date().toISOString() },
  });
