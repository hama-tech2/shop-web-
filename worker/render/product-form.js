import {
  CURRENCY_UI as CUR, FREE_IMAGE_LIMIT, FREE_PRODUCT_LIMIT,
  IMAGE_VARIANTS, MAX_IMAGES, PRODUCT_CURRENCIES, PRODUCT as T,
  DEFAULT_VISIBILITY, PRODUCT_VISIBILITY, VISIBILITY_UI,
} from '../config.js';
import { esc, price as fmtPrice } from './html.js';
import { currencyOf, moneyText, symbolOf } from './money.js';
import { alert, field } from './forms.js';
import { iconBack, iconPlus } from './icons.js';
import { productCover } from './product-cover.js';

/**
 * The permanent Free allowance is full.
 *
 * Shown instead of the form, because offering a form that cannot be
 * submitted is worse than saying so. It names the limit, says the
 * existing products are safe, and links to the plans — a refusal with
 * nowhere to go is where a seller gives up.
 */
export function trialLimitPage() {
  return (
    `<div class="shell publish-page">` +
    `<header class="publish-head"><a class="icon-btn" href="/app" aria-label="گەڕانەوە">${iconBack()}</a>` +
    `<h1>${esc(T.trialLimitTitle)}</h1><span></span></header>` +
    `<div class="notice notice--tall trial-limit">` +
    `<p class="notice__title">${esc(T.trialLimitTitle)}</p>` +
    `<p>${esc(T.trialLimitBody(FREE_PRODUCT_LIMIT))}</p>` +
    `<a class="btn btn--primary" href="/app/subscription">${esc(T.trialLimitAction)}</a>` +
    `<a class="btn btn--ghost" href="/app">${esc(T.listTitle)}</a>` +
    `</div></div>`
  );
}

