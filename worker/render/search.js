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
import { iconBack, iconPin, iconSearch } from './icons.js';

const imgUrl = (key) => `/img/${key.split('/').map(encodeURIComponent).join('/')}`;

const TABS = [
  { key: 'products', label: T.tabProducts },
  { key: 'shops', label: T.tabShops },
];

function headHtml(query, tab) {
  return (
    `<header class="srch-head">` +
    `<a class="icon-btn srch-back" href="/" aria-label="${esc(T.title)}">${iconBack()}</a>` +
    `<form class="search srch-form" role="search" action="/search" method="get">` +
    `<input type="hidden" name="tab" value="${esc(tab)}">` +
    `<span class="search__icon">${iconSearch()}</span>` +
    `<input class="search__input" type="search" name="q" value="${esc(query ?? '')}"` +
    ` placeholder="${esc(T.placeholder)}" enterkeyhint="search"` +
    ` autocomplete="off" autofocus>` +
    (query ? `<a class="search__clear" href="/search" aria-label="${esc(T.clear)}">✕</a>` : '') +
    `</form>` +
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
    `<a class="srch-shop" href="/@${esc(shop.slug)}">` +
    avatar +
    `<div class="srch-shop__body">` +
    `<p class="srch-shop__name">${esc(shop.name)}</p>` +
    (city ? `<p class="srch-shop__meta">${iconPin()}<span>${esc(city)}</span></p>` : '') +
    `<p class="srch-shop__meta">${esc(T.productsOf(shop.product_count ?? 0))}</p>` +
    `</div>` +
    `<span class="srch-shop__go">‹</span>` +
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
    (query ? tabsHtml(query, tab, counts) : '') +
    body +
    `</div>`
  );
}

export const searchTitle = (query) =>
  query ? `${query} — ${T.title} · ${APP_NAME}` : `${T.title} — ${APP_NAME}`;
