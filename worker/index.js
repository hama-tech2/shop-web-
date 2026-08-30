/**
 * Shop Web — Worker entry point.
 *
 * Multi-page, server-rendered. `assets.not_found_handling` is "none", so
 * any path with no matching static file arrives here. Static assets
 * (/styles, /js, /seed) are served by the ASSETS binding before this runs.
 */

import { PAGE_SIZE } from './config.js';
import { getCategories, getFeed } from './supabase.js';
import { cardsFragment, feedHtml, feedTitle } from './render/feed.js';
import { layout } from './render/layout.js';
import { APP_TAGLINE } from './config.js';
import * as authRoutes from './routes/auth.js';
import * as onboarding from './routes/onboarding.js';
import { appGet } from './routes/app.js';
import * as products from './routes/products.js';
import { productGet, shopGet } from './routes/shop.js';
import * as account from './routes/account.js';

const IMG_CACHE = 'public, max-age=31536000, immutable';
const HTML_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const method = request.method.toUpperCase();
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path.startsWith('/img/')) return serveImage(request, env, url);
      if (path === '/api/feed') return feedFragment(env, url);
      if (path === '/api/slug-check') return onboarding.slugCheck(env, url);
      if (path === '/') return feedPage(env, url);

      // ---- the public shop link: /@slug and /@slug/p/<id> ----
      const shopPath = path.match(
        /^\/@([a-z0-9][a-z0-9-]{1,38}[a-z0-9])(?:\/p\/([0-9a-f-]{36}))?$/i,
      );
      if (shopPath) {
        return shopPath[2]
          ? productGet(env, url, shopPath[1], shopPath[2])
          : shopGet(env, url, shopPath[1]);
      }

      // ---- auth ----
      if (path === '/signup') {
        return method === 'POST'
          ? authRoutes.signupPost(request, env)
          : authRoutes.signupGet(request, url);
      }
      if (path === '/login') {
        return method === 'POST'
          ? authRoutes.loginPost(request, env)
          : authRoutes.loginGet(request, url);
      }
      if (path === '/logout' && method === 'POST') return authRoutes.logoutPost(request, env);
      if (path === '/auth/google') return authRoutes.googleStart(request, env, url);
      if (path === '/auth/callback') return authRoutes.authCallback(request, env, url);
      if (path === '/forgot') {
        return method === 'POST'
          ? authRoutes.forgotPost(request, env, url)
          : authRoutes.forgotGet();
      }
      if (path === '/reset') {
        return method === 'POST'
          ? authRoutes.resetPost(request, env)
          : authRoutes.resetGet(request, env);
      }

      // ---- onboarding wizard ----
      if (path === '/onboarding') {
        return method === 'POST'
          ? onboarding.namePost(request, env)
          : onboarding.nameGet(request, env);
      }
      if (path === '/onboarding/name' && method === 'POST') return onboarding.namePost(request, env);
      if (path === '/onboarding/slug') {
        return method === 'POST'
          ? onboarding.slugPost(request, env, url)
          : onboarding.slugGet(request, env, url);
      }
      if (path === '/onboarding/contact') {
        return method === 'POST'
          ? onboarding.contactPost(request, env)
          : onboarding.contactGet(request, env);
      }
      if (path === '/onboarding/logo') {
        return method === 'POST'
          ? onboarding.logoPost(request, env)
          : onboarding.logoGet(request, env);
      }

      // ---- account screens (before the /app catch-all) ----
      if (path === '/app/profile') {
        return method === 'POST'
          ? account.profilePost(request, env, url)
          : account.profileGet(request, env, url);
      }
      if (path === '/app/profile/image' && method === 'POST') {
        return account.profileImagePost(request, env);
      }
      if (path === '/app/categories') return account.categoriesGet(request, env, url);
      if (path === '/app/categories/add' && method === 'POST') {
        return account.categoryAddPost(request, env);
      }

      const category = path.match(
        /^\/app\/categories\/([0-9a-f-]{36})(\/delete|\/move)?$/i,
      );
      if (category && method === 'POST') {
        const id = category[1];
        if (category[2] === '/delete') return account.categoryDeletePost(request, env, id);
        if (category[2] === '/move') return account.categoryMovePost(request, env, id);
        return account.categoryRenamePost(request, env, id);
      }

      if (path === '/app/subscription') {
        return method === 'POST'
          ? account.subscriptionPost(request, env)
          : account.subscriptionGet(request, env, url);
      }
      if (path === '/app/subscription/requested') {
        return account.subscriptionRequestedGet(request, env, url);
      }

      // ---- products (must be matched before the /app catch-all) ----
      if (path === '/app/upload' && method === 'POST') return products.uploadPost(request, env);
      if (path === '/app/new') {
        return method === 'POST'
          ? products.newPost(request, env)
          : products.newGet(request, env);
      }
      if (path === '/app/products') return products.listGet(request, env, url);

      const product = path.match(/^\/app\/products\/([0-9a-f-]{36})(\/delete)?$/i);
      if (product) {
        const id = product[1];
        if (product[2]) {
          return method === 'POST'
            ? products.deletePost(request, env, id)
            : redirectTo('/app/products');
        }
        return method === 'POST'
          ? products.editPost(request, env, id)
          : products.editGet(request, env, id);
      }

      // ---- protected seller area ----
      if (path === '/app' || path.startsWith('/app/')) return appGet(request, env, url);
    } catch (err) {
      return new Response(`error: ${err.message}`, {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

const redirectTo = (location) =>
  new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });

/* ============================================================
   /img/<key> — the only way an R2 object reaches a browser
   ============================================================ */

async function serveImage(request, env, url) {
  const key = decodeURIComponent(url.pathname.slice('/img/'.length));

  // Keys live under exactly two prefixes, and `..` is never legitimate.
  if (!/^(products|shops)\//.test(key) || key.includes('..')) {
    return new Response('bad key', { status: 400 });
  }

  const object = await env.IMAGES.get(key);

  if (object) {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('cache-control', IMG_CACHE);
    headers.set('etag', object.httpEtag);
    if (!headers.has('content-type')) headers.set('content-type', 'image/webp');

    if (request.headers.get('if-none-match') === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  }

  // Seed fallback: nothing has been uploaded to R2 yet, so keys whose
  // last segment matches a bundled seed file resolve to that file.
  // Delete this branch once real uploads exist.
  const name = key.split('/').pop();
  if (/^[a-z0-9._-]+$/i.test(name)) {
    const asset = await env.ASSETS.fetch(
      new Request(new URL(`/seed/${name}`, url).toString()),
    );
    if (asset.ok) {
      const headers = new Headers(asset.headers);
      headers.set('cache-control', IMG_CACHE);
      return new Response(asset.body, { headers });
    }
  }

  return new Response('not found', { status: 404 });
}

/* ============================================================
   feed
   ============================================================ */

function readParams(url) {
  const category = url.searchParams.get('category') || null;
  const query = (url.searchParams.get('q') || '').trim() || null;
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0) | 0);
  return { category, query, offset };
}

