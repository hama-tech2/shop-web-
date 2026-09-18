/**
 * Supabase data access for the Worker.
 *
 * Reads go through PostgREST with the PUBLISHABLE key only. Row Level
 * Security is what protects the data, so the anon role already sees
 * exactly the right rows: active products of active, non-expired shops.
 * Ordinary reads and seller writes never use service_role. The one
 * narrow exception below is the rate-limit RPC helper: it calls only a
 * named service-only limiter, returns a boolean, and never exposes the
 * credential to a response or browser.
 */

import { DEFAULT_VISIBILITY } from './config.js';

const SELECT_CARD =
  'id,title,price,currency,created_at,platform_category_id,category_id,' +
  'shops!inner(name,slug,logo_key,whatsapp,phone,maps_url),' +
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
        // The marketplace feed shows what the seller pointed at it.
        // A profile-only product is still active and still public — it
        // just does not belong on somebody else's home screen.
        visibility: `eq.${DEFAULT_VISIBILITY}`,
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
    // Read beside the price, always. A number on its own does not say
    // what it is, and every view that shows one has to render both.
    currency: row.currency,
    categoryId: row.platform_category_id ?? null,
    ownCategoryId: row.category_id ?? null,
    images: images.length ? images : [null],
    shopName: row.shops?.name ?? '',
    shopSlug: row.shops?.slug ?? '',
    shopLogo: row.shops?.logo_key ?? null,
    shopWhatsapp: row.shops?.whatsapp || row.shops?.phone || null,
    shopMapsUrl: row.shops?.maps_url ?? null,
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

/**
 * What the server says this shop's plan allows, right now.
 *
 * One read, used by every screen that has to decide whether a seller
 * may post: the product form, the form's own POST, and the account
 * card. `can_publish` and `trial_available` are computed in the
 * database and are never anything the browser sends.
 */
export async function subscriptionState(env, token, shopId) {
  const res = await asUser(env, token, 'rpc/subscription_state', {
    method: 'POST', body: { p_shop: shopId },
  });
  return res.ok ? res.data?.[0] ?? null : null;
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
      'id,title,price,currency,description,status,shop_id,platform_category_id,category_id,' +
      'platform_categories(name_ckb),categories(name),' +
      'shops!inner(id,name,slug,logo_key,whatsapp,city,maps_url),' +
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
    currency: row.currency,
    description: row.description ?? '',
    categoryId: row.platform_category_id,
    ownCategoryId: row.category_id,
    category: row.categories?.name || row.platform_categories?.name_ckb || null,
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
   sitemap
   --------------------------------------------------------------- */

/**
 * Every shop a stranger can open, for sitemap.xml.
 *
 * No status filter and no join: RLS on `shops` for the anon role is
 * already `app.shop_is_public(id)`, so the rows that come back are
 * exactly the ones /@slug will render. Adding a second rule here is how
 * a sitemap starts listing pages that 404.
 */
async function publicRows(env, path, search, maximum) {
  const rows = [];
  const pageSize = 1000;
  while (rows.length < maximum) {
    const limit = Math.min(pageSize, maximum - rows.length);
    const page = await get(env, path, { ...search, limit, offset: rows.length });
    rows.push(...page);
    if (page.length < limit) break;
  }
  return rows;
}

export async function publicShops(env, limit = 49999) {
  return publicRows(env, 'shops', {
    select: 'id,slug,updated_at',
    order: 'updated_at.desc',
  }, limit);
}

/** Every publicly visible product, as the two fields a URL needs. */
export async function publicProductRefs(env, limit = 49999) {
  return publicRows(env, 'products', {
    select: 'id,shop_id,updated_at',
    status: 'eq.active',
    order: 'updated_at.desc',
  }, limit);
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
 * The key a rate limit counts against: one client, opaquely.
 *
 * Deliberately stricter than viewToken above, because this one is a
 * security control rather than a counter:
 *
 *   * cf-connecting-ip ONLY. viewToken also accepts x-forwarded-for,
 *     which the caller sets — harmless when miscounting a page view,
 *     useless in a limiter, because an attacker would simply send a
 *     fresh one per request and get a fresh allowance with it.
 *   * VIEW_SALT is required. Falling back to SUPABASE_URL would salt
 *     with a value that is printed in the page source, so anyone could
 *     compute another address's key. The caller decides what to do when
 *     this returns null; it does not quietly carry on.
 *
 * What comes back is a SHA-256 hash. The address itself never leaves
 * the Worker and is never stored.
 */
export async function clientRateKey(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const salt = env.VIEW_SALT || '';
  if (!ip || !salt) return null;

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`rate|${ip}|${salt}`),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ask the database whether this client may do the thing.
 *
 * Fails closed: no key, no service credential, or an unreachable
 * database all mean "no". A limiter that opens when it breaks is not a
 * limiter, and the one moment it is most likely to break is the one
 * when somebody is hammering it.
 */
export async function rateLimitAllows(env, rpc, key) {
  if (!key) return false;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) return false;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        apikey: service,
        authorization: `Bearer ${service}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_key: key }),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
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
