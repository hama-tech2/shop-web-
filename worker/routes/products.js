/**
 * Products: list, add, edit, delete, and the image upload endpoint.
 *
 * The browser resizes and crops before uploading, but nothing it sends
 * is trusted here: the Worker re-checks the session, the shop, the magic
 * bytes, the size, the count, and — importantly — generates the R2 key
 * itself. A client can name a product draft, never an object.
 */

import {
  APP_NAME, FREE_IMAGE_LIMIT, FREE_PRODUCT_LIMIT, MAX_IMAGES, MAX_UPLOAD_BYTES,
  PRODUCT as T, SUBSCRIPTION as S,
} from '../config.js';
import { layout } from '../render/layout.js';
import { productForm, trialLimitPage } from '../render/product-form.js';
import { accessGatePage } from '../render/subscription.js';
import { productList } from '../render/product-list.js';
import { asUser, getCategories, subscriptionState } from '../supabase.js';
import { getOwnShop, resolveSession, sameOrigin, setSessionCookies } from '../auth.js';
import { redirect } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST answers 200 with an empty body when a write matches no
 * rows, so "ok" alone cannot tell a successful edit from one RLS threw
 * away. Asking for the representation makes the affected rows the
 * answer: zero of them means nothing changed, and the seller has to be
 * told rather than shown a success screen over an unchanged product.
 */
const AFFECTED = 'return=representation';
const affected = (res) => (res.ok && Array.isArray(res.data) ? res.data.length : 0);

const PRODUCT_SELECT =
  'id,title,price,description,status,platform_category_id,category_id,created_at,' +
  'product_images(r2_key,r2_key_full,position)';

function page(body, title, headers, scripts = ['/js/crop.js', '/js/product.js']) {
  const h = new Headers(headers || undefined);
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(
    layout({ title: `${title} — ${APP_NAME}`, description: APP_NAME, body, scripts }),
    { headers: h },
  );
}

/**
 * The plan gate, which is a billing screen that happens to be reached
 * from here. It wants the checkout script — the dinar figure and the
 * guard against a second tap — not the cropper.
 */
const gatePage = (body, headers) => page(body, S.gateTitle, headers, ['/js/checkout.js']);

/** Every route here needs a signed-in seller who owns a shop. */
async function guard(request, env) {
  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);

  if (!user) return { redirect: redirect('/login?next=/app/products', headers) };
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

/**
 * A price, or null if there isn't one.
 *
 * Two things this has to get right for a Sorani seller:
 *
 *  - Arabic-Indic digits. A seller in Erbil types ٢٥٠٠٠ as readily as
 *    25000. The client folds them, but the server cannot assume the
 *    client ran, and rejecting them reads as "your price is invalid".
 *  - An empty or non-numeric value. Stripping non-digits turns '',
 *    'abc' and '-5' into '', and Number('') is 0 — which used to
 *    publish the product at 0 IQD rather than asking for a price.
 *
 * A price must be a positive number: nothing here is free, and a
 * negative one is a typo, not a discount.
 */