export function productForm({ mode, draftId, categories, values, error, trialLeft = null, imageLimit: editImageLimit = MAX_IMAGES }) {
  const isEdit = mode === 'edit';
  if (isEdit) return editProductForm({ draftId, categories, values, error, imageLimit: editImageLimit });
  const images = values.images ?? [];
  // A numeric slot count is supplied by the server for Free creation only.
  // Editing retains the existing gallery, including images from a paid plan.
  const imageLimit = !isEdit && trialLeft !== null ? FREE_IMAGE_LIMIT : editImageLimit;
  return (
    `<div class="shell publish-page">` +
    `<header class="publish-head"><a class="icon-btn" href="/app" aria-label="گەڕانەوە">${iconBack()}</a>` +
    `<h1>${esc(isEdit ? T.editTitle : T.newTitle)}</h1>` +
    `<details class="publish-help"><summary>ڕێنمایی ⓘ</summary>` +
    `<p>تا ${imageLimit} وێنە زیاد بکە. وێنەیەک هەڵبژێرە بۆ کاڤەر؛ بە دوگمەکانی ڕیزکردن شوێنی وێنەکان بگۆڕە.</p></details></header>` +
    `<p class="publish-sub">زانیارییەکانی بەرهەمەکەت زیاد بکە و بڵاوی بکەرەوە.</p>` +
    alert(error) +
    (isEdit && images.length > imageLimit ? `<p class="publish-free-left">وێنە پێشووەکانت پارێزراون. لە پلانی بەخۆڕاییدا تەنها ${FREE_IMAGE_LIMIT} وێنە بۆ بەرهەمی نوێ بەردەستە.</p>` : '') +
    // Remaining account slots come from the existing server read.
    (trialLeft === null
      ? ''
      : `<p class="publish-free-left">${esc(T.trialLeft(trialLeft, FREE_PRODUCT_LIMIT))}</p>`) +
    `<form method="post" id="product-form" action="${esc(isEdit ? `/app/products/${draftId}` : '/app/new')}"` +
    ` data-mode="${esc(mode)}" data-restore-category="${!isEdit && !error && !values.category && !images.length}"` +
    ` data-draft="${esc(draftId)}" data-max="${imageLimit}"` +
    ` data-card-w="${IMAGE_VARIANTS.card.width}" data-card-h="${IMAGE_VARIANTS.card.height}" data-card-q="${IMAGE_VARIANTS.card.quality}"` +
    ` data-full-w="${IMAGE_VARIANTS.full.width}" data-full-h="${IMAGE_VARIANTS.full.height}" data-full-q="${IMAGE_VARIANTS.full.quality}"` +
    ` data-msg-limit="تا ${imageLimit} وێنە دەتوانیت زیاد بکەیت." data-msg-type="${esc(T.errType)}" data-msg-upload="${esc(T.errUpload)}"` +
    `>` +
    `<input type="hidden" name="draft_id" value="${esc(draftId)}">` +
    `<input type="hidden" name="images" id="images-field" value="${esc(JSON.stringify(images))}">` +
    (isEdit ? `<div class="field"><label class="field__label" for="status-field">دۆخی بەرهەم</label>` +
      `<select class="field__input" name="status" id="status-field"><option value="active"${values.status === 'active' ? ' selected' : ''}>ئاشکرا</option>` +
      `<option value="hidden"${values.status === 'hidden' ? ' selected' : ''}>شاراوە</option></select>` +
      `<p class="field__hint">بۆ گۆڕینی بەرهەمە ئاشکراکان لە پلانی بەخۆڕاییدا، سەرەتا یەکێک بشارەوە و پاشەکەوتی بکە، پاشان ئەوی تر ئاشکرا بکە.</p></div>`
      : `<input type="hidden" name="status" id="status-field" value="${esc(values.status ?? 'active')}">`) +
    `<section class="gallery" aria-label="${esc(T.photos)}">` +
    `<div class="gallery__head"><span class="field__label">وێنەکان <small>(تا ${imageLimit} وێنە)</small></span>` +
    `<span class="gallery__count" id="photo-count" aria-live="polite">${esc(images.length > imageLimit ? `${images.length} وێنەی پارێزراو` : T.counter(images.length, imageLimit))}</span></div>` +
    `<div class="thumbs" id="thumbs">${images.map((img, i) => thumbHtml(img, i)).join('')}` +
    `<button class="thumb thumb--add" type="button" id="add-photo" aria-label="${esc(T.addPhoto)}">${iconPlus()}<span>زیادکردن</span></button></div>` +
    `<input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" multiple hidden>` +
    `<p class="gallery-hint">وێنەیەک هەڵبژێرە بۆ ڕێکخستنی کاڤەر · ⇄ بۆ ڕیزکردن</p></section>` +
    `<p id="product-message" class="publish-message" role="status" aria-live="polite" hidden></p>` +
    field({ name: 'title', label: T.titleLabel, value: values.title ?? '', placeholder: T.titlePlaceholder, extra: ' minlength="2" maxlength="200"' }) +
    priceFieldHtml(values) +
    `<div class="field"><label class="field__label" for="category-field">${esc(T.categoryLabel)} <span class="field__optional">${esc(T.optional)}</span></label>` +
    `<select class="field__input" name="category" id="category-field">` +
    [{ slug: '', name_ckb: T.categoryNone }, ...categories].map(c => `<option value="${esc(c.slug)}"${(values.category ?? '') === c.slug ? ' selected' : ''}>${esc(c.name_ckb)}</option>`).join('') +
    `</select><p class="field__hint">هەڵبژاردنەکەت بۆ بەرهەمی داهاتوو لەم وێبگەڕەدا دەمێنێتەوە.</p></div>` +
    visibilityField(values.visibility) +
    `<div class="field"><label class="field__label" for="f-description">پێناسە <span class="field__optional">${esc(T.optional)}</span></label>` +
    `<textarea class="field__input field__input--area" id="f-description" name="description" rows="3" placeholder="${esc(T.descriptionPlaceholder)}">${esc(values.description ?? '')}</textarea>` +
    `<span class="description-count" id="description-count"></span></div>` +
    `<div class="publish-save"><button class="btn btn--primary" type="submit" id="save-btn" data-saving="${esc(T.saving)}">${esc(isEdit ? T.save : 'بڵاو بکەرەوە')}</button>` +
    `<p>پێش پاشەکەوتکردن، وێنەکان و زانیارییەکان بپشکنە.</p></div></form>` +
    (isEdit ? `<form method="post" action="/app/products/${esc(draftId)}/delete" data-confirm="${esc(T.deleteConfirm)}"><button class="btn btn--ghost btn--danger" type="submit">${esc(T.delete)}</button></form>` : '') +
    `</div>` + productCover() + `<script src="/js/product-cover.js" defer></script>`
  );
}

/**
 * Editing is intentionally narrower than publishing. A seller may pick
 * and crop the cover, rename the product, or move it to a market
 * category. Price remains visible for context but is not submitted.
 * Contact details continue to come from the shop profile.
 */
