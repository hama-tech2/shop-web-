import { CITY_LABEL, SHOP as T, UI } from '../config.js';
import { esc, price } from './html.js';
import { cardHtml } from './feed.js';
import { iconBack, iconHeart, iconPin, iconShare, iconWhatsapp } from './icons.js';

const imgUrl = (key) => `/img/${key.split('/').map(encodeURIComponent).join('/')}`;

const wa = (number, text) =>
  `https://wa.me/${T.waNumber(number)}?text=${encodeURIComponent(text)}`;

/**
 * Product detail.
 *
 * The carousel is a scroll-snap strip, so it swipes natively and needs no
 * JavaScript to work — the script only syncs the dots.
 */
export function productPage({ product, more, origin }) {
  const shop = product.shop;
  const shopUrl = `/@${encodeURIComponent(shop.slug)}`;
  const pageUrl = `${origin}${shopUrl}/p/${product.id}`;
  const city = CITY_LABEL[shop.city] ?? shop.city ?? '';

  const slides = product.images.length
    ? product.images
        .map(
          (img, i) =>
            `<img class="carousel__img" src="${esc(imgUrl(img.full))}" alt=""` +
            ` width="1200" height="1500"` +
            ` loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async"` +
            `${i === 0 ? ' fetchpriority="high"' : ''}>`,
        )
        .join('')
    : `<span class="carousel__img carousel__img--empty"></span>`;

  const dots =
    product.images.length > 1
      ? `<div class="dots dots--pdp" id="pdp-dots">` +
        product.images
          .map((_, i) => `<span class="dot${i === 0 ? ' is-active' : ''}"></span>`)
          .join('') +
        `</div>`
      : '';

  const avatar = shop.logo_key
    ? `<img class="shop-row__logo" src="${esc(imgUrl(shop.logo_key))}" alt=""` +
      ` width="44" height="44" loading="lazy" decoding="async">`
    : `<span class="shop-row__logo shop-row__logo--initial">` +
      `${esc([...String(shop.name).trim()][0] ?? '؟')}</span>`;

  const moreRow = more.length
    ? `<section class="more">` +
      `<h2 class="more__title">${esc(T.moreFromShop)}</h2>` +
      `<div class="more__rail">` +
      more.map((p, i) => `<div class="more__item">${cardHtml(p, i + 2)}</div>`).join('') +
      `</div></section>`
    : '';

  return (
    `<div class="page page--pdp">` +

    `<div class="pdp-toolbar">` +
    `<a class="pdp-back" href="${esc(shopUrl)}">${iconBack()}<span>${esc(T.backToShop)}</span></a>` +
    `<div class="pdp-tools">` +
    `<button class="round-btn" type="button" id="pdp-heart" data-fav="${esc(product.id)}"` +
    ` aria-pressed="false" aria-label="${esc(T.save)}">${iconHeart(22)}</button>` +
    `<button class="round-btn" type="button" id="share-btn"` +
    ` data-url="${esc(pageUrl)}" data-title="${esc(product.title)}"` +
    ` data-copied="${esc(T.linkCopied)}" aria-label="${esc(T.share)}">${iconShare(22)}</button>` +
    `<span class="share-status visually-hidden" role="status" aria-live="polite"></span>` +
    `</div></div>` +

    `<div class="pdp-gallery"><div class="carousel" id="pdp-carousel" tabindex="0" role="region"` +
    ` aria-label="وێنەکانی بەرهەم">${slides}</div>${dots}</div>` +

    `<div class="pdp-body">` +
    `<div class="pdp-heading"><h1 class="pdp-title">${esc(product.title)}</h1>` +
    `<p class="pdp-price">` +
    `<span class="pdp-amount">${esc(price(product.price))}</span>` +
    `<span class="card__currency">${esc(UI.currency)}</span></p></div>` +
    (product.description
      ? `<section class="pdp-description"><h2>دەربارەی بەرهەم</h2><p class="pdp-desc">${esc(product.description)}</p></section>`
      : '') +

    `<a class="shop-row" href="${esc(shopUrl)}">${avatar}` +
    `<span class="shop-row__body">` +
    `<span class="shop-row__label">دوکان</span><span class="shop-row__name">${esc(shop.name)}</span>` +
    `<span class="shop-row__username"><bdi dir="ltr">@${esc(shop.slug)}</bdi></span>` +
    (city ? `<span class="shop-row__city">${iconPin(12)}${esc(city)}</span>` : '') +
    `</span>` +
    `<span class="shop-row__go">${esc(T.viewShop)}</span></a>` +

    `<div class="pdp-order">` +
    `<a class="btn btn--whatsapp" href="${esc(wa(shop.whatsapp, T.orderText(product.title, pageUrl)))}"` +
    ` target="_blank" rel="noopener">${iconWhatsapp()}` +
    `<span>${esc(T.whatsappOrder)}</span></a>` +
    `</div></div>` +

    moreRow +

    `</div>`
  );
}

/** OG description for a product: its own text, else name and price. */
export const productDescription = (product) =>
  (product.description && product.description.trim().slice(0, 200)) ||
  `${product.title} — ${price(product.price)} ${UI.currency}`;
