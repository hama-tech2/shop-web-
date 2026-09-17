/**
 * Bazaro — robots.txt and sitemap.xml.
 *
 * Both are built from the live database rather than checked in, because
 * a shop that lapses, is suspended, or is deleted has to leave the
 * sitemap by itself. A stale sitemap is not a cosmetic problem: it
 * sends Google to pages that 404, and a domain that does that enough
 * gets crawled less.
 *
 * What counts as public is not decided here. These reads go through
 * PostgREST with the publishable key, so Row Level Security returns
 * exactly the rows an anonymous visitor could already see — the active
 * products of shops whose plan is live. There is no second definition
 * of "public" in this file to drift out of step with the first.
 */

import { SITE_ORIGIN } from '../config.js';
import { publicShops, publicProductRefs } from '../supabase.js';

/** A sitemap may hold 50,000 URLs; Bazaro is nowhere near, but the cap is real. */
const MAX_URLS = 50000;

const CACHE = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';

const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * The path as the router will actually receive it.
 *
 * `@` is legal in a path segment and is the first character of every
 * shop address, but encodeURIComponent turns it into %40 — and the
 * route that serves /@slug matches the raw pathname, so /%40slug is a
 * 404. Encoding each segment and then putting `@` back keeps unexpected
 * characters escaped without breaking the one URL shape this app is
 * built around.
 */
const loc = (path) =>
  `${SITE_ORIGIN}${path.split('/').map(encodeURIComponent).join('/').replace(/%40/g, '@')}`;

/** W3C date, which is what <lastmod> wants. An unparseable value is left out. */
function lastmod(value) {
  if (!value) return '';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? '' : `<lastmod>${at.toISOString()}</lastmod>`;
}

const urlEntry = ({ path, updated, changefreq, priority }) =>
  `<url><loc>${xmlEscape(loc(path))}</loc>` +
  lastmod(updated) +
  (changefreq ? `<changefreq>${changefreq}</changefreq>` : '') +
  (priority ? `<priority>${priority}</priority>` : '') +
  `</url>`;

/**
 * robots.txt.
 *
 * Two things this deliberately does NOT do.
 *
 * It does not name /admin. A Disallow line is a public list of the
 * paths a site has, and /admin answers with the ordinary 404 to
 * everybody who is not a signed-in admin — a crawler included. Naming
 * it here would advertise an address that is otherwise unfindable,
 * which is the one thing CLAUDE.md says the 404 exists to prevent. The
 * admin screens also send `x-robots-tag: noindex, nofollow` on every
 * response, so even an admin's own browsing cannot leak them.
 *
 * It does not block anything with a blanket rule or single out
 * Googlebot. The only Disallow lines are the signed-in and machine
 * paths, which have nothing a search result could usefully show.
 */
export function robotsGet() {
  const body = [
    '# Bazaro — بازاڕۆ',
    '# Public shops and products are open to every crawler.',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# Signed-in areas. Nothing here renders anything a search result could use,',
    '# and each one already redirects or refuses without a session.',
    'Disallow: /app',
    'Disallow: /onboarding',
    'Disallow: /saved',
    'Disallow: /login',
    'Disallow: /signup',
    'Disallow: /forgot',
    'Disallow: /reset',
    'Disallow: /logout',
    '',
    '# Machine endpoints: JSON fragments and callbacks, not pages.',
    'Disallow: /api/',
    'Disallow: /auth/',
    'Disallow: /webhooks/',
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': CACHE,
    },
  });
}

/**
 * sitemap.xml — the homepage, every public shop, every public product.
 *
 * lastmod comes from the row's own updated_at, so re-crawling is driven
 * by real edits. A row without one simply carries no lastmod, which is
 * valid and honest; a made-up date would teach Google to ignore the
 * field.
 */
export async function sitemapGet(env) {
  const [shops, products] = await Promise.all([
    publicShops(env),
    publicProductRefs(env),
  ]);

  const bySlug = new Map(shops.map((shop) => [shop.id, shop.slug]));

  const entries = [
    urlEntry({ path: '/', changefreq: 'daily', priority: '1.0' }),
    ...shops.map((shop) =>
      urlEntry({
        path: `/@${shop.slug}`,
        updated: shop.updated_at,
        changefreq: 'weekly',
        priority: '0.8',
      })),
    // A product whose shop is not in the public list cannot be linked
    // to: /@slug/p/<id> needs the slug, and the page itself refuses an
    // id hung off the wrong shop. Dropping it is the same rule.
    ...products
      .filter((product) => bySlug.has(product.shop_id))
      .map((product) =>
        urlEntry({
          path: `/@${bySlug.get(product.shop_id)}/p/${product.id}`,
          updated: product.updated_at,
          changefreq: 'weekly',
          priority: '0.6',
        })),
  ].slice(0, MAX_URLS);

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    entries.join('') +
    `</urlset>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': CACHE,
    },
  });
}
