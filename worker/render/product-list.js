import { FREE_PRODUCT_LIMIT, PRODUCT as T, PRODUCT_FILTERS, UI } from '../config.js';
import { esc, price } from './html.js';
import { alert } from './forms.js';
import { bottomNav } from './appshell.js';
import { iconTrash } from './icons.js';

const STATUS_LABEL = {
  active: T.visible,
  hidden: T.hidden,
  archived: PRODUCT_FILTERS[3].label,
};

export function productList({ products, filter = 'all', error }) {
  const rows = products.map(rowHtml).join('');

  return (
    `<div class="shell product-manager">` +
    `<div class="shell__head">` +
    `<h1 class="shell__title">${esc(T.listTitle)}</h1>` +
    `<a class="btn btn--primary btn--compact" href="/app/new">${esc(T.add)}</a>` +
    `</div>` +

    alert(error) +
    `<nav class="manager-filters" aria-label="پاڵاوتنی بەرهەمەکان">` +
    PRODUCT_FILTERS.slice(0, 3).map(f => `<a href="/app/products?filter=${f.key}"${f.key === filter ? ' aria-current="page"' : ''}>${esc(f.label)}</a>`).join('') + `</nav>` +
    `<p class="manager-help">بۆ دەستکاری یان گۆڕینی دۆخی بەرهەم، لەسەری بدە.</p>` +
    (filter === 'hidden' ? `<p class="manager-help manager-help--hidden">بەرهەم و وێنە شاراوەکان نەسڕاونەتەوە. لە پلانی بەخۆڕاییدا دەتوانیت تا ${FREE_PRODUCT_LIMIT} بەرهەم ئاشکرا بکەیت؛ ئەگەر پڕە، سەرەتا یەکێک بشارەوە. پارەدان بەرهەمە شاراوەکان خۆکار بڵاو ناکاتەوە.</p>` : '') +

    (products.length
      ? `<div class="rows">${rows}</div>`
      : `<div class="empty"><p class="empty__title">${esc(filter === 'all' ? T.emptyTitle : 'هیچ بەرهەمێک لەم دۆخەدا نییە')}</p>` +
        (filter === 'all' ? `<p>${esc(T.emptyBody)}</p>` : '') + `</div>`) +
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
    `<span class="row__price"><b>${esc(price(product.price))}</b> ` +
    `<span class="card__currency">${esc(UI.currency === 'IQD' ? 'د.ع' : UI.currency)}</span></span>` +
    `<span class="pill pill--${esc(product.status)}">` +
    `${esc(STATUS_LABEL[product.status] ?? product.status)}</span>` +
    `</span></a>` +
    `<form method="post" action="/app/products/${esc(product.id)}/delete" onsubmit="return confirm('${esc(T.deleteConfirm)}')">` +
    `<button class="manager-delete" type="submit" aria-label="${esc(T.delete + ' ' + product.title)}">${iconTrash(18)}</button></form></article>`
  );
}
