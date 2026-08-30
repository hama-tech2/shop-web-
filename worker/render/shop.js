import { APP_NAME, CITY_LABEL, SHOP as T, UI } from '../config.js';
import { esc } from './html.js';
import { cardHtml } from './feed.js';
import {
  iconFacebook, iconInstagram, iconPhone, iconPin, iconShare, iconTiktok, iconWhatsapp,
} from './icons.js';

const imgUrl = (key) => `/img/${key.split('/').map(encodeURIComponent).join('/')}`;

const wa = (number, text) =>
  `https://wa.me/${T.waNumber(number)}?text=${encodeURIComponent(text)}`;

/* ============================================================
   header — banner, logo, name, city, bio, contact
   ============================================================ */

export function shopHeader({ shop, origin }) {
  const url = `${origin}/@${shop.slug}`;
  const city = CITY_LABEL[shop.city] ?? shop.city ?? '';

  const banner = shop.cover_key
    ? `<img class="shop-banner__img" src="${esc(imgUrl(shop.cover_key))}" alt=""` +
      ` width="1200" height="450" fetchpriority="high" decoding="async">`
    : `<span class="shop-banner__img shop-banner__img--empty"></span>`;

  const logo = shop.logo_key
    ? `<img class="shop-logo" src="${esc(imgUrl(shop.logo_key))}" alt=""` +
      ` width="88" height="88" decoding="async">`
    : `<span class="shop-logo shop-logo--initial">` +
      `${esc([...String(shop.name).trim()][0] ?? '؟')}</span>`;

  // Small round buttons. Only the ones the seller actually filled in.
  const round = (href, label, icon, extra = '') =>
    `<a class="round-btn" href="${esc(href)}"${extra} aria-label="${esc(label)}"` +
    ` title="${esc(label)}">${icon}</a>`;

  const links = [
    shop.phone || shop.whatsapp
      ? round(`tel:${esc(shop.phone || shop.whatsapp)}`, T.call, iconPhone())
      : '',
    shop.instagram
      ? round(`https://instagram.com/${encodeURIComponent(shop.instagram)}`, T.instagram,
              iconInstagram(), ' target="_blank" rel="noopener"')
      : '',
    shop.tiktok
      ? round(`https://www.tiktok.com/@${encodeURIComponent(shop.tiktok)}`, T.tiktok,
              iconTiktok(), ' target="_blank" rel="noopener"')
      : '',
    shop.facebook
      ? round(`https://facebook.com/${encodeURIComponent(shop.facebook)}`, T.facebook,
              iconFacebook(), ' target="_blank" rel="noopener"')
      : '',
    `<button class="round-btn" type="button" id="share-btn"` +
    ` data-url="${esc(url)}" data-title="${esc(shop.name)}"` +
    ` data-copied="${esc(T.linkCopied)}" aria-label="${esc(T.share)}">${iconShare()}</button>`,
  ].join('');

  return (
    `<header class="shop-head">` +
    `<div class="shop-banner">${banner}${logo}</div>` +
    `<div class="shop-id">` +
    `<h1 class="shop-name">${esc(shop.name)}</h1>` +
    (city
      ? `<p class="shop-city">${iconPin()}<span>${esc(city)}</span></p>`
      : '') +
    (shop.bio ? `<p class="shop-bio">${esc(shop.bio)}</p>` : '') +
    `</div>` +
    `<div class="shop-actions">` +
    `<a class="btn btn--whatsapp" href="${esc(wa(shop.whatsapp, T.shopText(shop.name, url)))}"` +
    ` target="_blank" rel="noopener">${iconWhatsapp()}` +
    `<span>${esc(T.whatsappShop)}</span></a>` +
    `<div class="round-row">${links}</div>` +
    `</div>` +
    `</header>`
  );
}

/* ============================================================
   the page
   ============================================================ */

export function shopPage({ shop, products, categories, shopCategories, activeCategory, origin }) {
  // The seller's own categories win when they have set any up. Only the
  // ones that actually hold a product are shown — an empty chip is a
  // dead end. Shops with no categories fall back to the platform ones
  // their products already use, so the row is never empty for nothing.
  const ownUsed = new Set(products.map((p) => p.ownCategoryId).filter(Boolean));
  const own = (shopCategories ?? []).filter((c) => ownUsed.has(c.id));

  const platformUsed = new Set(products.map((p) => p.categoryId).filter(Boolean));
  const chips = own.length
    ? own.map((c) => ({ key: `c${c.id}`, label: c.name }))
    : categories.filter((c) => platformUsed.has(c.id))
        .map((c) => ({ key: c.slug, label: c.name_ckb }));

  const base = `/@${encodeURIComponent(shop.slug)}`;
  const chipRow =
    chips.length > 1
      ? `<nav class="chips" aria-label="${esc(T.productsTitle)}">` +
        `<a class="chip" href="${esc(base)}"` +
        `${!activeCategory ? ' aria-current="true"' : ''}>${esc(T.all)}</a>` +
        chips
          .map(
            (c) =>
              `<a class="chip" href="${esc(`${base}?category=${encodeURIComponent(c.key)}`)}"` +
              `${activeCategory === c.key ? ' aria-current="true"' : ''}>` +
              `${esc(c.label)}</a>`,
          )
          .join('') +
        `</nav>`
      : '';

  let body;
  if (!shop.products_visible) {
    // Lapsed: the link still works and still sells the seller. It just
    // does not show stock.
    body =
      `<div class="notice">` +
      `<p class="notice__title">${esc(T.expiredTitle)}</p>` +
      `<p>${esc(T.expiredBody)}</p></div>`;
  } else if (!products.length) {
    body =
      `<div class="notice">` +
      `<p class="notice__title">${esc(T.emptyTitle)}</p>` +
      `<p>${esc(T.emptyBody)}</p></div>`;
  } else {
    body =
      chipRow +
      `<div class="grid">` +
      products.map((p, i) => cardHtml(p, i)).join('') +
      `</div>`;
  }

  // No bottom tab bar here: this page belongs to the seller, not the app.
  return `<div class="page page--shop">${shopHeader({ shop, origin })}${body}</div>`;
}

export function shopNotFound() {
  return (
    `<div class="page"><div class="notice notice--tall">` +
    `<p class="notice__title">${esc(T.notFoundTitle)}</p>` +
    `<p>${esc(T.notFoundBody)}</p>` +
    `<a class="btn btn--quiet" href="/">${esc(APP_NAME)}</a>` +
    `</div></div>`
  );
}

/** OG description: the bio if there is one, else a plain sentence. */
export const shopDescription = (shop, count) =>
  (shop.bio && shop.bio.trim()) ||
  `${shop.name} — ${count} ${UI.currency === 'IQD' ? 'بەرهەم' : 'products'}`;
