/**
 * /saved and the favourites API.
 *
 * A signed-out visitor's hearts live in localStorage and work with no
 * account at all. A signed-in one's live in `favorites`, written with
 * their own token so RLS decides. When someone signs in, the browser
 * hands over what it was holding and the two become one list.
 */

import { SAVED as T, APP_NAME } from '../config.js';
import { layout } from '../render/layout.js';
import { savedPage, savedTitle } from '../render/saved.js';
import { cardsFragment } from '../render/feed.js';
import { asUser, getProductsByIds } from '../supabase.js';
import { resolveSession, sameOrigin, setSessionCookies } from '../auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 200;

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

/** Ids from a client are never trusted into a URL or a query unchecked. */
const cleanIds = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((id) => typeof id === 'string' && UUID.test(id))
    .slice(0, MAX_IDS);

async function session(request, env) {
  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);
  return { user, token, headers };
}

/** The signed-in list, newest heart first. */
async function ownFavorites(env, token) {
  const res = await asUser(env, token, 'favorites', {
    search: {
      select: 'product_id,created_at',
      order: 'created_at.desc',
      limit: String(MAX_IDS),
    },
  });
  return res.ok ? (res.data ?? []).map((r) => r.product_id) : [];
}

/* ============================================================
   GET /saved
   ============================================================ */

export async function savedGet(request, env) {
  const s = await session(request, env);

  const products = s.user
    ? await getProductsByIds(env, await ownFavorites(env, s.token))
    : [];

  const h = new Headers(s.headers);
  h.set('content-type', 'text/html; charset=utf-8');
  // Personal, and for a signed-out visitor the shell differs from what
  // the browser will paint. Never let a shared cache hold either.
  h.set('cache-control', 'private, no-store');

  return new Response(
    layout({
      title: savedTitle(),
      description: `${T.title} — ${APP_NAME}`,
      body: savedPage({ products, signedIn: Boolean(s.user) }),
      scripts: ['/js/feed.js', '/js/favorites.js'],
    }),
    { headers: h },
  );
}

/* ============================================================
   API
   ============================================================ */

/** Who am I, and what have I already saved? The script asks on load. */
export async function stateGet(request, env) {
  const s = await session(request, env);
  const body = {
    signedIn: Boolean(s.user),
    ids: s.user ? await ownFavorites(env, s.token) : [],
  };

  const h = new Headers(s.headers);
  h.set('content-type', 'application/json');
  h.set('cache-control', 'private, no-store');
  return new Response(JSON.stringify(body), { headers: h });
}

/** Toggle one product. Signed out, this is never called. */
export async function togglePost(request, env) {
  if (!sameOrigin(request)) return json({ error: 'origin' }, 403);

  const s = await session(request, env);
  if (!s.user) return json({ error: 'auth', signedIn: false }, 401);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'body' }, 400); }

  const id = payload?.id;
  if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'id' }, 400);

  const on = payload?.on !== false;

  const res = on
    ? await asUser(env, s.token, 'favorites', {
        method: 'POST',
        prefer: 'resolution=ignore-duplicates',
        body: { user_id: s.user.id, product_id: id },
      })
    : await asUser(env, s.token, 'favorites', {
        method: 'DELETE',
        search: { product_id: `eq.${id}`, user_id: `eq.${s.user.id}` },
      });

  // The INSERT policy refuses a product that is not public, which is a
  // denial rather than an error worth surfacing.
  const h = new Headers(s.headers);
  h.set('content-type', 'application/json');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ ok: res.ok, on }), {
    status: res.ok ? 200 : 400,
    headers: h,
  });
}

/**
 * Adopt what the browser saved before this person had an account.
 *
 * merge_favorites skips anything not publicly visible and anything
 * already saved, so the same list can be posted twice with no effect.
 */
export async function mergePost(request, env) {
  if (!sameOrigin(request)) return json({ error: 'origin' }, 403);

  const s = await session(request, env);
  if (!s.user) return json({ error: 'auth', signedIn: false }, 401);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'body' }, 400); }

  const ids = cleanIds(payload?.ids);
  if (ids.length) {
    await asUser(env, s.token, 'rpc/merge_favorites', {
      method: 'POST', body: { p_products: ids },
    });
  }

  const h = new Headers(s.headers);
  h.set('content-type', 'application/json');
  h.set('cache-control', 'no-store');
  return new Response(
    JSON.stringify({ ok: true, ids: await ownFavorites(env, s.token) }),
    { headers: h },
  );
}

/**
 * Cards for a list of ids — how a signed-out /saved gets its rows.
 * Public data only: RLS drops anything hidden or lapsed.
 */
export async function cardsGet(env, url) {
  const ids = cleanIds((url.searchParams.get('ids') || '').split(','));
  const products = ids.length ? await getProductsByIds(env, ids) : [];

  return new Response(cardsFragment(products, 0, { saved: true }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-count': String(products.length),
    },
  });
}
