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

const IMG_CACHE = 'public, max-age=31536000, immutable';
const HTML_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/img/')) return serveImage(request, env, url);
      if (url.pathname === '/api/feed') return feedFragment(env, url);
      if (url.pathname === '/') return feedPage(env, url);
    } catch (err) {
      return new Response(`error: ${err.message}`, {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

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
