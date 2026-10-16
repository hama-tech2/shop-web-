import { SITE_ORIGIN, SHOP_SHARING as T } from '../config.js';
import { esc } from './html.js';

/** A printed link always uses the public domain, including on previews. */
export const publicShopUrl = (shop) => `${SITE_ORIGIN}/@${encodeURIComponent(shop.slug)}`;

/** Reuses shop.js and its existing shop-copy handler; one copy control. */
export function shopSharing({ shop }) {
  const url = publicShopUrl(shop);
  return `<section class="seller-sharing" aria-label="${esc(T.title)}">` +
    `<a class="seller-sharing__url" href="${esc(url)}" dir="ltr">${esc(url)}</a>` +
    `<div class="seller-sharing__actions">` +
    `<button class="btn btn--quiet" type="button" id="shop-copy" data-url="${esc(url)}" data-copied="${esc(T.copied)}">${esc(T.copy)}</button>` +
    `<a class="btn btn--ghost" href="/app/qr">${esc(T.qr)}</a></div>` +
    `<p class="seller-sharing__hint">${esc(T.helper)}</p>` +
    `<p class="share-status seller-sharing__status" role="status" aria-live="polite"></p>` +
    `</section>`;
}
