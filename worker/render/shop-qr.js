import { APP_NAME, SHOP_SHARING as T } from '../config.js';
import { esc } from './html.js';
import { bottomNav } from './appshell.js';
import { iconBack } from './icons.js';
import { publicShopUrl } from './shop-sharing.js';

export function shopQrPage({ shop }) {
  const url = publicShopUrl(shop);
  return `<main class="shell shop-qr" id="shop-qr" data-url="${esc(url)}" data-slug="${esc(shop.slug)}"` +
    ` data-error="${esc(T.qrError)}" data-download-error="${esc(T.downloadError)}" data-downloaded="${esc(T.downloaded)}">` +
    `<header class="settings-head"><a class="icon-btn" href="/app#account-settings" aria-label="${esc(T.back)}">${iconBack()}</a>` +
    `<h1>${esc(T.qr)}</h1><span></span></header>` +
    `<section class="shop-qr__print" aria-label="${esc(T.title)}">` +
    `<p class="shop-qr__brand">${esc(APP_NAME)}</p><h2>${esc(shop.name)}</h2>` +
    `<canvas class="shop-qr__code" id="shop-qr-canvas" role="img" aria-label="${esc(T.qr)}: ${esc(shop.name)}" hidden></canvas>` +
    `<p>${esc(T.scan)}</p>` +
    `<a class="seller-sharing__url" dir="ltr" href="${esc(url)}">${esc(url)}</a></section>` +
    `<button class="btn btn--primary" id="qr-download" type="button" disabled>${esc(T.download)}</button>` +
    `<div class="seller-sharing__actions">` +
    `<button class="btn btn--quiet" id="shop-copy" type="button" data-url="${esc(url)}" data-copied="${esc(T.copied)}">${esc(T.copy)}</button>` +
    `<button class="btn btn--quiet" id="share-btn" type="button" data-url="${esc(url)}" data-title="${esc(shop.name)}" data-copied="${esc(T.copied)}">${esc(T.share)}</button></div>` +
    `<p class="share-status seller-sharing__status" role="status" aria-live="polite"></p>` +
    `<p class="shop-qr__status" id="qr-status" role="status" aria-live="polite"></p>` +
    `<p class="seller-sharing__hint">${esc(T.print)}</p>` +
    `<p class="seller-sharing__hint">${esc(T.slugWarning)}</p>` +
    `<noscript><p>${esc(T.noScript)}</p></noscript>` +
    `</main>` + bottomNav('account', { accountLabel: 'هەژمار' });
}
