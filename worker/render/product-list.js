import { PRODUCT as T, PRODUCT_FILTERS, UI } from '../config.js';
import { esc, price } from './html.js';
import { bottomNav } from './appshell.js';

const STATUS_LABEL = {
  active: T.visible,
  hidden: T.hidden,
  archived: PRODUCT_FILTERS[3].label,
};

export function productList({ products, filter }) {
  const chips = PRODUCT_FILTERS.map(
    (f) =>
      `<a class="chip" href="/app/products?filter=${esc(f.key)}"` +
      `${f.key === filter ? ' aria-current="true"' : ''}>${esc(f.label)}</a>`,
  ).join('');

  const rows = products.map(rowHtml).join('');

  return (
    `<div class="shell">` +
    `<div class="shell__head">` +
    `<h1 class="shell__title">${esc(T.listTitle)}</h1>` +
    `<a class="btn btn--primary btn--compact" href="/app/new">${esc(T.add)}</a>` +
    `</div>` +

    `<nav class="chips chips--inline" aria-label="${esc(T.listTitle)}">${chips}</nav>` +

    (products.length
      ? `<div class="rows">${rows}</div>`
      : `<div class="empty"><p class="empty__title">${esc(T.emptyTitle)}</p>` +
        `<p>${esc(T.emptyBody)}</p></div>`) +
    `</div>` +
    bottomNav('account')
  );
}

function rowHtml(product) {
  const images = (product.product_images ?? []).slice().sort((a, b) => a.position - b.position);
  const cover = images[0]?.r2_key;

  return (
    `<a class="row" href="/app/products/${esc(product.id)}">` +
    (cover
      ? `<img class="row__img" src="/img/${esc(cover)}" alt="" width="56" height="70"` +
        ` loading="lazy" decoding="async">`
      : `<span class="row__img row__img--empty"></span>`) +
    `<span class="row__body">` +
    `<span class="row__title">${esc(product.title)}</span>` +
    `<span class="row__price"><b>${esc(price(product.price))}</b> ` +
    `<span class="card__currency">${esc(UI.currency)}</span></span>` +
    `</span>` +
    `<span class="row__meta">` +
    `<span class="pill pill--${esc(product.status)}">` +
    `${esc(STATUS_LABEL[product.status] ?? product.status)}</span>` +
    `<span class="row__count">${images.length}</span>` +
    `</span></a>`
  );
}