const parsePrice = (raw) => {
  const text = String(raw ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .trim();

  if (/^-/.test(text)) return null;

  const digits = text.replace(/[^\d.]/g, '');
  if (!/\d/.test(digits)) return null;

  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
};

/**
 * Only keys this shop and this product could legitimately own.
 *
 * Returns { images } or { error }. A single null could not tell "you
 * sent no image" from "you sent six", and the seller was shown the
 * add-an-image message either way.
 */
function cleanImages(raw, shopId, productId) {
  let list;
  try { list = JSON.parse(raw || '[]'); } catch { return { error: T.errNoImage }; }
  if (!Array.isArray(list) || list.length === 0) return { error: T.errNoImage };
  if (list.length > MAX_IMAGES) return { error: T.onlyMax };

  const prefix = `products/${shopId}/${productId}/`;
  const out = [];
  for (const item of list) {
    const card = String(item?.card || '');
    const full = String(item?.full || '');
    if (!card.startsWith(prefix) || card.includes('..')) return { error: T.errNoImage };
    if (full && (!full.startsWith(prefix) || full.includes('..'))) return { error: T.errNoImage };
    out.push({ card, full: full || null });
  }
  return { images: out };
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

/**
 * The shop category the seller picked, or null.
 *
 * The id comes from a <select> the browser has been holding, sometimes
 * for a long time: the category may have been renamed, deleted from the
 * owner profile in another tab, or the option may be left over from a
 * bfcache restore. Passing that id on made `check_category_same_shop`
 * raise 23514, which surfaced as the generic "پاشەکەوتکردن سەرکەوتوو
 * نەبوو" — a category, which is optional, blocking a publish.
 *
 * So it is checked here against the seller's real categories and simply
 * dropped when it is not one of them. An optional field must never be
 * the reason a product does not go out.
 */
async function ownCategoryIdFor(env, token, shopId, raw) {
  const id = String(raw || '');
  if (!UUID.test(id)) return null;
  const own = await ownCategories(env, token, shopId);
  return own.some((c) => c.id === id) ? id : null;
}

/**
 * How many products this shop may still publish, or null on a paid plan.
 *
 * The database refuses the insert either way — app.enforce_trial_product_limit
 * raises SW001 — but a seller meeting a bare refusal after preparing five
 * images has been wasted. Asking first is what lets the screen say the
 * limit before any of that work happens.
 */
async function trialSlotsLeft(env, token, shopId) {
  const res = await asUser(env, token, 'rpc/product_slots_left', {
    method: 'POST', body: { p_shop: shopId },
  });
  if (!res.ok) return null;
  const value = Array.isArray(res.data) ? res.data[0] : res.data;
  return typeof value === 'number' ? value : null;
}

/**
 * Which side of the line this shop is on, and how much room it has.
 *
 * `tier` is 'paid' or 'free'. `slotsLeft` is how many more products a
 * Free shop may have and is null on a paid plan, where the only ceiling
 * is the 1000-per-shop one. Both come from the database, which is also
 * what refuses the write: app.enforce_free_product_limit raises SW001
 * when Free is full. This is what turns a bare refusal into a screen
 * with a way out of it.
 */
async function entitlement(env, token, shopId) {
  const state = await subscriptionState(env, token, shopId);
  return {
    tier: state?.tier === 'paid' ? 'paid' : 'free',
    canPublish: Boolean(state?.can_publish),
    slotsLeft: Number.isInteger(state?.slots_left) ? state.slots_left : null,
  };
}

/** The database's own word for "the Free plan is full". */
const FREE_FULL = (res) => res.data?.code === 'SW001';

/** And for "this shop is suspended", which outranks any plan. */
const SUSPENDED = (res) => res.data?.code === 'SW005';

/**
 * And for "five are already public".
 *
 * Only an edit can meet this one: a Free shop that lapsed from a paid
 * plan keeps everything it had, with five of them up and the rest
 * hidden, and putting a sixth back is the one thing it may not do.
 */
const PUBLIC_FULL = (res) => res.data?.code === 'SW007';

async function readForm(request, env, token, shopId, productId) {
  const f = await form(request);
  const picked = cleanImages(f.images, shopId, productId);
  const images = picked.images ?? null;
  const price = parsePrice(f.price);
  const ownCategory = await ownCategoryIdFor(env, token, shopId, f.own_category);

  const values = {
    title: (f.title || '').replace(/\s+/g, ' ').trim(),
    price: f.price || '',
    description: (f.description || '').trim(),
    category: f.category || '',
    status: f.status === 'hidden' ? 'hidden' : 'active',
    // Redrawing the form with an id that no longer exists would offer
    // the seller a category that is not there. Show "none" instead.
    ownCategory: ownCategory ?? '',
    images: images || [],
  };

  // Exactly three things are required to publish: an image, a name and
  // a price. Category, shop category and description are optional and
  // must never block. Each failure names its own field.
  if (!images) return { error: picked.error, values };
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
      // An unknown market slug resolves to null rather than an error:
      // like the shop category, it is optional and must not block.
      platform_category_id: await categoryIdFor(env, values.category),
      category_id: ownCategory,
    },
    images,
  };
}

/* ============================================================
   /app/new
   ============================================================ */

