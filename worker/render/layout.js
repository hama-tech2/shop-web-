import { APP_NAME, APP_NAME_LATIN, BRAND } from '../config.js';
import { ldJson } from './structured-data.js';
import { esc } from './html.js';

/**
 * The HTML shell. Server-rendered every time — the page is readable
 * before a single byte of JavaScript arrives, which is what makes the
 * shared link work for crawlers and for a phone on a bad connection.
 */
export function layout({
  title, description, body, canonical, ogImage,
  ogImageWidth, ogImageHeight, ogType = 'website',
  scripts = ['/js/feed.js'], structuredData = null,
}) {
  // Structured data, for Google and for the crawlers behind AI answers.
  // One <script> per block rather than one combined graph: a block with
  // a mistake in it is then discarded on its own instead of taking the
  // page's whole description down with it.
  const jsonLd = (structuredData ? [].concat(structuredData) : [])
    .filter(Boolean)
    .map((block) => `<script type="application/ld+json">${ldJson(block)}</script>`)
    .join('');
  // A page with no image of its own still needs a share card, and an
  // og:image must be absolute or every crawler drops it silently. The
  // canonical URL is the only origin this function is given, so a page
  // without one simply gets no fallback rather than a broken relative
  // path. A seller's own link never reaches this: /@slug picks their
  // cover, their logo, or their first product first.
  const brandOg = canonical ? new URL(BRAND.ogImage, canonical).toString() : null;
  const shareImage = ogImage || brandOg;
  const shareWidth = ogImage ? ogImageWidth : BRAND.ogWidth;
  const shareHeight = ogImage ? ogImageHeight : BRAND.ogHeight;
  return (
    `<!doctype html>` +
    `<html lang="ckb" dir="rtl">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` +
    `<meta name="theme-color" content="#FBF9F6">` +
    // Every size a browser, a phone home screen or an app store asks
    // for. The .ico is last because only old Windows still wants it,
    // and browsers take the first format they understand.
    `<link rel="icon" type="image/png" sizes="32x32" href="${BRAND.icon32}">` +
    `<link rel="icon" type="image/png" sizes="16x16" href="${BRAND.icon16}">` +
    `<link rel="icon" type="image/png" sizes="48x48" href="${BRAND.icon48}">` +
    `<link rel="apple-touch-icon" sizes="180x180" href="${BRAND.appleTouch}">` +
    `<link rel="manifest" href="${BRAND.manifest}">` +
    `<link rel="icon" href="${BRAND.ico}" sizes="any">` +
    `<meta name="apple-mobile-web-app-title" content="${esc(APP_NAME_LATIN)}">` +
    `<title>${esc(title)}</title>` +
    `<meta name="description" content="${esc(description)}">` +
    (canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '') +

    `<meta property="og:type" content="${esc(ogType)}">` +
    `<meta property="og:site_name" content="${esc(APP_NAME_LATIN)}">` +
    `<meta property="og:title" content="${esc(title)}">` +
    `<meta property="og:description" content="${esc(description)}">` +
    (canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '') +
    (shareImage
      ? `<meta property="og:image" content="${esc(shareImage)}">` +
        `<meta property="og:image:secure_url" content="${esc(shareImage)}">` +
        (shareWidth ? `<meta property="og:image:width" content="${esc(shareWidth)}">` : '') +
        (shareHeight ? `<meta property="og:image:height" content="${esc(shareHeight)}">` : '') +
        `<meta property="og:image:alt" content="${esc(title)}">` +
        `<meta name="twitter:image" content="${esc(shareImage)}">`
      : '') +
    `<meta property="og:locale" content="ckb_IQ">` +
    `<meta name="twitter:title" content="${esc(title)}">` +
    `<meta name="twitter:description" content="${esc(description)}">` +
    `<meta name="twitter:card" content="${shareImage ? 'summary_large_image' : 'summary'}">` +

    `<link rel="preconnect" href="https://fonts.googleapis.com">` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?` +
    `family=Noto+Kufi+Arabic:wght@400;700&family=Vazirmatn:wght@400;500;700&display=swap">` +
    `<link rel="stylesheet" href="/styles/design-system.css">` +
    `<link rel="stylesheet" href="/styles/app.css">` +
    `<link rel="stylesheet" href="/styles/forms.css">` +
    `<link rel="stylesheet" href="/styles/product.css">` +
    `<link rel="stylesheet" href="/styles/shop.css">` +
    `<link rel="stylesheet" href="/styles/account.css">` +
    `<link rel="stylesheet" href="/styles/admin.css">` +
    `<link rel="stylesheet" href="/styles/search.css">` +
    jsonLd +
    `</head>` +
    `<body>${body}` +
    `<script src="/js/confirm-submit.js" defer></script>` +
    scripts.map((src) => `<script src="${esc(src)}" defer></script>`).join('') +
    // Cards also arrive after load on Saved and the owner's public-shop preview.
    (scripts.includes('/js/favorites.js') || body.includes('id="owner-products"')
      ? `<script src="/js/card-actions.js" defer></script>` : '') +
    `</body>` +
    `</html>`
  );
}
