/**
 * /search — products and shops, with Sorani-tolerant matching.
 *
 * The normalising and the trigram fallback live in the database, where
 * the query and the indexed text go through the very same function.
 * Doing it in JavaScript would mean two implementations that drift.
 */

import { PAGE_SIZE, SEARCH as T } from '../config.js';
import { layout } from '../render/layout.js';
import { searchPage, searchTitle } from '../render/search.js';
import { searchProducts, searchShops } from '../supabase.js';

const CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=120';
const TABS = ['products', 'shops'];

export async function searchGet(env, url) {
  const query = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const wanted = url.searchParams.get('tab');
  const tab = TABS.includes(wanted) ? wanted : 'products';

  let products = [];
  let shops = [];

  if (query) {
    // Both tabs are fetched: the counts sit on the tab labels, and a
    // customer who finds nothing under products should be able to see
    // at a glance that there are shops, without a second page load.
    [{ products }, shops] = await Promise.all([
      searchProducts(env, { query, limit: PAGE_SIZE * 4 }),
      searchShops(env, { query, limit: 20 }),
    ]);
  }

  const body = searchPage({
    query,
    tab,
    products,
    shops,
    counts: { products: products.length, shops: shops.length },
  });

  return new Response(
    layout({
      title: searchTitle(query),
      description: T.placeholder,
      canonical: new URL(url.pathname + url.search, url).toString(),
      body,
      scripts: ['/js/feed.js', '/js/favorites.js'],
    }),
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': query ? CACHE : 'public, max-age=0, s-maxage=300',
      },
    },
  );
}