function editProductForm({ draftId, categories, values, error, imageLimit }) {
  const images = values.images ?? [];
  return (
    `<div class="shell publish-page publish-page--edit">` +
    `<header class="publish-head"><a class="icon-btn" href="/app" aria-label="گەڕانەوە">${iconBack()}</a>` +
    `<h1>${esc(T.editTitle)}</h1><span></span></header>` +
    `<p class="publish-sub">کاڤەر، ناو، پۆل یان دەرکەوتنی بەرهەمەکە بگۆڕە.</p>` +
    alert(error) +
    `<form method="post" id="product-form" action="/app/products/${esc(draftId)}"` +
    ` data-mode="edit" data-cover-only="true" data-price="${esc(String(values.price ?? ''))}"` +
    ` data-restore-category="false" data-draft="${esc(draftId)}" data-max="${imageLimit}" data-storage-max="${MAX_IMAGES}"` +
    ` data-card-w="${IMAGE_VARIANTS.card.width}" data-card-h="${IMAGE_VARIANTS.card.height}" data-card-q="${IMAGE_VARIANTS.card.quality}"` +
    ` data-full-w="${IMAGE_VARIANTS.full.width}" data-full-h="${IMAGE_VARIANTS.full.height}" data-full-q="${IMAGE_VARIANTS.full.quality}"` +
    ` data-msg-limit="تا ${imageLimit} وێنە دەتوانیت زیاد بکەیت." data-msg-type="${esc(T.errType)}" data-msg-upload="${esc(T.errUpload)}"` +
    `>` +
    `<input type="hidden" name="draft_id" value="${esc(draftId)}">` +
    `<input type="hidden" name="images" id="images-field" value="${esc(JSON.stringify(images))}">` +
    `<section class="gallery gallery--cover-only" aria-label="کاڤەری بەرهەم">` +
    `<div class="gallery__head"><span class="field__label">کاڤەری بەرهەم</span>` +
    `<span class="gallery__count" id="photo-count" aria-live="polite">${esc(T.counter(images.length, imageLimit))}</span></div>` +
    `<div class="thumbs" id="thumbs">${images.map((img, i) => editThumbHtml(img, i)).join('')}` +
    `<button class="thumb thumb--add cover-change" type="button" id="add-photo" aria-label="گۆڕینی کاڤەر">${iconPlus()}<span>گۆڕینی کاڤەر</span></button></div>` +
    `<input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" hidden>` +
    `<p class="gallery-hint">وێنەیەک هەڵبژێرە بۆ کاڤەر؛ دەتوانیت بڕینەکەی ڕێک بخەیت.</p></section>` +
    `<p id="product-message" class="publish-message" role="status" aria-live="polite" hidden></p>` +
    field({ name: 'title', label: T.titleLabel, value: values.title ?? '', placeholder: T.titlePlaceholder, extra: ' minlength="2" maxlength="200"' }) +
    `<div class="field edit-price"><span class="field__label">${esc(T.priceLabel)}</span>` +
    `<div class="edit-price__value" aria-readonly="true"><span>${esc(moneyText(values.price, values.currency))}</span>` +
    `<small>گۆڕانکاری ناکرێت</small></div></div>` +
    `<div class="field"><label class="field__label" for="category-field">${esc(T.categoryLabel)} <span class="field__optional">${esc(T.optional)}</span></label>` +
    `<select class="field__input" name="category" id="category-field">` +
    [{ slug: '', name_ckb: T.categoryNone }, ...categories].map(c => `<option value="${esc(c.slug)}"${(values.category ?? '') === c.slug ? ' selected' : ''}>${esc(c.name_ckb)}</option>`).join('') +
    `</select></div>` +
    visibilityField(values.visibility) +
    `<div class="publish-save"><button class="btn btn--primary" type="submit" id="save-btn" data-saving="${esc(T.saving)}">${esc(T.save)}</button>` +
    `<p>تەنها کاڤەر، ناو، پۆل و دەرکەوتن پاشەکەوت دەکرێن.</p></div></form>` +
    `</div>` + productCover() + `<script src="/js/product-cover.js" defer></script>`
  );
}

/**
 * Where the product is shown.
 *
 * Two radios in the same segmented control the currency picker uses, so
 * it reads as one more choice rather than a new kind of setting. The
 * helper text spells out the less obvious profile-only choice, because
 * it sounds like hiding and is not: the product stays searchable and
 * public, and its direct link keeps working.
 */
