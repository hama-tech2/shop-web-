/**
 * /search — one screen, two tabs.
 *
 * Server-rendered like everything else, so a result page is a real URL
 * a customer can send to someone. The empty state never dead-ends: it
 * always offers the category chips as a way back into the catalogue.
 */

import { APP_NAME, CHIPS, CITY_LABEL, SEARCH as T } from '../config.js';
import { esc } from './html.js';
import { cardsFragment } from './feed.js';
import { bottomNav } from './appshell.js';
import { iconBack, iconPin, iconSearch } from './icons.js';

const imgUrl = (key) => `/img/${key.split('/').map(encodeURIComponent).join('/')}`;

const TABS = [
  { key: 'products', label: 'پۆستەکان' },
  { key: 'shops', label: T.tabShops },
];

function headHtml(query, tab) {
  return (
    `<header class="srch-head">` +
    `<a class="icon-btn srch-back" href="/" aria-label="گەڕانەوە">${iconBack()}</a>` +
    `<h1 class="srch-title">${esc(T.title)}</h1>` +
    `<div class="srch-box">` +
    `<form class="search srch-form" role="search" action="/search" method="get">` +
    `<input type="hidden" name="tab" value="${esc(tab)}">` +
    `<button class="search__icon" type="submit" aria-label="${esc(T.title)}">${iconSearch()}</button>` +
    `<input class="search__input" id="search-query" type="search" name="q" value="${esc(query ?? '')}"` +
    ` placeholder="${esc(T.placeholder)}" enterkeyhint="search"` +
    ` autocomplete="off" maxlength="80" aria-label="${esc(T.placeholder)}" aria-controls="search-suggestions">` +
    `<a class="search__clear" href="/search?tab=${esc(tab)}" aria-label="${esc(T.clear)}"${query ? '' : ' hidden'}>✕</a>` +
    `</form>` +
    `<ul class="srch-suggestions" id="search-suggestions" aria-label="پێشنیاری بەرهەم" hidden></ul></div>` +
    `</header>`
  );
}

function tabsHtml(query, tab, counts) {
  return (
    `<nav class="srch-tabs" aria-label="${esc(T.title)}">` +
    TABS.map((t) => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      params.set('tab', t.key);
      const n = counts[t.key];
      return (
        `<a class="srch-tab" href="/search?${esc(params.toString())}"` +
        `${t.key === tab ? ' aria-current="true"' : ''}>${esc(t.label)}` +
        (n ? `<span class="srch-tab__n" dir="ltr">${esc(n)}</span>` : '') +
        `</a>`
      );
    }).join('') +
    `</nav>`
  );
}

/** Category chips as an escape hatch, not as a filter. */
function suggestions() {
  return (
    `<nav class="chips chips--wrap" aria-label="جۆرەکان">` +
    CHIPS.filter((c) => c.slug)
      .map((c) => `<a class="chip" href="/?category=${esc(c.slug)}">${esc(c.label)}</a>`)
      .join('') +
    `</nav>`
  );
}

const emptyHtml = (title, body) =>
  `<div class="empty"><p class="empty__title">${esc(title)}</p>` +
  `<p>${esc(body)}</p></div>` + suggestions();

function shopRow(shop) {
  const avatar = shop.logo_key
    ? `<img class="srch-shop__logo" src="${esc(imgUrl(shop.logo_key))}"` +
      ` width="48" height="48" alt="" loading="lazy" decoding="async">`
    : `<span class="srch-shop__logo srch-shop__logo--text" aria-hidden="true">` +
      `${esc([...(shop.name || '').trim()][0] ?? '؟')}</span>`;

  const city = CITY_LABEL[shop.city] || '';

  return (
    `<a class="srch-shop" href="/@${esc(encodeURIComponent(shop.slug))}" data-preview="${(shop.product_count ?? 0) > 0 ? 'true' : 'false'}">` +
    avatar +
    `<div class="srch-shop__body">` +
    `<p class="srch-shop__name">${esc(shop.name)}</p>` +
    `<p class="srch-shop__username"><bdi dir="ltr">@${esc(shop.slug)}</bdi></p>` +
    `<p class="srch-shop__meta">${esc(T.productsOf(shop.product_count ?? 0))}</p>` +
    (shop.bio ? `<p class="srch-shop__summary">${esc(shop.bio)}</p>` :
      city ? `<p class="srch-shop__meta">${iconPin()}<span>${esc(city)}</span></p>` : '') +
    `</div>` +
    `<span class="srch-shop__go" dir="ltr" aria-hidden="true">‹</span>` +
    `<span class="srch-shop__previews" aria-hidden="true" hidden></span>` +
    `</a>`
  );
}

export function searchPage({ query, tab, products, shops, counts }) {
  let body;

  if (!query) {
    body = emptyHtml(T.startTitle, T.startBody);
  } else if (tab === 'shops') {
    body = shops.length
      ? `<div class="srch-shops">${shops.map(shopRow).join('')}</div>`
      : emptyHtml(T.emptyTitle, T.noShops);
  } else {
    body = products.length
      ? `<div class="grid" id="grid">${cardsFragment(products, 0)}</div>`
      : emptyHtml(T.emptyTitle, T.emptyBody);
  }

  return (
    `<div class="page page--search">` +
    headHtml(query, tab) +
    tabsHtml(query, tab, counts) +
    body +
    `</div>` + bottomNav('feed') +
    `<script src="/js/search.js" defer></script>`
  );
}

export const searchTitle = (query) =>
  query ? `${query} — ${T.title} · ${APP_NAME}` : `${T.title} — ${APP_NAME}`;
