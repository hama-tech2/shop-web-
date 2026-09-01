/**
 * Supabase data access for the Worker.
 *
 * Reads go through PostgREST with the PUBLISHABLE key only. Row Level
 * Security is what protects the data, so the anon role already sees
 * exactly the right rows: active products of active, non-expired shops.
 * The service_role key is never used here and must never reach this file.
 */

const SELECT_CARD =
  'id,title,price,created_at,platform_category_id,category_id,' +
  'shops!inner(name,slug,logo_key),' +
  'product_images(r2_key,position)';

function headers(env) {
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: 'application/json',
  };
}

async function get(env, path, search) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(search)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const res = await fetch(url, { headers: headers(env) });
  if (!res.ok) {
    throw new Error(`supabase ${path} ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Global categories, for mapping a chip slug to its id. */
export async function getCategories(env) {
  return get(env, 'platform_categories', {
    select: 'id,slug,name_ckb',
    is_active: 'eq.true',
    order: 'sort_order.asc',
  });
}

/**
 * One page of the feed.
 *
 * Asks for limit + 1 rows so the caller knows whether a "load more"
 * button is warranted without running a second count query.
 */
export async function getFeed(env, { categoryId, query, limit, offset }) {
  const q = (query ?? '').trim();

  const rows = q
    ? await get(env, 'rpc/search_products', {
        // search_products normalises ک/ك and ی/ي the same way the index does
        p_query: q,
        p_platform_category: categoryId ? categoryId : undefined,
        p_limit: limit + 1,
        p_offset: offset,
        select: SELECT_CARD,
      })
    : await get(env, 'products', {
        select: SELECT_CARD,
        status: 'eq.active',
        platform_category_id: categoryId ? `eq.${categoryId}` : undefined,
        order: 'created_at.desc',
        limit: limit + 1,
        offset,
      });

  const hasMore = rows.length > limit;
  return { products: rows.slice(0, limit).map(toCard), hasMore };
}

function toCard(row) {
  const images = (row.product_images ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((i) => i.r2_key);

  return {
    id: row.id,
    title: row.title,
    price: Number(row.price),
    categoryId: row.platform_category_id ?? null,
    ownCategoryId: row.category_id ?? null,
    images: images.length ? images : [null],
    shopName: row.shops?.name ?? '',
    shopSlug: row.shops?.slug ?? '',
    shopLogo: row.shops?.logo_key ?? null,
  };
}

/* ---------------------------------------------------------------
   Writes on behalf of a signed-in seller.
   The seller's own access token is the bearer, so RLS applies as them
   and the Worker never needs elevated credentials.
   --------------------------------------------------------------- */

export async function asUser(env, token, path, { method = 'GET', body, prefer, search } = {}) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${path}`);
  if (search) for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);

  const headers = {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.prefer = prefer;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  return { ok: res.ok, status: res.status, data };
}

/** Public RPC: is this slug free? Answers without exposing the shops table. */
export async function slugAvailable(env, slug) {
  const rows = await get(env, 'rpc/slug_available', { p_slug: slug });
  return rows?.[0] ?? { available: false, reason: 'format' };
}

/* ---------------------------------------------------------------
   The public shop page.
   --------------------------------------------------------------- */

/**
 * A shop's public header.
 *
 * Goes through an RPC rather than a plain select because RLS hides an
 * expired shop from anon completely — correct for its products, wrong
 * for the page itself. The seller's link has to keep working.
 * `products_visible` is false once the grace period is over.
 */
export async function getShopProfile(env, slug) {
  const rows = await get(env, 'rpc/shop_public_profile', { p_slug: slug });
  return rows?.[0] ?? null;
}

/** Active products of one shop. RLS returns nothing once a shop lapses. */
export async function getShopProducts(env, shopId, categoryId, ownCategoryId) {
  const search = {
    select: SELECT_CARD,
    shop_id: `eq.${shopId}`,
    status: 'eq.active',
    order: 'sort_order.asc,created_at.desc',
    limit: 60,
  };
  if (categoryId) search.platform_category_id = `eq.${categoryId}`;
  if (ownCategoryId) search.category_id = `eq.${ownCategoryId}`;

  const rows = await get(env, 'products', search);
  return rows.map(toCard);
}