async function resolveCategoryId(env, slug) {
  if (!slug) return null;
  const categories = await getCategories(env);
  return categories.find((c) => c.slug === slug)?.id ?? null;
}

async function feedPage(env, url) {
  const { category, query, offset } = readParams(url);
  const categoryId = await resolveCategoryId(env, category);

  const { products, hasMore } = await getFeed(env, {
    categoryId,
    query,
    limit: PAGE_SIZE,
    offset,
  });

  const body = feedHtml({
    products,
    hasMore,
    category,
    query,
    offset,
    pageSize: PAGE_SIZE,
  });

  const ogImage = products[0]?.images?.[0]
    ? new URL(`/img/${products[0].images[0]}`, url).toString()
    : null;

  return new Response(
    layout({
      title: feedTitle(query),
      description: APP_TAGLINE,
      canonical: new URL(url.pathname + url.search, url).toString(),
      ogImage,
      body,
    }),
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': HTML_CACHE,
      },
    },
  );
}

/** Cards-only HTML for the load-more button. */
async function feedFragment(env, url) {
  const { category, query, offset } = readParams(url);
  const categoryId = await resolveCategoryId(env, category);

  const { products, hasMore } = await getFeed(env, {
    categoryId,
    query,
    limit: PAGE_SIZE,
    offset,
  });

  return new Response(cardsFragment(products, offset), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-has-more': hasMore ? '1' : '0',
      'x-next-offset': String(offset + PAGE_SIZE),
    },
  });
}
