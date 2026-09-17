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
import { appGet, bannerDismissPost } from './routes/app.js';
import * as products from './routes/products.js';
import { productGet, shopGet } from './routes/shop.js';
import * as account from './routes/account.js';
import * as admin from './routes/admin.js';
import { searchGet } from './routes/search.js';
import * as favorites from './routes/favorites.js';
import { scheduled } from './cron.js';
import { webhookPost } from './routes/telegram.js';
import * as payment from './routes/payment.js';

const IMG_CACHE = 'public, max-age=31536000, immutable';
const HTML_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://challenges.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com",
  'frame-src https://challenges.cloudflare.com',
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

export default {
  async fetch(request, env, ctx) {
    try {
      return harden(await routeRequest(request, env, ctx));
    } catch (err) {
      const url = new URL(request.url);
      console.error('request failed', {
        method: request.method,
        path: url.pathname,
        name: err?.name || 'Error',
        message: String(err?.message || 'unknown error').slice(0, 500),
      });
      const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
      const response = api
        ? Response.json({ error: 'temporary_failure' }, {
            status: 500, headers: { 'cache-control': 'no-store' },
          })
        : new Response('Temporary error. Please try again.', {
            status: 500,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              'cache-control': 'no-store',
            },
          });
      return harden(response);
    }
  },

  scheduled,
};

