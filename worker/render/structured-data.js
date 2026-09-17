/**
 * Bazaro — what the page says about itself to a machine.
 *
 * JSON-LD is read by Google and by the crawlers behind AI answers, and
 * the rule for all of it is the same one the rest of this app follows:
 * say only what is already true and already on the page. Nothing here
 * invents a rating, a review, a stock count, an SKU, a return policy or
 * a delivery time. A seller has not told us any of those, so claiming
 * them would be a lie told at scale — and structured data that
 * disagrees with the page is worse than none, because it is the kind of
 * thing a search engine stops trusting a whole domain over.
 *
 * Every field below is either a constant of the brand or a value the
 * visitor can already read on the page it is attached to.
 */

import { SITE_IDENTITY, SITE_ORIGIN, BRAND, PRODUCT_CURRENCIES } from '../config.js';
import { currencyOf } from './money.js';

/**
 * JSON-LD is embedded in HTML, so `<` and `&` have to be neutralised or
 * a title containing `</script>` would end the block early. JSON string
 * escapes are valid inside JSON, so < keeps the document well
 * formed without changing the value a parser reads.
 */
export const ldJson = (data) =>
  JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

/** An absolute https URL on the canonical domain, never on the request's host. */
export const siteUrl = (path = '/') => new URL(path, `${SITE_ORIGIN}/`).toString();

/** An R2 key as the public image URL a crawler can fetch. */
export const imageUrl = (key) =>
  key ? siteUrl(`/img/${key.split('/').map(encodeURIComponent).join('/')}`) : null;

/**
 * The publisher. Referenced by @id from the other blocks rather than
 * repeated, so there is one Bazaro in the graph and not three.
 */
export const organizationLd = () => ({
  '@type': 'Organization',
  '@id': `${SITE_ORIGIN}/#organization`,
  name: SITE_IDENTITY.name,
  alternateName: SITE_IDENTITY.alternateName,
  url: SITE_IDENTITY.url,
  logo: {
    '@type': 'ImageObject',
    url: siteUrl(BRAND.logo),
  },
});

/**
 * The site itself, for the homepage.
 *
 * No SearchAction: that markup tells Google it may render a search box
 * for the site in its results, and it has to name a query URL template
 * that really works. /search does exist — but this block is the site's
 * identity, and the honest minimum is what was asked for.
 */
export const websiteLd = () => ({
  '@type': 'WebSite',
  '@id': `${SITE_ORIGIN}/#website`,
  name: SITE_IDENTITY.name,
  alternateName: SITE_IDENTITY.alternateName,
  url: SITE_IDENTITY.url,
  description: SITE_IDENTITY.description,
  inLanguage: 'ckb',
  publisher: { '@id': `${SITE_ORIGIN}/#organization` },
});

/** The two blocks the homepage carries, as one graph. */
export const homeLd = () => ({
  '@context': 'https://schema.org',
  '@graph': [websiteLd(), organizationLd()],
});

/**
 * A seller's public shop.
 *
 * Store, not LocalBusiness: most of these sell over WhatsApp and a
 * street address is not something the app holds. `address` is therefore
 * only the city the seller chose to show, expressed as addressLocality
 * — never a fabricated street line. telephone is the WhatsApp number
 * that is already a tap-to-contact link on the page, and nothing is
 * emitted when a shop has not published one.
 */
export function shopLd({ shop }) {
  const url = siteUrl(`/@${encodeURIComponent(shop.slug)}`);
  const logo = imageUrl(shop.logo_key);
  const cover = imageUrl(shop.cover_key);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    '@id': `${url}#shop`,
    name: shop.name,
    url,
    inLanguage: 'ckb',
    parentOrganization: { '@id': `${SITE_ORIGIN}/#organization` },
  };

  if (shop.bio) ld.description = shop.bio;
  if (logo || cover) ld.image = [cover, logo].filter(Boolean);
  if (logo) ld.logo = logo;
  if (shop.whatsapp || shop.phone) ld.telephone = shop.whatsapp || shop.phone;
  if (shop.city) ld.address = { '@type': 'PostalAddress', addressLocality: shop.city };
  if (shop.maps_url) ld.hasMap = shop.maps_url;
  const sameAs = [
    shop.instagram && `https://instagram.com/${encodeURIComponent(shop.instagram)}`,
    shop.tiktok && `https://www.tiktok.com/@${encodeURIComponent(shop.tiktok)}`,
    shop.facebook && `https://facebook.com/${encodeURIComponent(shop.facebook)}`,
    shop.snapchat && `https://snapchat.com/add/${encodeURIComponent(shop.snapchat)}`,
  ].filter(Boolean);
  if (sameAs.length) ld.sameAs = sameAs;
  return ld;
}

/**
 * One product.
 *
 * price and priceCurrency are the two the seller actually typed, read
 * together exactly as the page reads them. The app does not hold stock
 * or availability data, so neither is claimed.
 *
 * No aggregateRating, no review, no sku, no gtin, no priceValidUntil.
 * Bazaro holds none of them.
 */
export function productLd({ product, shop }) {
  const url = siteUrl(`/@${encodeURIComponent(shop.slug)}/p/${encodeURIComponent(product.id)}`);
  const images = (product.images ?? [])
    .map((image) => imageUrl(image.full || image.card))
    .filter(Boolean);
  const currency = currencyOf(product.currency);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.title,
    url,
    inLanguage: 'ckb',
    offers: {
      '@type': 'Offer',
      url,
      // A whole number of dinars or of dollars, as stored. Nothing is
      // converted here, because nothing converts anywhere in this app.
      price: String(Number(product.price) || 0),
      priceCurrency: PRODUCT_CURRENCIES[currency].code,
      seller: {
        '@type': 'Store',
        name: shop.name,
        url: siteUrl(`/@${encodeURIComponent(shop.slug)}`),
      },
    },
  };

  if (images.length) ld.image = images;
  if (product.description) ld.description = product.description;
  if (product.category) ld.category = product.category;
  return ld;
}

/**
 * The trail above a product, so a result can show
 * Bazaro › the shop › the product instead of a bare URL.
 */
export function productBreadcrumbLd({ product, shop }) {
  const shopUrl = siteUrl(`/@${encodeURIComponent(shop.slug)}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_IDENTITY.name, item: SITE_IDENTITY.url },
      { '@type': 'ListItem', position: 2, name: shop.name, item: shopUrl },
      { '@type': 'ListItem', position: 3, name: product.title },
    ],
  };
}