function visibilityField(value) {
  const current = Object.hasOwn(PRODUCT_VISIBILITY, value) ? value : DEFAULT_VISIBILITY;
  const options = Object.values(PRODUCT_VISIBILITY).map((v) =>
    `<label class="seg__option">` +
    `<input type="radio" name="visibility" value="${esc(v.key)}"` +
    `${v.key === current ? ' checked' : ''}>` +
    `<span>${esc(v.label)}</span></label>`).join('');

  return (
    `<fieldset class="seg" id="visibility-seg">` +
    `<legend class="field__label">${esc(VISIBILITY_UI.legend)}</legend>` +
    `<div class="seg__row">${options}</div>` +
    `<p class="field__hint">${esc(VISIBILITY_UI.hint)}</p>` +
    `</fieldset>`
  );
}

/**
 * The price, and the currency it is in.
 *
 * One input and one choice, not two inputs. A product has a single
 * price; what the seller is choosing is what that number means, which
 * is why the selector sits inside the same bordered row as the input
 * rather than in a field of its own further down the form.
 *
 * Two radios styled as a segment, rather than a <select>: with exactly
 * two options a dropdown hides one of them behind a tap and tells the
 * seller nothing about what they are choosing between. Radios also mean
 * the browser enforces "exactly one" for free, and that the form still
 * works with no JavaScript at all — the unit beside the input is
 * rendered server-side from the stored value, and public/js/product.js
 * only keeps it in step while the seller is looking at it.
 *
 * Changing the selection does not touch the number. There is no rate in
 * this app, and quietly multiplying somebody's price by 1,300 because
 * they pressed a button is the worst thing this screen could do.
 */
function priceFieldHtml(values) {
  const current = currencyOf(values.currency);
  const shown = values.price != null && values.price !== ''
    ? fmtPrice(Number(String(values.price).replace(/[^\d]/g, '')) || 0)
    : '';

  const option = (c) =>
    `<label class="seg__option">` +
    `<input type="radio" name="currency" value="${esc(c.code)}"` +
    ` data-symbol="${esc(c.symbol)}"${c.code === current ? ' checked' : ''}>` +
    `<span class="seg__face"><span class="seg__label">${esc(c.label)}</span>` +
    `<span class="seg__symbol">${esc(c.symbol)}</span></span></label>`;

  return (
    `<div class="field">` +
    `<label class="field__label" for="f-price">${esc(T.priceLabel)}</label>` +
    `<div class="price-row">` +
    `<input class="field__input" id="f-price" name="price" type="text" required` +
    ` inputmode="numeric" autocomplete="off"` +
    ` value="${esc(shown)}" placeholder="${esc(T.pricePlaceholder)}">` +
    `<span class="price-row__unit" id="price-unit">${esc(symbolOf(current))}</span>` +
    `</div>` +
    `<fieldset class="seg" id="currency-seg">` +
    `<legend class="seg__legend">${esc(CUR.legend)}</legend>` +
    Object.values(PRODUCT_CURRENCIES).map(option).join('') +
    `</fieldset>` +
    `<p class="field__hint">${esc(CUR.hint)}</p>` +
    `</div>`
  );
}

function thumbHtml(img, index) {
  return `<div class="thumb" data-card="${esc(img.card)}" data-full="${esc(img.full ?? '')}">` +
    `<button class="thumb__select" type="button" aria-label="هەڵبژاردنی کاڤەر"><img src="/img/${esc(img.card)}" alt="" decoding="async"></button>` +
    `<span class="thumb__number">${index + 1}</span>` +
    (index === 0 ? `<span class="thumb__badge">کاڤەر</span>` : '') +
    `<button class="thumb__x" type="button" aria-label="${esc(T.removePhoto)}">×</button></div>`;
}

function editThumbHtml(img, index) {
  return `<div class="thumb" data-card="${esc(img.card)}" data-full="${esc(img.full ?? '')}">` +
    `<button class="thumb__select" type="button" aria-label="هەڵبژاردنی کاڤەر"><img src="/img/${esc(img.card)}" alt="" decoding="async"></button>` +
    `<span class="thumb__number">${index + 1}</span>` +
    (index === 0 ? `<span class="thumb__badge">کاڤەر</span>` : '') +
    `</div>`;
}
