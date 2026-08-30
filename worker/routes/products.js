/**
 * Products: list, add, edit, delete, and the image upload endpoint.
 *
 * The browser resizes and crops before uploading, but nothing it sends
 * is trusted here: the Worker re-checks the session, the shop, the magic
 * bytes, the size, the count, and — importantly — generates the R2 key
 * itself. A client can name a product draft, never an object.
 */

import {
  APP_NAME, MAX_IMAGES, MAX_UPLOAD_BYTES, PRODUCT as T, PRODUCT_FILTERS,
} from '../config.js';
import { layout } from '../render/layout.js';
import { productForm } from '../render/product-form.js';
import { productList } from '../render/product-list.js';
import { asUser, getCategories } from '../supabase.js';
import { getOwnShop, resolveSession, sameOrigin, setSessionCookies } from '../auth.js';
import { redirect } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRODUCT_SELECT =
  'id,title,price,description,status,platform_category_id,category_id,created_at,' +
  'product_images(r2_key,r2_key_full,position)';

function page(body, title, headers) {
  const h = new Headers(headers || undefined);
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(
    layout({ title: `${title} — ${APP_NAME}`, description: APP_NAME, body,
             scripts: ['/js/crop.js', '/js/product.js'] }),
    { headers: h },
  );
}

/** Every route here needs a signed-in seller who owns a shop. */
async function guard(request, env) {
  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);

  if (!user) return { redirect: redirect('/login?next=/app/products', headers) };
  const shop = await getOwnShop(env, token);
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
   image upload
   ============================================================ */

/**
 * Trust the bytes, not the Content-Type header. An SVG — or anything
 * else that is not one of these three — falls through and is refused.
 */
function sniff(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

async function readImage(file) {
  if (!file || typeof file === 'string') return { error: 'missing' };
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return { error: 'size' };

  const buffer = await file.arrayBuffer();
  const type = sniff(buffer.slice(0, 12));
  if (!type) return { error: 'type' };

  return { buffer, type };
}

export async function uploadPost(request, env) {
  if (!sameOrigin(request)) return Response.json({ error: 'origin' }, { status: 403 });

  const g = await guard(request, env);
  if (g.redirect) return Response.json({ error: 'auth' }, { status: 401 });

  let data;
  try {
    data = await request.formData();
  } catch {
    return Response.json({ error: 'form' }, { status: 400 });
  }

  const draft = String(data.get('draft_id') || '');
  if (!UUID.test(draft)) return Response.json({ error: 'draft' }, { status: 400 });

  const card = await readImage(data.get('card'));
  const full = await readImage(data.get('full'));
  if (card.error || full.error) {
    return Response.json({ error: card.error || full.error }, { status: 400 });
  }

  // The prefix is derived from the session's shop, never from the client.
  const prefix = `products/${g.shop.id}/${draft}/`;

  // R2 is the authority on how many images this draft already has —
  // the rows do not exist yet while a product is being composed.
  const listed = await env.IMAGES.list({ prefix, limit: 40 });
  const stored = listed.objects.filter((o) => o.key.endsWith('-card.webp')).length;
  if (stored >= MAX_IMAGES) return Response.json({ error: 'limit' }, { status: 409 });

  const name = crypto.randomUUID();
  const cardKey = `${prefix}${name}-card.webp`;
  const fullKey = `${prefix}${name}-full.webp`;

  await Promise.all([
    env.IMAGES.put(cardKey, card.buffer, { httpMetadata: { contentType: card.type } }),
    env.IMAGES.put(fullKey, full.buffer, { httpMetadata: { contentType: full.type } }),
  ]);

  return Response.json({ card: cardKey, full: fullKey, url: `/img/${cardKey}` },
                       { headers: { 'cache-control': 'no-store' } });
}

/* ============================================================
   shared form handling
   ============================================================ */

const parsePrice = (raw) => {
  const digits = String(raw || '').replace(/[^\d.]/g, '');
  const value = Number(digits);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
};

/** Only keys this shop and this product could legitimately own. */
function cleanImages(raw, shopId, productId) {
  let list;
  try { list = JSON.parse(raw || '[]'); } catch { return null; }
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_IMAGES) return null;

  const prefix = `products/${shopId}/${productId}/`;
  const out = [];
  for (const item of list) {
    const card = String(item?.card || '');
    const full = String(item?.full || '');
    if (!card.startsWith(prefix) || card.includes('..')) return null;
    if (full && (!full.startsWith(prefix) || full.includes('..'))) return null;
    out.push({ card, full: full || null });
  }
  return out;
}

async function categoryIdFor(env, slug) {
  if (!slug) return null;
  const categories = await getCategories(env);
  return categories.find((c) => c.slug === slug)?.id ?? null;
}

/** The seller's own categories, for the picker on the form. */
async function ownCategories(env, token, shopId) {
  const res = await asUser(env, token, 'categories', {
    search: { select: 'id,name', shop_id: `eq.${shopId}`,
              order: 'sort_order.asc,name.asc', limit: '20' },
  });
  return res.ok ? res.data ?? [] : [];
}

async function readForm(request, env, shopId, productId) {
  const f = await form(request);
  const images = cleanImages(f.images, shopId, productId);
  const price = parsePrice(f.price);

  const values = {
    title: (f.title || '').replace(/\s+/g, ' ').trim(),
    price: f.price || '',
    description: (f.description || '').trim(),
    category: f.category || '',
    status: f.status === 'hidden' ? 'hidden' : 'active',
    ownCategory: UUID.test(String(f.own_category || '')) ? f.own_category : '',
    images: images || [],
  };

  if (!images) return { error: T.errNoImage, values };
  if (values.title.length < 2 || values.title.length > 200) {
    return { error: T.errTitle, values };
  }
  if (price === null || price > 999999999) return { error: T.errPrice, values };

  return {
    values,
    row: {
      title: values.title,
      price,
      description: values.description || null,
      status: values.status,
      platform_category_id: await categoryIdFor(env, values.category),
      // A category belonging to another shop is rejected by the
      // products_category_same_shop trigger, so an id from the form is
      // safe to pass straight through.
      category_id: values.ownCategory || null,
    },
    images,
  };
}