/** One product, with every image and its shop. Anon sees active only. */
export async function getProduct(env, id) {
  const rows = await get(env, 'products', {
    select:
      'id,title,price,description,status,shop_id,platform_category_id,' +
      'shops!inner(id,name,slug,logo_key,whatsapp,city),' +
      'product_images(r2_key,r2_key_full,position)',
    id: `eq.${id}`,
    status: 'eq.active',
    limit: 1,
  });

  const row = rows?.[0];
  if (!row) return null;

  const images = (row.product_images ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);

  return {
    id: row.id,
    title: row.title,
    price: Number(row.price),
    description: row.description ?? '',
    categoryId: row.platform_category_id,
    images: images.map((i) => ({ card: i.r2_key, full: i.r2_key_full || i.r2_key })),
    shop: row.shops,
  };
}

/** The "more from this seller" row. */
export async function getMoreFromShop(env, shopId, excludeId, limit = 6) {
  const rows = await get(env, 'products', {
    select: SELECT_CARD,
    shop_id: `eq.${shopId}`,
    status: 'eq.active',
    id: `neq.${excludeId}`,
    order: 'created_at.desc',
    limit,
  });
  return rows.map(toCard);
}

/* ---------------------------------------------------------------
   search
   --------------------------------------------------------------- */

/**
 * Products matching a query.
 *
 * The RPC does the Sorani normalising and the trigram fallback; this
 * only asks for one row more than it needs so the caller knows whether
 * a "load more" is warranted.
 */
export async function searchProducts(env, { query, categoryId, limit, offset = 0 }) {
  const rows = await get(env, 'rpc/search_products', {
    p_query: query,
    p_platform_category: categoryId || undefined,
    p_limit: limit + 1,
    p_offset: offset,
    select: SELECT_CARD,
  });
  return { products: rows.slice(0, limit).map(toCard), hasMore: rows.length > limit };
}

/** Shops matching a query. RLS hides a suspended or lapsed shop. */
export async function searchShops(env, { query, limit = 20, offset = 0 }) {
  return get(env, 'rpc/search_shops', {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  });
}

/* ---------------------------------------------------------------
   favourites
   --------------------------------------------------------------- */

/**
 * Cards for a list of product ids, in the order asked for.
 *
 * Used by /saved for a signed-out visitor, whose list lives in their
 * browser. RLS still applies, so an id for a hidden product or a
 * lapsed shop simply drops out of the result.
 */
export async function getProductsByIds(env, ids) {
  if (!ids.length) return [];
  const rows = await get(env, 'products', {
    select: SELECT_CARD,
    id: `in.(${ids.join(',')})`,
    status: 'eq.active',
    limit: ids.length,
  });

  const byId = new Map(rows.map((r) => [r.id, toCard(r)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/* ---------------------------------------------------------------
   view counting
   --------------------------------------------------------------- */

/**
 * An opaque per-visitor, per-day token.
 *
 * The IP never leaves the Worker: what goes to the database is a hash
 * of it with the date and a salt, so the counter can tell one visitor
 * from another without storing anything that identifies them, and a
 * token stops being usable at midnight.
 */
export async function viewToken(request, env) {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    '';
  if (!ip) return null;

  const salt = env.VIEW_SALT || env.SUPABASE_URL || '';
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${ip}|${day}|${salt}`),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Count one page view. Fire-and-forget: a counter is never a reason to
 * make a seller's page slower, or to fail it.
 *
 * The rate limiting is the database's job — record_view ignores a
 * repeat token, a missing one, and anything not publicly visible.
 */
export async function recordView(env, { shop = null, product = null, token }) {
  if (!token) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_view`, {
      method: 'POST',
      headers: { ...headers(env), 'content-type': 'application/json' },
      body: JSON.stringify({ p_shop: shop, p_product: product, p_token: token }),
    });
  } catch {
    /* a lost view is not worth an error page */
  }
}

/** A shop's own categories, for the chips on its public page. */
export async function getShopCategories(env, shopId) {
  return get(env, 'categories', {
    select: 'id,name,sort_order',
    shop_id: `eq.${shopId}`,
    order: 'sort_order.asc,name.asc',
    limit: 20,
  });
}
