import { SITE_ORIGIN, SHOP_SHARING as T } from '../config.js';
import { esc } from './html.js';

/** A printed link always uses the public domain, including on previews. */
export const publicShopUrl = (shop) => `${SITE_ORIGIN}/@${encodeURIComponent(shop.slug)}`;

/** Reuses shop.js and its existing shop-copy handler; one copy control. */
export function shopSharing({ shop, compact = false }) {
  const url = publicShopUrl(shop);
  return `<section class="seller-sharing" aria-label="${esc(T.title)}">` +
    `<a class="seller-sharing__url" href="${esc(url)}" dir="ltr">${esc(url)}</a>` +
    `<div class="seller-sharing__actions">` +
    `<button class="btn btn--quiet" type="button" id="shop-copy" data-url="${esc(url)}" data-copied="${esc(T.copied)}">${esc(compact ? 'کۆپی لینک' : T.copy)}</button>` +
    `<a class="btn btn--ghost" href="/app/qr" aria-label="${esc(T.qr)}">${esc(compact ? 'کۆدی QR' : T.qr)}</a></div>` +
    `<p class="seller-sharing__hint">${esc(compact ? 'لینکەکە لە بایۆی TikTok و Instagram دابنێ.' : T.helper)}</p>` +
    `<p class="share-status seller-sharing__status" role="status" aria-live="polite"></p>` +
    `</section>`;
}
