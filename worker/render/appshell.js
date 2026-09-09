import {
  CATEGORIES_UI as C, PLAN_BANNER, PRODUCT, PROFILE, SAVED, UI,
} from '../config.js';
import { esc } from './html.js';
import { shopHeader } from './shop.js';
import { settingsPanel } from './settings.js';
import { iconHeart, iconHome, iconPlus, iconTrash, iconUser } from './icons.js';

/**
 * Bottom nav, shared by the feed, /saved and the seller's area.
 * `active` is 'feed', 'saved' or 'account'.
 */
export function bottomNav(active, { accountLabel = UI.tabAccount } = {}) {
  const tab = (href, key, icon, label) =>
    `<a class="nav__tab" href="${esc(href)}"` +
    `${active === key ? ' aria-current="page"' : ''}>${icon}` +
    `<span>${esc(label)}</span></a>`;

  return (
    `<nav class="nav" aria-label="ناڤیگەیشن"><div class="nav__inner">` +
    tab('/', 'feed', iconHome(), UI.tabFeed) +
    tab('/saved', 'saved', iconHeart(22), SAVED.tab) +
    tab('/app', 'account', iconUser(), accountLabel) +
    `</div></nav>`
  );
}

/**
 * Every word the category rail needs, in one attribute.
 *
 * The rail is built in the browser from the public shop page, so its
 * labels cannot be server-rendered. They still belong in config.js
 * rather than hard-coded in the script, so they travel as data.
 */
const CATEGORY_UI = JSON.stringify({
  manage: C.manage,
  done: C.done,
  add: C.addInline,
  placeholder: C.addPlaceholder,
  create: C.create,
  cancel: C.cancel,
  rename: C.rename,
  save: C.save,
  remove: C.remove,
  confirm: C.deleteConfirm,
  error: C.errCreate,
});

/**
 * The plan running out, on the seller's own page.
 *
 * Amber while there is still time and the seller can close it; red once
 * the plan has ended, where there is no close button at all — by then
 * the shop is days from going dark, or already has, and a banner the
 * seller can make disappear is one they will.
 *
 * Exported because the settings panel shows the same thing. It is never
 * called from the public shop page or a product page: a customer must
 * not be shown a seller's billing state, and that HTML is edge-cached,
 * so it has to be byte-identical for everyone.
 */
export function planBannerHtml(banner) {
  if (!banner) return '';

  const text =
    banner.kind === 'hidden' ? PLAN_BANNER.hidden
    : banner.kind === 'grace' ? PLAN_BANNER.grace(banner.days)
    : banner.kind === 'pending' ? PLAN_BANNER.pending
    : banner.days <= 1 ? PLAN_BANNER.soonOne
    : PLAN_BANNER.soon(banner.days);

  const red = banner.kind === 'hidden' || banner.kind === 'grace';

  return (
    `<div class="plan-banner plan-banner--${esc(banner.kind)}" role="status">` +
    `<span class="plan-banner__text">${esc(text)}</span>` +
    (banner.kind === 'pending'
      ? ''
      : `<a class="plan-banner__action" href="/app/subscription">` +
        `${esc(PLAN_BANNER.action)}</a>`) +
    // Closing is "not now", never "never again": the server records when
    // it happened and brings the banner back on its own.
    (banner.dismissible && !red
      ? `<form class="plan-banner__close" method="post" action="/app/banner/dismiss">` +
        `<input type="hidden" name="kind" value="${esc(banner.kind)}">` +
        `<button type="submit" aria-label="${esc(PLAN_BANNER.dismiss)}">&times;</button>` +
        `</form>`
      : '') +
    `</div>`
  );
}

/** Owner controls stay inside the existing authenticated seller area. */
export function appShell({ shop, origin, banner = null, subscription = null }) {
  const controls =
    `<nav class="owner-controls" aria-label="بەڕێوەبردنی دوکان">` +
    `<a class="owner-control owner-control--primary" href="/app/profile">دەستکاری پرۆفایل</a>` +
    `<a class="owner-control" href="/app/new">${iconPlus(18)}<span>${esc(PRODUCT.add)}</span></a>` +
    `<a class="owner-control" id="settings-open" href="#account-settings">ڕێکخستن</a></nav>`;

  return (
    `<div class="page page--shop page--owner">` +
    planBannerHtml(banner) +
    shopHeader({ shop, origin, controls }) +
    `<section id="owner-products" class="shop-products" data-shop-url="${esc('/@' + shop.slug)}"` +
    ` data-cat-ui="${esc(CATEGORY_UI)}" aria-label="${esc(PRODUCT.listTitle)}">` +
    `<div class="notice"><a class="owner-preview-link" href="${esc('/@' + shop.slug)}">${esc(PROFILE.viewShop)} ‹</a></div>` +
    `</section></div>` +
    settingsPanel({ shop, banner, subscription }) +
    `<template id="owner-delete-control"><button class="card__heart owner-delete" type="button" aria-label="سڕینەوەی بەرهەم">${iconTrash(18)}</button></template>` +
    bottomNav('account', { accountLabel: 'هەژمار' }) +
    `<script src="/js/shop.js" defer></script>` +
    `<script src="/js/settings.js" defer></script>` +
    `<script src="/js/owner-profile.js" defer></script>`
  );
}