export async function newGet(request, env, url) {
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;

  // A paid seller goes straight to the form. A Free one meets the plan
  // gate on the way in, every time, and comes back through it with
  // ?plan=free once they have chosen to carry on for nothing.
  //
  // That parameter skips a screen and nothing else. It grants no slot:
  // the count below and the database behind it are what decide.
  const { tier, canPublish, slotsLeft } = await entitlement(env, g.token, g.shop.id);
  const chosenFree = url?.searchParams?.get('plan') === 'free';
  if (tier !== 'paid' && (!canPublish || !chosenFree)) {
    return gatePage(
      accessGatePage({
        trialAvailable: canPublish,
        slotsLeft,
        error: canPublish ? null : S.freeFull(FREE_PRODUCT_LIMIT),
      }),
      g.headers,
    );
  }

  // Full, and somehow still here: the reason, and a way out of it,
  // rather than a form whose submit button cannot work.
  const left = slotsLeft ?? await trialSlotsLeft(env, g.token, g.shop.id);
  if (left === 0) return page(trialLimitPage(), T.trialLimitTitle, g.headers);

  return page(
    productForm({
      mode: 'new',
      draftId: crypto.randomUUID(),
      categories: await getCategories(env),
      shopCategories: await ownCategories(env, g.token, g.shop.id),
      values: { status: 'active', images: [] },
      trialLeft: left,
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

  // Checked again on the way in. A form left open while the last slot
  // went, in another tab or on another phone, must not post through it.
  const { tier, canPublish, slotsLeft } = await entitlement(env, g.token, g.shop.id);
  if (!canPublish) {
    return gatePage(
      accessGatePage({ trialAvailable: false, error: S.freeFull(FREE_PRODUCT_LIMIT) }),
      g.headers,
    );
  }

  const parsed = await readForm(request, env, g.token, g.shop.id, draftId);
  const categories = await getCategories(env);
  const left = slotsLeft ?? await trialSlotsLeft(env, g.token, g.shop.id);

  if (left === 0) return page(trialLimitPage(), T.trialLimitTitle, g.headers);

  // One image on Free. The database refuses the second either way; this
  // is so the seller is told which rule they met, with their form still
  // filled in, rather than meeting a save error.
  if (tier !== 'paid' && (parsed.values?.images?.length ?? 0) > FREE_IMAGE_LIMIT) {
    return page(
      productForm({ mode: 'new', draftId, categories,
                    shopCategories: await ownCategories(env, g.token, g.shop.id),
                    values: parsed.values, error: S.freeImageOnly(FREE_IMAGE_LIMIT),
                    trialLeft: left }),
      T.newTitle, g.headers,
    );
  }

  if (parsed.error) {
    return page(
      productForm({ mode: 'new', draftId, categories,
                    shopCategories: await ownCategories(env, g.token, g.shop.id),
                    values: parsed.values, error: parsed.error, trialLeft: left }),
      T.newTitle, g.headers,
    );
  }

  const created = await asUser(env, g.token, 'products', {
    method: 'POST',
    prefer: 'return=representation',
    body: { id: draftId, shop_id: g.shop.id, ...parsed.row },
  });

  if (!created.ok) {
    // The database is the one that actually enforces both limits, and it
    // can refuse a request that looked fine a moment earlier — another
    // tab, a slot used between the check and the insert, or a suspension
    // that landed in between.
    if (SUSPENDED(created)) {
      return gatePage(accessGatePage({ trialAvailable: false, error: S.errSuspended }),
                      g.headers);
    }
    if (FREE_FULL(created)) {
      return page(trialLimitPage(), T.trialLimitTitle, g.headers);
    }
    return page(
      productForm({ mode: 'new', draftId, categories,
                    shopCategories: await ownCategories(env, g.token, g.shop.id),
                    values: parsed.values, error: T.errSave, trialLeft: left }),
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

  // Published, images and all. Back to the seller's own manager.
  //
  // This used to send them to /@slug/p/<id> so they could admire the
  // thing they had just posted. That is the customer's copy of the
  // page, and putting it at the end of an authenticated flow broke two
  // things at once. It renders with no owner controls, because nothing
  // under /@ knows who is looking — so the seller who had just
  // published was handed the anonymous view of their own product. And
  // it is served `public, s-maxage=120, stale-while-revalidate=600`,
  // where every screen inside /app is `no-store`: pressing Back walked
  // from the storefront to /@slug and sat the owner in a cached,
  // shared, customer view of their own shop with no way back into
  // owner mode except the navigation bar.
  //
  // A seller who has just posted does want to see their shop — but
  // through their own door, not the customer's. /app is that door: the
  // owner view of the shop, with its header, its owner-controls and its
  // products, never cached, and the public link one deliberate tap away
  // rather than somewhere they land by accident and cannot tell apart
  // from being logged out.
  //
  // Not /app/products: that is the management list, which is a place to
  // administer stock rather than to look at the shop you have just
  // added to. It is unchanged and still reachable.
  return redirect('/app', g.headers);
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
  const { tier } = await entitlement(env, g.token, g.shop.id);
  return page(
    productForm({ mode: 'edit', draftId: id, categories,
                  shopCategories: await ownCategories(env, g.token, g.shop.id),
                  values: toValues(product, categories), imageLimit: tier === 'paid' ? MAX_IMAGES : FREE_IMAGE_LIMIT }),
    T.editTitle, g.headers,
  );
}

export async function editPost(request, env, id) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;
  if (!UUID.test(id)) return redirect('/app/products', g.headers);

  const parsed = await readForm(request, env, g.token, g.shop.id, id);
  const categories = await getCategories(env);
  const { tier } = await entitlement(env, g.token, g.shop.id);
  const imageLimit = tier === 'paid' ? MAX_IMAGES : FREE_IMAGE_LIMIT;

  if (parsed.error) {
    return page(
      productForm({ mode: 'edit', draftId: id, categories,
                    shopCategories: await ownCategories(env, g.token, g.shop.id),
                    values: parsed.values, error: parsed.error, imageLimit }),
      T.editTitle, g.headers,
    );
  }

  const updated = await asUser(env, g.token, 'products', {
    method: 'PATCH',
    search: { id: `eq.${id}`, shop_id: `eq.${g.shop.id}` },
    prefer: AFFECTED,
    body: parsed.row,
  });

  // Zero rows is not success. The product was deleted in another tab,
  // or the id belongs to someone else and RLS refused it — either way
  // the images must not be written against it.
  //
  // A Free shop that is already showing five is its own case: nothing
  // is wrong with the edit, there is simply no room to make this one
  // public. Saying that, with the form still filled in, is the whole
  // difference between a seller who hides one and carries on and a
  // seller who thinks their product is gone.
  if (!updated.ok || affected(updated) === 0) {
    const error = PUBLIC_FULL(updated) ? T.errPublicFull(FREE_PRODUCT_LIMIT)
      : updated.ok ? T.errGone
      : T.errSave;
    return page(
      productForm({ mode: 'edit', draftId: id, categories,
                    shopCategories: await ownCategories(env, g.token, g.shop.id),
                    values: parsed.values, error, imageLimit }),
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

  const removed = await asUser(env, g.token, 'products', {
    method: 'DELETE',
    search: { id: `eq.${id}`, shop_id: `eq.${g.shop.id}` },
    prefer: AFFECTED,
  });

  if (!removed.ok || affected(removed) === 0) {
    return redirect('/app/products?e=errGone', g.headers);
  }
  return redirect('/app/products', g.headers);
}

/* ============================================================
   /app/products — the list
   ============================================================ */

export async function listGet(request, env, url) {
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;

  // One list, every product, visible and hidden together. Each row
  // carries its own status badge, so nothing is hidden from the seller
  // and there is no filter to get lost in.
  const res = await asUser(env, g.token, 'products', {
    search: {
      select: PRODUCT_SELECT,
      shop_id: `eq.${g.shop.id}`,
      order: 'created_at.desc',
      limit: '100',
    },
  });

  const errorKey = url.searchParams.get('e');
  const error = errorKey && T[errorKey] ? T[errorKey] : null;

  return page(
    productList({ products: res.ok ? res.data ?? [] : [], error }),
    T.listTitle, g.headers,
  );
}
