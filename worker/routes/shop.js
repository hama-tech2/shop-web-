/**
 * The public pages: /@slug and /@slug/p/<id>.
 *
 * These are the whole product. A seller pastes the link into TikTok or
 * a WhatsApp message, so the HTML must be complete and the Open Graph
 * tags must be right on the very first byte — a crawler runs no
 * JavaScript and follows no redirects it does not have to.
 */

import { APP_NAME, SHOP as T } from '../config.js';
import { layout } from '../render/layout.js';
import { shopDescription, shopNotFound, shopPage } from '../render/shop.js';
import { productDescription, productPage } from '../render/product-page.js';
import {
  getCategories, getMoreFromShop, getProduct, getShopCategories,
  getShopProducts, getShopProfile, recordView, viewToken,
} from '../supabase.js';

const PUBLIC_CACHE = 'public, max-age=0, s-maxage=120, stale-while-revalidate=600';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** OG images must be absolute — a relative path is silently dropped. */
const absolute = (origin, key) =>
  `${origin}/img/${key.split('/').map(encodeURIComponent).join('/')}`;

function page({ body, title, description, canonical, ogImage, ogImageWidth,
                ogImageHeight, ogType, status = 200 }) {
  return new Response(
    layout({
      title, description, body, canonical, ogImage,
      ogImageWidth, ogImageHeight, ogType,
      scripts: ['/js/shop.js'],
    }),
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': status === 200 ? PUBLIC_CACHE : 'no-store',
      },
    },
  );
}

const notFound = () =>
  page({
    body: shopNotFound(),
    title: `${T.notFoundTitle} — ${APP_NAME}`,
    description: T.notFoundBody,
    status: 404,
  });

/* ============================================================
   /@slug
   ============================================================ */

/**
 * Counting happens after the response is on its way, so a slow write
 * never delays the page. `record_view` drops a repeat token itself.
 */
function count(request, env, ctx, target) {
  if (!ctx?.waitUntil) return;
  ctx.waitUntil(
    viewToken(request, env).then((token) => recordView(env, { ...target, token })),
  );
}

export async function shopGet(request, env, url, slug, ctx) {
  const shop = await getShopProfile(env, slug);
  if (!shop) return notFound();

  count(request, env, ctx, { shop: shop.id });

  // A chip key is either a platform slug or "c<uuid>" for one of the
  // seller's own categories.
  const chipKey = url.searchParams.get('category') || null;
  const categories = await getCategories(env);
  const ownCategoryId = chipKey?.startsWith('c') && UUID.test(chipKey.slice(1))
    ? chipKey.slice(1)
    : null;
  const categoryId = !ownCategoryId && chipKey
    ? categories.find((c) => c.slug === chipKey)?.id ?? null
    : null;

  // Empty once the grace period is over — RLS sees to that — which is
  // exactly what the "not renewed" notice keys off.
  const [products, shopCategories] = shop.products_visible
    ? await Promise.all([
        getShopProducts(env, shop.id, categoryId, ownCategoryId),
        getShopCategories(env, shop.id),
      ])
    : [[], []];

  // The banner is the share image. Fall back to the logo, then to the
  // first product, so a link never previews as a bare text card.
  const ogKey =
    shop.cover_key || shop.logo_key || products[0]?.images?.[0] || null;

  const isBanner = ogKey && ogKey === shop.cover_key;

  return page({
    body: shopPage({ shop, products, categories, shopCategories,
                     activeCategory: chipKey, origin: url.origin }),
    title: `${shop.name} — ${APP_NAME}`,
    description: shopDescription(shop, products.length),
    canonical: `${url.origin}/@${shop.slug}`,
    ogImage: ogKey ? absolute(url.origin, ogKey) : null,
    ogImageWidth: isBanner ? 1200 : 800,
    ogImageHeight: isBanner ? 450 : 1000,
    ogType: 'profile',
  });
}

/* ============================================================
   /@slug/p/<id>
   ============================================================ */

export async function productGet(request, env, url, slug, id, ctx) {
  const shop = await getShopProfile(env, slug);
  if (!shop) return notFound();

  const product = await getProduct(env, id);
  // Also guards against a product id from a different shop being hung
  // off this slug.
  if (!product || product.shop?.slug?.toLowerCase() !== slug.toLowerCase()) {
    return notFound();
  }

  count(request, env, ctx, { product: product.id });

  const more = await getMoreFromShop(env, product.shop.id, product.id);
  const ogKey = product.images[0]?.full || product.images[0]?.card || shop.cover_key || null;

  return page({
    body: productPage({ product, more, origin: url.origin }),
    title: `${product.title} — ${shop.name}`,
    description: productDescription(product),
    canonical: `${url.origin}/@${shop.slug}/p/${product.id}`,
    ogImage: ogKey ? absolute(url.origin, ogKey) : null,
    ogImageWidth: 1200,
    ogImageHeight: 1500,
    ogType: 'product',
  });
}
