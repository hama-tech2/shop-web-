/**
 * Products: list, add, edit, delete, and the image upload endpoint.
 *
 * The browser resizes and crops before uploading, but nothing it sends
 * is trusted here: the Worker re-checks the session, the shop, the magic
 * bytes, the size, the count, and — importantly — generates the R2 key
 * itself. A client can name a product draft, never an object.
 */

import {
  APP_NAME, DEFAULT_CURRENCY, FREE_IMAGE_LIMIT, FREE_PRODUCT_LIMIT, MAX_IMAGES,
  MAX_UPLOAD_BYTES, PRODUCT_CURRENCIES, PRODUCT as T, SUBSCRIPTION as S,
  DEFAULT_VISIBILITY, PRODUCT_VISIBILITY,
} from '../config.js';
import { layout } from '../render/layout.js';
import { productForm, trialLimitPage } from '../render/product-form.js';
import { accessGatePage } from '../render/subscription.js';
import { asUser, getCategories, rateLimitAllows, subscriptionState } from '../supabase.js';
import { getOwnShop, resolveSession, sameOrigin, setSessionCookies } from '../auth.js';
import { bodyTooLarge, uploadLimited, uploadRateAllows } from '../abuse.js';
import { redirect } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UPLOAD_REQUEST_BYTES = (MAX_UPLOAD_BYTES * 2) + (128 * 1024);

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
  'id,title,price,currency,visibility,description,status,platform_category_id,category_id,created_at,' +
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

  // Every route in this file shares this guard, so this one name is the
  // destination a stranger is sent back to after logging in. /app is the
  // seller's home now, and it is where all of them end up anyway.
  if (!user) return { redirect: redirect('/login?next=/app', headers) };
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
  if (!await uploadRateAllows(env, g.shop.id, rateLimitAllows)) return uploadLimited();
  if (bodyTooLarge(request, MAX_UPLOAD_REQUEST_BYTES)) {
    return Response.json({ error: 'size' }, { status: 413 });
  }

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

  const written = await Promise.allSettled([
    env.IMAGES.put(cardKey, card.buffer, { httpMetadata: { contentType: card.type } }),
    env.IMAGES.put(fullKey, full.buffer, { httpMetadata: { contentType: full.type } }),
  ]);
  if (written.some((result) => result.status === 'rejected')) {
    await Promise.allSettled([env.IMAGES.delete(cardKey), env.IMAGES.delete(fullKey)]);
    return Response.json({ error: 'upload' }, {
      status: 503, headers: { 'cache-control': 'no-store' },
    });
  }

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
/**
 * The currency to store, or null if the browser sent something else.
 *
 * The form offers exactly two buttons, so a third value did not come
 * from a seller pressing anything — it came from a crafted post, and is
 * refused rather than quietly folded to IQD. Storing the wrong currency
 * silently is the one failure here that a seller could not see: the
 * number looks right, and it is the wrong money.
 *
 * Absent is not invalid. A form submitted from a page cached before
 * this shipped has no currency field at all, and that seller meant IQD,
 * which is what every product was until now. Only a value that is
 * present AND unrecognised is an error.
 *
 * The database repeats this check (products_currency_allowed), so a bug
 * here cannot write a third currency either.
 */
const parseCurrency = (raw) => {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_CURRENCY;
  const value = String(raw).trim();
  return Object.hasOwn(PRODUCT_CURRENCIES, value) ? value : null;
};

/**
 * Where the seller chose to show this product, or null if the browser
 * sent something else.
 *
 * Absent is not invalid: a form cached before this shipped has no
 * visibility field, and that seller meant "everyone", which is what
 * every product was until now. Only a value that is present AND
 * unrecognised is refused — the same rule parseCurrency uses, and for
 * the same reason: quietly folding an unknown value to a default hides
 * a bug that the seller would never see.
 *
 * The database repeats this check (products_visibility_allowed).
 */
const parseVisibility = (raw) => {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_VISIBILITY;
  const value = String(raw).trim();
  return Object.hasOwn(PRODUCT_VISIBILITY, value) ? value : null;
};

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

/** Existing shop-category support remains available outside this form. */
async function ownCategories(env, token, shopId) {
  const res = await asUser(env, token, 'categories', {
    search: { select: 'id,name', shop_id: `eq.${shopId}`,
              order: 'sort_order.asc,name.asc', limit: '20' },
  });
  return res.ok ? res.data ?? [] : [];
}

/** Validate a legacy shop-category value without trusting the browser. */
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
  const currency = parseCurrency(f.currency);
  const visibility = parseVisibility(f.visibility);
  const ownCategory = await ownCategoryIdFor(env, token, shopId, f.own_category);

  const values = {
    title: (f.title || '').replace(/\s+/g, ' ').trim(),
    price: f.price || '',
    // Redrawn with what the seller picked, not with the default: being
    // sent back over a missing image should not silently reset a price
    // in dollars to one in dinars.
    currency: currency ?? DEFAULT_CURRENCY,
    // Redrawn with what the seller picked, not with the default.
    visibility: visibility ?? DEFAULT_VISIBILITY,
    description: (f.description || '').trim(),
    category: f.category || '',
    status: f.status === 'hidden' ? 'hidden' : 'active',
    ownCategory: ownCategory ?? '',
    images: images || [],
  };

  // Exactly three things are required to publish: an image, a name and
  // a price. Marketplace category, legacy shop category and description are optional and
  // must never block. Each failure names its own field.
  if (!images) return { error: picked.error, values };
  if (values.title.length < 2 || values.title.length > 200) {
    return { error: T.errTitle, values };
  }
  if (price === null || price > 999999999) return { error: T.errPrice, values };
  if (currency === null) return { error: T.errCurrency, values };
  if (visibility === null) return { error: T.errVisibility, values };

  return {
    values,
    row: {
      title: values.title,
      price,
      currency,
      visibility,
      description: values.description || null,
      status: values.status,
      // An unknown market slug resolves to null rather than an error:
      // it is optional and must not block.
      platform_category_id: await categoryIdFor(env, values.category),
      category_id: ownCategory,
    },
    images,
  };
}

