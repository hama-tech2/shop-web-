import { APP_NAME, APP_TAGLINE, CHIPS, LOCALES, SLIDE_MS, UI } from '../config.js';
import { attr, esc, price } from './html.js';
import { iconGlobe, iconHeart, iconSearch } from './icons.js';
import { bottomNav } from './appshell.js';

/** R2 keys are stored, never URLs. This is the only place one becomes a URL. */
const imgUrl = (key) => `/img/${key.split('/').map(encodeURIComponent).join('/')}`;

/**
 * One product card.
 *
 * First image is eager on the first row and lazy after; the remaining
 * images of a multi-image card carry `data-src` and are only given a real
 * `src` once the card is fully on screen. That keeps a cheap Android
 * phone from decoding images nobody has looked at.
 */
export function cardHtml(product, index, { linked = true, saved = false } = {}) {
  const [first, ...rest] = product.images;
  const href = linked && product.shopSlug
    ? `/@${encodeURIComponent(product.shopSlug)}/p/${encodeURIComponent(product.id)}`
    : null;
  const multi = product.images.length > 1;
  const eager = index < 2;

  const firstImg = first
    ? `<img class="card__img is-active" src="${esc(imgUrl(first))}"` +
      ` width="360" height="450" alt=""` +
      ` loading="${eager ? 'eager' : 'lazy'}" decoding="async"` +
      `${eager ? ' fetchpriority="high"' : ''}>`
    : '';

  const restImgs = rest
    .map(
      (key) =>
        `<img class="card__img" data-src="${esc(imgUrl(key))}"` +
        ` width="360" height="450" alt="" decoding="async">`,
    )
    .join('');

  const dots = multi
    ? `<div class="dots">${product.images
        .map((_, i) => `<span class="dot${i === 0 ? ' is-active' : ''}"></span>`)
        .join('')}</div>`
    : '';

  const avatar = product.shopLogo
    ? `<img class="shop-avatar" src="${esc(imgUrl(product.shopLogo))}" width="22" height="22" alt="" loading="lazy" decoding="async">`
    : `<span class="shop-avatar" aria-hidden="true">${esc(
        [...product.shopName.trim()][0] ?? '؟',
      )}</span>`;

  return (
    `<article class="card">` +
    // A stretched link rather than wrapping the card: the heart is a
    // button, and a button inside an anchor is invalid and untappable.
    (href
      ? `<a class="card__hit" href="${esc(href)}" aria-label="${esc(product.title)}"></a>`
      : '') +
    `<div class="card__media"${multi ? ` data-multi="${product.images.length}"` : ''}>` +
    firstImg +
    restImgs +
    dots +
    `<button class="card__heart" type="button" aria-pressed="${saved ? 'true' : 'false'}"` +
    ` data-fav="${esc(product.id)}"` +
    ` aria-label="${esc(UI.save)}">${iconHeart()}</button>` +
    `</div>` +
    `<div class="card__body">` +
    `<h2 class="card__title">${esc(product.title)}</h2>` +
    `<p class="card__price">` +
    `<span class="card__amount">${esc(price(product.price))}</span>` +
    `<span class="card__currency">${esc(UI.currency)}</span>` +
    `</p>` +
    `<div class="card__shop">${avatar}` +
    `<span class="card__shop-name">${esc(product.shopName)}</span></div>` +
    `</div>` +
    `</article>`
  );
}

/** The cards-only fragment the load-more button appends. */
export function cardsFragment(products, startIndex, options) {
  return products.map((p, i) => cardHtml(p, startIndex + i, options)).join('');
}

function headerHtml({ query }) {
  const clear = query
    ? `<a class="search__clear" href="/">✕</a>`
    : '';

  return (
    `<header class="header">` +
    `<div class="header__top">` +
    `<h1 class="header__name">${esc(APP_NAME)}</h1>` +
    `<button class="icon-btn" type="button" id="lang-btn"` +
    ` aria-haspopup="dialog" aria-label="${esc(UI.language)}">${iconGlobe()}</button>` +
    `</div>` +
    // Submits to /search, which has the tabs and the typo-tolerant
    // matching. /?q= still renders, so old links keep working.
    `<form class="search" role="search" action="/search" method="get">` +
    `<span class="search__icon">${iconSearch()}</span>` +
    `<input class="search__input" type="search" name="q"` +
    ` value="${esc(query ?? '')}" placeholder="${esc(UI.searchPlaceholder)}"` +
    ` enterkeyhint="search" autocomplete="off">` +
    clear +
    `</form>` +
    `</header>`
  );
}

function chipsHtml({ category, query }) {
  const items = CHIPS.map((chip) => {
    const params = new URLSearchParams();
    if (chip.slug) params.set('category', chip.slug);
    if (query) params.set('q', query);
    const href = params.toString() ? `/?${params}` : '/';
    const current = (category ?? null) === chip.slug;

    return (
      `<a class="chip" href="${esc(href)}"` +
      `${current ? ' aria-current="true"' : ''}>${esc(chip.label)}</a>`
    );
  }).join('');

  return `<nav class="chips" aria-label="جۆرەکان">${items}</nav>`;
}

function sheetHtml() {
  const options = LOCALES.map(
    (l) =>
      `<button class="lang" type="button" data-locale="${esc(l.code)}"` +
      `${l.ready ? ' aria-current="true"' : ' disabled'}>` +
      `<span>${esc(l.label)}</span>` +
      `${l.ready ? '' : `<span class="lang__soon">${esc(UI.soon)}</span>`}` +
      `</button>`,
  ).join('');

  return (
    `<div class="sheet-scrim" id="sheet-scrim" hidden></div>` +
    `<div class="sheet" id="lang-sheet" role="dialog" aria-modal="true"` +
    ` aria-label="${esc(UI.language)}" hidden>` +
    `<p class="sheet__title">${esc(UI.language)}</p>${options}</div>`
  );
}

function loadMoreHtml({ category, query, nextOffset, hasMore }) {
  if (!hasMore) return '';

  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (query) params.set('q', query);
  params.set('offset', String(nextOffset));

  // A real link, so it still works with no JS. The script upgrades it
  // into an append-in-place fetch.
  return (
    `<div class="load-more-wrap">` +
    `<a class="load-more" id="load-more" href="/?${esc(params.toString())}"` +
    ` data-offset="${nextOffset}" data-loading-label="${esc(UI.loading)}"` +
    `>${esc(UI.loadMore)}</a>` +
    `</div>`
  );
}

/** The whole feed page body. */
export function feedHtml({ products, hasMore, category, query, offset, pageSize }) {
  const grid = products.length
    ? `<div class="grid" id="grid">${cardsFragment(products, offset)}</div>`
    : `<div class="empty"><p class="empty__title">${esc(UI.emptyTitle)}</p>` +
      `<p>${esc(UI.emptyBody)}</p></div>`;

  return (
    `<div class="page" data-slide-ms="${SLIDE_MS}">` +
    headerHtml({ query }) +
    chipsHtml({ category, query }) +
    grid +
    loadMoreHtml({ category, query, nextOffset: offset + pageSize, hasMore }) +
    `</div>` +
    bottomNav('feed') +
    sheetHtml()
  );
}

export const feedTitle = (query) =>
  query ? `${query} — ${APP_NAME}` : `${APP_NAME} · ${APP_TAGLINE}`;
