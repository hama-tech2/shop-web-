import { CATEGORIES_UI as C, IMAGE_VARIANTS, MAX_IMAGES, PRODUCT as T } from '../config.js';
import { esc, price as fmtPrice } from './html.js';
import { alert, field } from './forms.js';
import { iconBack, iconPlus } from './icons.js';
import { productCover } from './product-cover.js';

export function productForm({ mode, draftId, categories, shopCategories = [], values, error }) {
  const isEdit = mode === 'edit';
  const images = values.images ?? [];
  return (
    `<div class="shell publish-page">` +
    `<header class="publish-head"><a class="icon-btn" href="/app" aria-label="گەڕانەوە">${iconBack()}</a>` +
    `<h1>${esc(isEdit ? T.editTitle : T.newTitle)}</h1>` +
    `<details class="publish-help"><summary>ڕێنمایی ⓘ</summary>` +
    `<p>تا ${MAX_IMAGES} وێنە زیاد بکە. وێنەیەک هەڵبژێرە بۆ کاڤەر؛ بە دوگمەکانی ڕیزکردن شوێنی وێنەکان بگۆڕە.</p></details></header>` +
    `<p class="publish-sub">زانیارییەکانی بەرهەمەکەت زیاد بکە و بڵاوی بکەرەوە.</p>` +
    alert(error) +
    `<form method="post" id="product-form" action="${esc(isEdit ? `/app/products/${draftId}` : '/app/new')}"` +
    ` data-mode="${esc(mode)}" data-restore-category="${!isEdit && !error && !values.category && !images.length}"` +
    ` data-draft="${esc(draftId)}" data-max="${MAX_IMAGES}"` +
    ` data-card-w="${IMAGE_VARIANTS.card.width}" data-card-h="${IMAGE_VARIANTS.card.height}" data-card-q="${IMAGE_VARIANTS.card.quality}"` +
    ` data-full-w="${IMAGE_VARIANTS.full.width}" data-full-h="${IMAGE_VARIANTS.full.height}" data-full-q="${IMAGE_VARIANTS.full.quality}"` +
    ` data-msg-limit="${esc(T.onlyMax)}" data-msg-type="${esc(T.errType)}" data-msg-upload="${esc(T.errUpload)}"` +
    ` data-msg-cat-name="${esc(C.errName)}" data-msg-cat-create="${esc(C.errCreate)}">` +
    `<input type="hidden" name="draft_id" value="${esc(draftId)}">` +
    `<input type="hidden" name="images" id="images-field" value="${esc(JSON.stringify(images))}">` +
    `<input type="hidden" name="status" id="status-field" value="${esc(values.status ?? 'active')}">` +
    `<section class="gallery" aria-label="${esc(T.photos)}">` +
    `<div class="gallery__head"><span class="field__label">وێنەکان <small>(تا ${MAX_IMAGES} وێنە)</small></span>` +
    `<span class="gallery__count" id="photo-count" aria-live="polite">${esc(T.counter(images.length, MAX_IMAGES))}</span></div>` +
    `<div class="thumbs" id="thumbs">${images.map((img, i) => thumbHtml(img, i)).join('')}` +
    `<button class="thumb thumb--add" type="button" id="add-photo" aria-label="${esc(T.addPhoto)}">${iconPlus()}<span>زیادکردن</span></button></div>` +
    `<input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" multiple hidden>` +
    `<p class="gallery-hint">وێنەیەک هەڵبژێرە بۆ ڕێکخستنی کاڤەر · ⇄ بۆ ڕیزکردن</p></section>` +
    `<p id="product-message" class="publish-message" role="status" aria-live="polite" hidden></p>` +
    field({ name: 'title', label: T.titleLabel, value: values.title ?? '', placeholder: T.titlePlaceholder, extra: ' minlength="2" maxlength="200"' }) +
    `<div class="field"><label class="field__label" for="f-price">${esc(T.priceLabel)} (د.ع)</label>` +
    `<div class="price-row"><input class="field__input" id="f-price" name="price" type="text" required inputmode="numeric" autocomplete="off"` +
    ` value="${esc(values.price != null && values.price !== '' ? fmtPrice(Number(String(values.price).replace(/[^\d]/g, '')) || 0) : '')}" placeholder="${esc(T.pricePlaceholder)}">` +
    `<span class="price-row__unit">د.ع</span></div></div>` +
    `<div class="field"><label class="field__label" for="category-field">پۆلی بازاڕ</label>` +
    `<select class="field__input" name="category" id="category-field">` +
    [{ slug: '', name_ckb: T.categoryNone }, ...categories].map(c => `<option value="${esc(c.slug)}"${(values.category ?? '') === c.slug ? ' selected' : ''}>${esc(c.name_ckb)}</option>`).join('') +
    `</select><p class="field__hint">هەڵبژاردنەکەت بۆ بەرهەمی داهاتوو لەم وێبگەڕەدا دەمێنێتەوە.</p></div>` +
    `<div class="field"><label class="field__label" for="f-own-category">پۆلی دوکان</label>` +
    `<select class="field__input" id="f-own-category" name="own_category"><option value="">${esc(C.none)}</option>` +
    shopCategories.map(c => `<option value="${esc(c.id)}"${values.ownCategory === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('') +
    `</select>` +
    // A new category is made here, in this form. The old link opened the
    // profile in another tab, and coming back to a reloaded form meant
    // the title, the price and every prepared image were gone.
    `<div class="category-inline">` +
    `<button class="category-inline__open" type="button" id="category-add-open">` +
    `${iconPlus(16)}<span>${esc(C.addInline)}</span></button>` +
    `<div class="category-inline__form" id="category-add-form" hidden>` +
    `<input class="field__input" id="category-add-name" type="text" maxlength="60"` +
    ` autocomplete="off" placeholder="${esc(C.addPlaceholder)}">` +
    `<button class="btn btn--quiet" type="button" id="category-add-save">${esc(C.create)}</button>` +
    `<button class="btn btn--ghost" type="button" id="category-add-cancel">${esc(C.cancel)}</button>` +
    `</div>` +
    `<p class="category-inline__error" id="category-add-error" role="status" hidden></p>` +
    `</div></div>` +
    `<div class="field"><label class="field__label" for="f-description">پێناسە <span class="field__optional">${esc(T.optional)}</span></label>` +
    `<textarea class="field__input field__input--area" id="f-description" name="description" rows="3" placeholder="${esc(T.descriptionPlaceholder)}">${esc(values.description ?? '')}</textarea>` +
    `<span class="description-count" id="description-count"></span></div>` +
    `<div class="publish-save"><button class="btn btn--primary" type="submit" id="save-btn" data-saving="${esc(T.saving)}">${esc(isEdit ? T.save : 'بڵاو بکەرەوە')}</button>` +
    `<p>پێش پاشەکەوتکردن، وێنەکان و زانیارییەکان بپشکنە.</p></div></form>` +
    (isEdit ? `<form method="post" action="/app/products/${esc(draftId)}/delete" onsubmit="return confirm('${esc(T.deleteConfirm)}')"><button class="btn btn--ghost btn--danger" type="submit">${esc(T.delete)}</button></form>` : '') +
    `</div>` + productCover() + `<script src="/js/product-cover.js" defer></script>`
  );
}

function thumbHtml(img, index) {
  return `<div class="thumb" data-card="${esc(img.card)}" data-full="${esc(img.full ?? '')}">` +
    `<button class="thumb__select" type="button" aria-label="هەڵبژاردنی کاڤەر"><img src="/img/${esc(img.card)}" alt="" decoding="async"></button>` +
    `<span class="thumb__number">${index + 1}</span>` +
    (index === 0 ? `<span class="thumb__badge">کاڤەر</span>` : '') +
    `<button class="thumb__x" type="button" aria-label="${esc(T.removePhoto)}">×</button></div>`;
}
