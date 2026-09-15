import { PRODUCT as T, PRODUCT_FILTERS } from '../config.js';
import { esc } from './html.js';
import { moneyHtml } from './money.js';
import { alert } from './forms.js';
import { bottomNav } from './appshell.js';
import { iconTrash } from './icons.js';

const STATUS_LABEL = {
  active: T.visible,
  hidden: T.hidden,
  archived: PRODUCT_FILTERS[3].label,
};

export function productList({ products, error }) {
  const rows = products.map(rowHtml).join('');

  return (
    `<div class="shell product-manager">` +
    `<div class="shell__head">` +
    `<h1 class="shell__title">${esc(T.listTitle)}</h1>` +
    `<a class="btn btn--primary btn--compact" href="/app/new">${esc(T.add)}</a>` +
    `</div>` +

    alert(error) +
    // One list. Every product is here, visible and hidden alike, each
    // row wearing its own status badge — so a hidden product is never
    // somewhere else, it is just marked.
    `<p class="manager-help">${esc(T.listHelp)}</p>` +

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
    `<article class="row manager-row"><a class="manager-row__edit" href="/app/products/${esc(product.id)}" aria-label="${esc(T.edit + ' ' + product.title)}">` +
    (cover
      ? `<img class="row__img" src="/img/${esc(cover)}" alt="" width="56" height="70"` +
        ` loading="lazy" decoding="async">`
      : `<span class="row__img row__img--empty"></span>`) +
    `<span class="row__body">` +
    `<span class="row__title">${esc(product.title)}</span>` +
    moneyHtml(product.price, product.currency, {
      cls: 'row__price', amountClass: 'row__amount', currencyClass: 'card__currency',
    }) +
    `<span class="pill pill--${esc(product.status)}">` +
    `${esc(STATUS_LABEL[product.status] ?? product.status)}</span>` +
    `</span></a>` +
    `<form method="post" action="/app/products/${esc(product.id)}/delete" onsubmit="return confirm('${esc(T.deleteConfirm)}')">` +
    `<button class="manager-delete" type="submit" aria-label="${esc(T.delete + ' ' + product.title)}">${iconTrash(18)}</button></form></article>`
  );
}