async function routeRequest(request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';

      if (path.startsWith('/img/')) return serveImage(request, env, url);

      // The Telegram webhook. Public, so the secret is in the path and
      // checked again in the header before the body is even read; a
      // request that fails either gets the ordinary 404.
      const hook = path.match(/^\/api\/telegram\/([A-Za-z0-9_-]{16,128})$/);
      if (hook && method === 'POST') return webhookPost(request, env, hook[1]);

      // Wayl's webhook. The intent id is in the path because the
      // signing secret is per payment: it has to be found before the
      // body is read, let alone parsed. Everything unproven 404s.
      const waylHook = path.match(/^\/webhooks\/wayl\/([0-9a-f-]{36})$/i);
      if (waylHook && method === 'POST') return payment.webhookPost(request, env, waylHook[1]);
      if (path === '/api/feed') return feedFragment(env, url);
      if (path === '/api/slug-check') return onboarding.slugCheck(env, url);
      if (path === '/api/favorites/cards') return favorites.cardsGet(env, url);
      if (path === '/api/favorites') {
        return method === 'POST'
          ? favorites.togglePost(request, env)
          : favorites.stateGet(request, env);
      }
      if (path === '/api/favorites/merge' && method === 'POST') {
        return favorites.mergePost(request, env);
      }
      // The seller's own categories, as JSON: the owner-profile rail and
      // the inline creator in the product form both edit them without
      // leaving the page they are on.
      if (path === '/api/categories') {
        return method === 'POST'
          ? account.categoryApiPost(request, env)
          : account.categoriesApiGet(request, env);
      }
      const categoryApi = path.match(/^\/api\/categories\/([0-9a-f-]{36})(\/delete)?$/i);
      if (categoryApi && method === 'POST') {
        return categoryApi[2]
          ? account.categoryApiDelete(request, env, categoryApi[1])
          : account.categoryApiRename(request, env, categoryApi[1]);
      }
      // Malformed category writes are API misses, not static assets.
      // Forwarding their unread POST bodies to ASSETS can trigger a
      // request-stream failure after the asset response has been sent.
      if (method === 'POST' && path.startsWith('/api/categories/')) {
        return Response.json({ error: 'not_found' }, {
          status: 404, headers: { 'cache-control': 'no-store' },
        });
      }
      if (path === '/search') return searchGet(env, url);
      if (path === '/saved') return favorites.savedGet(request, env);
      if (path === '/') return feedPage(env, url);

      // ---- the public shop link: /@slug and /@slug/p/<id> ----
      const shopPath = path.match(
        /^\/@([a-z0-9][a-z0-9-]{1,38}[a-z0-9])(?:\/p\/([0-9a-f-]{36}))?$/i,
      );
      if (shopPath) {
        return shopPath[2]
          ? productGet(request, env, url, shopPath[1], shopPath[2], ctx)
          : shopGet(request, env, url, shopPath[1], ctx);
      }

      // ---- admin (404s for everybody else) ----
      if (path === '/admin' || path.startsWith('/admin/')) {
        return adminRoute(request, env, url, path, method);
      }

      // ---- auth ----
      if (path === '/signup') {
        return method === 'POST'
          ? authRoutes.signupPost(request, env)
          : authRoutes.signupGet(request, env, url);
      }
      if (path === '/login') {
        return method === 'POST'
          ? authRoutes.loginPost(request, env)
          : authRoutes.loginGet(request, env, url);
      }
      if (path === '/logout' && method === 'POST') return authRoutes.logoutPost(request, env);
      if (path === '/auth/google') return authRoutes.googleStart(request, env, url);
      if (path === '/auth/callback') return authRoutes.authCallback(request, env, url);
      if (path === '/forgot') {
        return method === 'POST'
          ? authRoutes.forgotPost(request, env, url)
          : authRoutes.forgotGet(request, env);
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
      // The access screen, and the one place a free trial can begin.
      // Looking at the screen starts nothing; the POST does, once ever.
      if (path === '/app/subscription/start') {
        return account.accessGateGet(request, env, url);
      }
      // Carrying on with the Free plan. There is nothing to start, so
      // this only checks the seller still has a slot and sends them to
      // the form. /trial is the name the plan gate still posts to.
      if ((path === '/app/subscription/free' || path === '/app/subscription/trial')
          && method === 'POST') {
        return account.subscriptionFreePost(request, env);
      }
      // Wayl hosted checkout. The seller leaves for Wayl at /checkout,
      // comes back to /result, and /status is what that page polls.
      // None of the three ever reads a payment state from the browser.
      if (path === '/app/subscription/checkout' && method === 'POST') {
        return payment.checkoutPost(request, env);
      }
      if (path === '/app/subscription/status') return payment.statusGet(request, env, url);
      if (path === '/app/subscription/result') return payment.resultGet(request, env, url);

      // The retained manual fallback: file an intent, read the
      // instructions, say you sent it. Nothing here confirms a payment.
      if (path === '/app/subscription/pay') {
        return account.subscriptionPayGet(request, env, url);
      }
      if (path === '/app/subscription/sent' && method === 'POST') {
        return account.subscriptionSentPost(request, env, ctx);
      }

      // Closing a renewal banner. Stored per shop, never permanently.
      if (path === '/app/banner/dismiss' && method === 'POST') {
        return bannerDismissPost(request, env);
      }

      // ---- products (must be matched before the /app catch-all) ----
      if (path === '/app/upload' && method === 'POST') return products.uploadPost(request, env);
      if (path === '/app/new') {
        return method === 'POST'
          ? products.newPost(request, env)
          : products.newGet(request, env, url);
      }
      // The standalone manager is gone. /app is the seller's management
      // home: it is the owner view of the shop, and it already carries
      // the products, the add button and per-product delete. A second
      // screen listing the same products was one place too many to keep
      // in step, and the one a seller could get stranded on.
      //
      // A 303 that is never cached, like every other redirect here: the
      // address is retired, but a permanent redirect would sit in every
      // seller's browser and make the decision hard to walk back.
      if (path === '/app/products') return redirectTo('/app');

      const product = path.match(/^\/app\/products\/([0-9a-f-]{36})(\/delete)?$/i);
      if (product) {
        const id = product[1];
        if (product[2]) {
          return method === 'POST'
            ? products.deletePost(request, env, id)
            : redirectTo('/app');
        }
        return method === 'POST'
          ? products.editPost(request, env, id)
          : products.editGet(request, env, id);
      }

      // ---- protected seller area ----
      if (path === '/app' || path.startsWith('/app/')) return appGet(request, env, url);

  return assetResponse(request, env);
}

export function harden(response) {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', CSP);
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('x-frame-options', 'DENY');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Every /admin path, including one that matches nothing, ends at the
 * same guard — so an unknown admin path and an unauthorised one are the
 * same 404, and neither confirms that /admin exists.
 */
function adminRoute(request, env, url, path, method) {
  if (method === 'GET') {
    if (path === '/admin') return admin.homeGet(request, env);
    if (path === '/admin/shops') return admin.shopsGet(request, env, url);
    if (path === '/admin/intents') return admin.intentsGet(request, env);
    if (path === '/admin/reports') return admin.reportsGet(request, env);

    const grant = path.match(/^\/admin\/shops\/([0-9a-f-]{36})\/grant$/i);
    if (grant) return admin.grantGet(request, env, grant[1]);

    const shop = path.match(/^\/admin\/shops\/([0-9a-f-]{36})$/i);
    if (shop) return admin.shopGet(request, env, url, shop[1]);
  }

  if (method === 'POST') {
    const grant = path.match(/^\/admin\/shops\/([0-9a-f-]{36})\/grant$/i);
    if (grant) return admin.grantPost(request, env, grant[1]);
    const shop = path.match(/^\/admin\/shops\/([0-9a-f-]{36})\/(status|expiry|note)$/i);
    if (shop) {
      if (shop[2] === 'status') return admin.shopStatusPost(request, env, shop[1]);
      if (shop[2] === 'expiry') return admin.shopExpiryPost(request, env, shop[1]);
      return admin.shopNotePost(request, env, shop[1]);
    }

    const intent = path.match(/^\/admin\/intents\/([0-9a-f-]{36})\/(activate|not-found)$/i);
    if (intent) {
      return intent[2] === 'activate'
        ? admin.intentActivatePost(request, env, intent[1])
        : admin.intentNotFoundPost(request, env, intent[1]);
    }

    const report = path.match(/^\/admin\/reports\/([0-9a-f-]{36})\/(hide|dismiss)$/i);
    if (report) {
      return report[2] === 'hide'
        ? admin.reportHidePost(request, env, report[1])
        : admin.reportDismissPost(request, env, report[1]);
    }
  }

  return assetResponse(request, env);
}

function assetResponse(request, env) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return env.ASSETS.fetch(request);
  }
  return env.ASSETS.fetch(new Request(request.url, {
    method: 'GET', headers: { accept: 'text/html' },
  }));
}

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
      scripts: ['/js/feed.js', '/js/favorites.js'],
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
