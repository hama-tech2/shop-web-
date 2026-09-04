import {
  PRODUCT, PROFILE, SAVED, UI,
} from '../config.js';
import { esc } from './html.js';
import { shopHeader } from './shop.js';
import { settingsPanel } from './settings.js';
import { iconHeart, iconHome, iconPlus, iconTrash, iconUser } from './icons.js';

/**
 * Bottom nav, shared by the feed, /saved and the seller's area.
 * `active` is 'feed', 'saved' or 'account'.
 */
export function bottomNav(active) {
  const tab = (href, key, icon, label) =>
    `<a class="nav__tab" href="${esc(href)}"` +
    `${active === key ? ' aria-current="page"' : ''}>${icon}` +
    `<span>${esc(label)}</span></a>`;

  return (
    `<nav class="nav" aria-label="ناڤیگەیشن"><div class="nav__inner">` +
    tab('/', 'feed', iconHome(), UI.tabFeed) +
    tab('/saved', 'saved', iconHeart(22), SAVED.tab) +
    tab('/app', 'account', iconUser(), UI.tabAccount) +
    `</div></nav>`
  );
}

/** Owner controls stay inside the existing authenticated seller area. */
export function appShell({ shop, origin }) {
  const controls =
    `<nav class="owner-controls" aria-label="بەڕێوەبردنی دوکان">` +
    `<a class="owner-control owner-control--primary" href="/app/profile">دەستکاری پرۆفایل</a>` +
    `<a class="owner-control" href="/app/new">${iconPlus(18)}<span>${esc(PRODUCT.add)}</span></a>` +
    `<a class="owner-control" id="settings-open" href="#account-settings">ڕێکخستن</a></nav>`;

  return (
    `<div class="page page--shop page--owner">` +
    shopHeader({ shop, origin, controls }) +
    `<section id="owner-products" class="shop-products" data-shop-url="${esc('/@' + shop.slug)}" aria-label="${esc(PRODUCT.listTitle)}">` +
    `<div class="notice"><a class="owner-preview-link" href="${esc('/@' + shop.slug)}">${esc(PROFILE.viewShop)} ‹</a></div>` +
    `</section></div>` +
    settingsPanel({ shop }) +
    `<template id="owner-delete-control"><button class="card__heart owner-delete" type="button" aria-label="سڕینەوەی بەرهەم">${iconTrash(18)}</button></template>` +
    bottomNav('account') +
    `<script src="/js/shop.js" defer></script>` +
    `<script src="/js/settings.js" defer></script>` +
    `<script src="/js/owner-profile.js" defer></script>`
  );
}