/* ============================================================
   /app/new
   ============================================================ */

export async function newGet(request, env) {
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;

  return page(
    productForm({
      mode: 'new',
      draftId: crypto.randomUUID(),
      categories: await getCategories(env),
      shopCategories: await ownCategories(env, g.token, g.shop.id),
      values: { status: 'active', images: [] },
    }),
    T.newTitle, g.headers,
  );
}

export async function newPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;

  const raw = await request.clone().formData();
  const draftId = String(raw.get('draft_id') || '');
  if (!UUID.test(draftId)) return redirect('/app/new', g.headers);

  const parsed = await readForm(request, env, g.shop.id, draftId);
  const categories = await getCategories(env);

  if (parsed.error) {
    return page(
      productForm({ mode: 'new', draftId, categories,
                    shopCategories: await ownCategories(env, g.token, g.shop.id),
                    values: parsed.values, error: parsed.error }),
      T.newTitle, g.headers,
    );
  }

  const created = await asUser(env, g.token, 'products', {
    method: 'POST',
    prefer: 'return=representation',
    body: { id: draftId, shop_id: g.shop.id, ...parsed.row },
  });

  if (!created.ok) {
    return page(
      productForm({ mode: 'new', draftId, categories,
                    shopCategories: await ownCategories(env, g.token, g.shop.id),
                    values: parsed.values, error: T.errSave }),
      T.newTitle, g.headers,
    );
  }

  const saved = await asUser(env, g.token, 'rpc/save_product_images', {
    method: 'POST',
    body: { p_product: draftId, p_images: parsed.images },
  });

  if (!saved.ok) {
    // The product exists but has no gallery; send them to edit rather
    // than leaving a half-made row behind with no way back to it.
    return redirect(`/app/products/${draftId}`, g.headers);
  }

  return redirect('/app/products', g.headers);
}

/* ============================================================
   /app/products/<id> — edit
   ============================================================ */

async function loadProduct(env, token, id) {
  const res = await asUser(env, token, 'products', {
    search: { select: PRODUCT_SELECT, id: `eq.${id}`, limit: '1' },
  });
  return res.ok ? res.data?.[0] ?? null : null;
}

const toValues = (product, categories) => ({
  ownCategory: product.category_id ?? '',
  title: product.title,
  price: String(product.price ?? ''),
  description: product.description ?? '',
  status: product.status === 'hidden' ? 'hidden' : product.status,
  category: categories.find((c) => c.id === product.platform_category_id)?.slug ?? '',
  images: (product.product_images ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((i) => ({ card: i.r2_key, full: i.r2_key_full })),
});

export async function editGet(request, env, id) {
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;
  if (!UUID.test(id)) return redirect('/app/products', g.headers);

  const product = await loadProduct(env, g.token, id);
  if (!product) return redirect('/app/products', g.headers);

  const categories = await getCategories(env);
  return page(
    productForm({ mode: 'edit', draftId: id, categories,
                  shopCategories: await ownCategories(env, g.token, g.shop.id),
                  values: toValues(product, categories) }),
    T.editTitle, g.headers,
  );
}

export async function editPost(request, env, id) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;
  if (!UUID.test(id)) return redirect('/app/products', g.headers);

  const parsed = await readForm(request, env, g.shop.id, id);
  const categories = await getCategories(env);

  if (parsed.error) {
    return page(
      productForm({ mode: 'edit', draftId: id, categories,
                    shopCategories: await ownCategories(env, g.token, g.shop.id),
                    values: parsed.values, error: parsed.error }),
      T.editTitle, g.headers,
    );
  }

  const updated = await asUser(env, g.token, 'products', {
    method: 'PATCH',
    search: { id: `eq.${id}` },
    body: parsed.row,
  });
  if (!updated.ok) {
    return page(
      productForm({ mode: 'edit', draftId: id, categories,
                    shopCategories: await ownCategories(env, g.token, g.shop.id),
                    values: parsed.values, error: T.errSave }),
      T.editTitle, g.headers,
    );
  }

  await asUser(env, g.token, 'rpc/save_product_images', {
    method: 'POST',
    body: { p_product: id, p_images: parsed.images },
  });

  return redirect('/app/products', g.headers);
}

/* ============================================================
   delete — the cascade fires the trigger that queues every R2 key
   ============================================================ */

export async function deletePost(request, env, id) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;
  if (!UUID.test(id)) return redirect('/app/products', g.headers);

  await asUser(env, g.token, 'products', { method: 'DELETE', search: { id: `eq.${id}` } });
  return redirect('/app/products', g.headers);
}

/* ============================================================
   /app/products — the list
   ============================================================ */

export async function listGet(request, env, url) {
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;

  const key = url.searchParams.get('filter') || 'all';
  const filter = PRODUCT_FILTERS.find((f) => f.key === key) ?? PRODUCT_FILTERS[0];

  const search = {
    select: PRODUCT_SELECT,
    shop_id: `eq.${g.shop.id}`,
    order: 'created_at.desc',
    limit: '100',
  };
  if (filter.status) search.status = `eq.${filter.status}`;

  const res = await asUser(env, g.token, 'products', { search });

  return page(
    productList({ products: res.ok ? res.data ?? [] : [], filter: filter.key }),
    T.listTitle, g.headers,
  );
}