/**
 * An edit is deliberately smaller than a publish. Read the stored row
 * first, then accept only the four approved changes: title, marketplace
 * category, visibility, and which retained image is the cover (with at
 * most one replacement when that cover is re-cropped).
 */
async function readEditForm(request, shopId, productId, product, categories) {
  const f = await form(request);
  const picked = cleanImages(f.images, shopId, productId);
  const images = picked.images ?? null;
  const original = toValues(product, categories);
  const visibility = parseVisibility(f.visibility);
  const values = {
    ...original,
    title: (f.title || '').replace(/\s+/g, ' ').trim(),
    category: f.category || '',
    visibility: visibility ?? original.visibility,
    images: images || [],
  };

  if (!images) return { error: picked.error, values };
  if (visibility === null) return { error: T.errVisibility, values };
  if (values.title.length < 2 || values.title.length > 200) {
    return { error: T.errTitle, values };
  }

  // Cover selection may reorder the stored gallery. Re-cropping may
  // replace one pair of keys, but the restricted editor cannot add or
  // remove gallery items.
  const before = original.images.map((image) => `${image.card}\n${image.full || ''}`);
  const after = images.map((image) => `${image.card}\n${image.full || ''}`);
  const retained = before.filter((key) => after.includes(key)).length;
  if (after.length !== before.length || before.length - retained > 1) {
    return { error: T.errNoImage, values: { ...values, images: original.images } };
  }

  return {
    values,
    row: {
      title: values.title,
      // Where it shows is the seller's to change; what it costs is not.
      // Price, currency and status still never leave this editor.
      visibility,
      platform_category_id: categories.find((c) => c.slug === values.category)?.id ?? null,
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
                    values: parsed.values, error: S.freeImageOnly(FREE_IMAGE_LIMIT),
                    trialLeft: left }),
      T.newTitle, g.headers,
    );
  }

  if (parsed.error) {
    return page(
      productForm({ mode: 'new', draftId, categories,
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
  // There is no longer a separate management list to choose instead:
  // /app is the only seller-facing list of these products, and this is
  // it.
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
  title: product.title,
  price: String(product.price ?? ''),
  // A product written before the column existed has no currency to
  // load; it was in dinars, so that is what the form opens on.
  currency: product.currency ?? DEFAULT_CURRENCY,
  // A product written before the column existed was shown to everyone,
  // so that is what its form opens on.
  visibility: product.visibility ?? DEFAULT_VISIBILITY,
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
  // A malformed id, or one that is gone or belongs to somebody else.
  // Both land on /app: the seller's own shop, where they can see what
  // they do have rather than an error about what they do not.
  if (!UUID.test(id)) return redirect('/app', g.headers);

  const product = await loadProduct(env, g.token, id);
  if (!product) return redirect('/app', g.headers);

  const categories = await getCategories(env);
  const { tier } = await entitlement(env, g.token, g.shop.id);
  return page(
    productForm({ mode: 'edit', draftId: id, categories,
                  values: toValues(product, categories), imageLimit: tier === 'paid' ? MAX_IMAGES : FREE_IMAGE_LIMIT }),
    T.editTitle, g.headers,
  );
}

export async function editPost(request, env, id) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;
  if (!UUID.test(id)) return redirect('/app', g.headers);

  const product = await loadProduct(env, g.token, id);
  if (!product) return redirect('/app', g.headers);

  const categories = await getCategories(env);
  const parsed = await readEditForm(request, g.shop.id, id, product, categories);
  const { tier } = await entitlement(env, g.token, g.shop.id);
  const imageLimit = tier === 'paid' ? MAX_IMAGES : FREE_IMAGE_LIMIT;

  if (parsed.error) {
    return page(
      productForm({ mode: 'edit', draftId: id, categories,
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
                    values: parsed.values, error, imageLimit }),
      T.editTitle, g.headers,
    );
  }

  await asUser(env, g.token, 'rpc/save_product_images', {
    method: 'POST',
    body: { p_product: id, p_images: parsed.images },
  });

  // Saved. Back to the shop the edit was made to, in owner mode —
  // the same destination publishing uses, for the same reason.
  return redirect('/app', g.headers);
}

/* ============================================================
   delete — the cascade fires the trigger that queues every R2 key
   ============================================================ */

export async function deletePost(request, env, id) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;
  if (!UUID.test(id)) return redirect('/app', g.headers);

  const removed = await asUser(env, g.token, 'products', {
    method: 'DELETE',
    search: { id: `eq.${id}`, shop_id: `eq.${g.shop.id}` },
    prefer: AFFECTED,
  });

  // Nothing was removed: already deleted in another tab, or not this
  // seller's to delete. Either way say so on /app rather than silently
  // reporting success — public/js/owner-profile.js reads the ?e back
  // off the redirect to decide whether to take the card off the screen.
  if (!removed.ok || affected(removed) === 0) {
    return redirect('/app?e=errGone', g.headers);
  }
  return redirect('/app', g.headers);
}

/* ============================================================
   /app/products is retired

   It listed the seller's products on a screen of its own, which /app
   already does — with the same products, the same add button and the
   same per-product delete. Two screens over one list is one too many
   to keep in step, and the second one was where a seller got stranded:
   every "back" in this file used to point at it.

   worker/index.js answers the address with a redirect to /app. Only
   /app/products/<id> survives, as the edit form's own URL.
   ============================================================ */
