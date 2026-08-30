import { APP_UI, AUTH, CATEGORIES_UI, PRODUCT, PROFILE, SUBSCRIPTION, UI } from '../config.js';
import { esc } from './html.js';
import { iconHome, iconUser } from './icons.js';

/** Bottom nav, shared with the feed. `active` is 'feed' or 'account'. */
export function bottomNav(active) {
  const tab = (href, key, icon, label) =>
    `<a class="nav__tab" href="${esc(href)}"` +
    `${active === key ? ' aria-current="page"' : ''}>${icon}` +
    `<span>${esc(label)}</span></a>`;

  return (
    `<nav class="nav" aria-label="ناڤیگەیشن"><div class="nav__inner">` +
    tab('/', 'feed', iconHome(), UI.tabFeed) +
    tab('/app', 'account', iconUser(), UI.tabAccount) +
    `</div></nav>`
  );
}

const menuLink = (href, label) =>
  `<a class="app-menu__item" href="${esc(href)}">` +
  `<span>${esc(label)}</span><span class="app-menu__go">‹</span></a>`;

/**
 * The seller's area. Deliberately close to empty — this session builds
 * the shell and the guard; products, profile editing and stats land later.
 */
export function appShell({ shop, origin }) {
  const url = `${origin}/@${shop.slug}`;

  const row = (label, value, ltr = false) =>
    `<div class="card-block"><p class="card-block__label">${esc(label)}</p>` +
    `<p class="card-block__value${ltr ? ' card-block__value--ltr' : ''}"` +
    `${ltr ? ' dir="ltr"' : ''}>${esc(value)}</p></div>`;

  return (
    `<div class="shell">` +
    `<div class="shell__head">` +
    `<h1 class="shell__title">${esc(APP_UI.title)}</h1>` +
    `<form method="post" action="/logout">` +
    `<button class="btn btn--ghost" type="submit">${esc(AUTH.logout)}</button>` +
    `</form>` +
    `</div>` +

    `<div class="card-block">` +
    `<p class="card-block__label">${esc(APP_UI.yourLink)}</p>` +
    `<div class="link-row">` +
    `<span id="shop-url">${esc(url)}</span>` +
    `<button class="copy-btn" type="button" id="copy-link"` +
    ` data-copied="${esc(APP_UI.copied)}">${esc(APP_UI.copy)}</button>` +
    `</div></div>` +

    row(APP_UI.shopName, shop.name) +
    row(APP_UI.city, shop.city) +
    row(APP_UI.whatsapp, shop.whatsapp, true) +

    `<nav class="app-menu">` +
    menuLink('/app/products', PRODUCT.listTitle) +
    menuLink('/app/new', PRODUCT.add) +
    menuLink('/app/profile', PROFILE.title) +
    menuLink('/app/categories', CATEGORIES_UI.title) +
    menuLink('/app/subscription', SUBSCRIPTION.title) +
    `</nav>` +
    `</div>` +
    bottomNav('account')
  );
}
