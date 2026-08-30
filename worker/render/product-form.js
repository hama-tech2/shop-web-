import { IMAGE_VARIANTS, MAX_IMAGES, PRODUCT as T } from '../config.js';
import { esc, price as fmtPrice } from './html.js';
import { alert, field } from './forms.js';
import { bottomNav } from './appshell.js';

/**
 * One column, no tabs. The gallery, the crop sheet and the price
 * formatting are progressive: with JS off the form still posts, it just
 * cannot add images — which is why the server refuses a product without
 * one rather than silently creating an empty listing.
 */
export function productForm({ mode, draftId, categories, values, error }) {
  const isEdit = mode === 'edit';
  const images = values.images ?? [];

  const thumbs = images
    .map((img, i) => thumbHtml(img, i))
    .join('');

  const chips = [{ slug: '', name_ckb: T.categoryNone }, ...categories]
    .map(
      (c) =>
        `<button class="chip" type="button" data-category="${esc(c.slug)}"` +
        `${(values.category ?? '') === c.slug ? ' aria-current="true"' : ''}>` +
        `${esc(c.name_ckb)}</button>`,
    )
    .join('');

  return (
    `<div class="shell shell--form">` +
    `<div class="shell__head">` +
    `<h1 class="shell__title">${esc(isEdit ? T.editTitle : T.newTitle)}</h1>` +
    `<a class="btn btn--ghost" href="/app/products">${esc(T.listTitle)}</a>` +
    `</div>` +

    alert(error) +

    `<form method="post" id="product-form"` +
    ` action="${esc(isEdit ? `/app/products/${draftId}` : '/app/new')}"` +
    ` data-draft="${esc(draftId)}"` +
    ` data-max="${MAX_IMAGES}"` +
    ` data-card-w="${IMAGE_VARIANTS.card.width}" data-card-h="${IMAGE_VARIANTS.card.height}"` +
    ` data-card-q="${IMAGE_VARIANTS.card.quality}"` +
    ` data-full-w="${IMAGE_VARIANTS.full.width}" data-full-h="${IMAGE_VARIANTS.full.height}"` +
    ` data-full-q="${IMAGE_VARIANTS.full.quality}"` +
    ` data-msg-limit="${esc(T.onlyTen)}" data-msg-type="${esc(T.errType)}"` +
    ` data-msg-upload="${esc(T.errUpload)}">` +

    `<input type="hidden" name="draft_id" value="${esc(draftId)}">` +
    `<input type="hidden" name="images" id="images-field"` +
    ` value="${esc(JSON.stringify(images))}">` +
    `<input type="hidden" name="status" id="status-field" value="${esc(values.status ?? 'active')}">` +
    `<input type="hidden" name="category" id="category-field" value="${esc(values.category ?? '')}">` +

    // ---------- gallery ----------
    `<section class="gallery" aria-label="${esc(T.photos)}">` +
    `<div class="gallery__head">` +
    `<span class="field__label">${esc(T.photos)}</span>` +
    `<span class="gallery__count" id="photo-count">` +
    `${esc(T.counter(images.length, MAX_IMAGES))}</span>` +
    `</div>` +
    `<p class="field__hint">${esc(T.photosHint)}</p>` +
    `<div class="thumbs" id="thumbs">${thumbs}` +
    `<button class="thumb thumb--add" type="button" id="add-photo"` +
    ` aria-label="${esc(T.addPhoto)}">+</button>` +
    `</div>` +
    `<input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" multiple hidden>` +
    `</section>` +

    // ---------- details ----------
    field({
      name: 'title', label: T.titleLabel, value: values.title ?? '',
      placeholder: T.titlePlaceholder,
    }) +

    `<div class="field">` +
    `<label class="field__label" for="f-price">${esc(T.priceLabel)}</label>` +
    `<div class="price-row">` +
    `<input class="field__input" id="f-price" name="price" type="text" required` +
    ` inputmode="numeric" autocomplete="off"` +
    ` value="${esc(values.price ? fmtPrice(Number(String(values.price).replace(/[^\d]/g, '')) || 0) : '')}"` +
    ` placeholder="${esc(T.pricePlaceholder)}">` +
    `<span class="price-row__unit">IQD</span>` +
    `</div></div>` +

    `<div class="field">` +
    `<span class="field__label">${esc(T.categoryLabel)} ` +
    `<span class="field__optional">${esc(T.optional)}</span></span>` +
    `<div class="chips chips--inline" id="category-chips">${chips}</div>` +
    `</div>` +

    `<div class="field">` +
    `<label class="field__label" for="f-description">${esc(T.descriptionLabel)} ` +
    `<span class="field__optional">${esc(T.optional)}</span></label>` +
    `<textarea class="field__input field__input--area" id="f-description" name="description"` +
    ` rows="4" placeholder="${esc(T.descriptionPlaceholder)}">${esc(values.description ?? '')}` +
    `</textarea></div>` +

    `<div class="switch-row">` +
    `<span class="field__label">${esc(T.visibility)}</span>` +
    `<button class="switch" type="button" id="visibility"` +
    ` role="switch" aria-checked="${values.status !== 'hidden'}"` +
    ` data-on="${esc(T.visible)}" data-off="${esc(T.hidden)}">` +
    `<span class="switch__dot"></span>` +
    `<span class="switch__text">${esc(values.status === 'hidden' ? T.hidden : T.visible)}</span>` +
    `</button></div>` +

    `<div class="save-bar">` +
    `<button class="btn btn--primary" type="submit" id="save-btn"` +
    ` data-saving="${esc(T.saving)}">${esc(T.save)}</button>` +
    `</div>` +
    `</form>` +

    (isEdit
      ? `<form method="post" action="/app/products/${esc(draftId)}/delete"` +
        ` onsubmit="return confirm('${esc(T.deleteConfirm)}')">` +
        `<button class="btn btn--ghost btn--danger" type="submit">${esc(T.delete)}</button>` +
        `</form>`
      : '') +

    `</div>` +
    cropSheet() +
    bottomNav('account')
  );
}

function thumbHtml(img, index) {
  return (
    `<div class="thumb" data-card="${esc(img.card)}" data-full="${esc(img.full ?? '')}">` +
    `<img src="/img/${esc(img.card)}" alt="" loading="lazy" decoding="async">` +
    (index === 0 ? `<span class="thumb__badge">${esc(T.cover)}</span>` : '') +
    `<button class="thumb__x" type="button" aria-label="${esc(T.removePhoto)}">✕</button>` +
    `<span class="thumb__bar" hidden><span class="thumb__bar-fill"></span></span>` +
    `</div>`
  );
}

/** The 4:5 crop sheet. Hidden until a file is picked. */
function cropSheet() {
  return (
    `<div class="crop" id="crop" hidden>` +
    `<div class="crop__bar">` +
    `<button class="crop__action" type="button" id="crop-cancel">${esc(T.cropCancel)}</button>` +
    `<span class="crop__title">${esc(T.cropTitle)}</span>` +
    `<button class="crop__action crop__action--go" type="button" id="crop-done">` +
    `${esc(T.cropDone)}</button>` +
    `</div>` +
    `<div class="crop__stage" id="crop-stage">` +
    `<canvas class="crop__canvas" id="crop-canvas"></canvas>` +
    `<div class="crop__frame" aria-hidden="true"></div>` +
    `</div>` +
    `<div class="crop__tools">` +
    `<p class="crop__hint">${esc(T.cropHint)}</p>` +
    `<button class="btn btn--quiet" type="button" id="crop-rotate">${esc(T.rotate)}</button>` +
    `</div>` +
    `</div>`
  );
}
