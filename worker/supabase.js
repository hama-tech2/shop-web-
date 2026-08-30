/**
 * Supabase data access for the Worker.
 *
 * Reads go through PostgREST with the PUBLISHABLE key only. Row Level
 * Security is what protects the data, so the anon role already sees
 * exactly the right rows: active products of active, non-expired shops.
 * The service_role key is never used here and must never reach this file.
 */

const SELECT_CARD =
  'id,title,price,created_at,platform_category_id,' +
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
