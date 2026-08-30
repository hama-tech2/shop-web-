import { BIO_MAX, CITIES, PROFILE as T, PROFILE_VARIANTS as V } from '../config.js';
import { esc } from './html.js';
import { alert, button, field, select } from './forms.js';
import { bottomNav } from './appshell.js';
import { cropSheet } from './crop-sheet.js';
import { iconBack, iconCamera, iconFacebook, iconInstagram, iconTiktok } from './icons.js';

const imgUrl = (key) => `/img/${key.split('/').map(encodeURIComponent).join('/')}`;

/** Instagram / TikTok / Facebook: handle only, with a muted @ prefix. */
function socialRow(platform, label, icon, value) {
  return (
    `<div class="social-row">` +
    `<span class="social-row__icon social-row__icon--${esc(platform)}">${icon}</span>` +
    `<span class="social-row__label">${esc(label)}</span>` +
    `<span class="social-row__field">` +
    `<span class="social-row__at">@</span>` +
    `<input class="field__input" type="text" name="${esc(platform)}"` +
    ` value="${esc(value ?? '')}" autocomplete="off" autocapitalize="none"` +
    ` spellcheck="false" maxlength="40" placeholder="username">` +
    `</span></div>`
  );
}

export function profilePage({ shop, values, origin, error, saved }) {
  const v = values;
  const url = `${origin}/@${shop.slug}`;

  const banner = v.cover_key
    ? `<img class="edit-banner__img" id="banner-preview" src="${esc(imgUrl(v.cover_key))}"` +
      ` alt="" width="1200" height="450" decoding="async">`
    : `<span class="edit-banner__img edit-banner__img--empty" id="banner-preview"></span>`;

  const logo = v.logo_key
    ? `<img class="edit-logo__img" id="logo-preview" src="${esc(imgUrl(v.logo_key))}"` +
      ` alt="" width="120" height="120" decoding="async">`
    : `<span class="edit-logo__img edit-logo__img--empty" id="logo-preview">` +
      `${esc([...String(v.name || shop.name).trim()][0] ?? '؟')}</span>`;

  return (
    `<div class="shell shell--form">` +

    `<div class="edit-head">` +
    `<a class="icon-btn" href="/app" aria-label="${esc(T.title)}">${iconBack()}</a>` +
    `<h1 class="edit-head__title">${esc(T.title)}</h1>` +
    `<button class="edit-head__save" type="submit" form="profile-form"` +
    ` data-saving="${esc(T.saving)}">${esc(T.save)}</button>` +
    `</div>` +

    alert(error) +
    (saved ? alert(T.saved, 'ok') : '') +

    `<form method="post" action="/app/profile" id="profile-form"` +
    ` data-banner-w="${V.banner.width}" data-banner-q="${V.banner.quality}"` +
    ` data-banner-ratio="${V.banner.ratio}"` +
    ` data-logo-w="${V.logo.width}" data-logo-q="${V.logo.quality}"` +
    ` data-logo-ratio="${V.logo.ratio}"` +
    ` data-msg-image="${esc(T.errImage)}" data-msg-type="${esc(T.errType)}">` +

    `<input type="hidden" name="cover_key" id="cover-key" value="${esc(v.cover_key ?? '')}">` +
    `<input type="hidden" name="logo_key"  id="logo-key"  value="${esc(v.logo_key ?? '')}">` +

    // ---------- banner + logo ----------
    `<div class="edit-banner">` +
    banner +
    `<button class="camera-btn camera-btn--banner" type="button" id="banner-btn"` +
    ` aria-label="${esc(T.changeBanner)}">${iconCamera()}</button>` +
    `<div class="edit-logo">` +
    logo +
    `<button class="camera-btn camera-btn--logo" type="button" id="logo-btn"` +
    ` aria-label="${esc(T.changeLogo)}">${iconCamera(16)}</button>` +
    `</div>` +
    `</div>` +
    `<input type="file" id="banner-input" accept="image/jpeg,image/png,image/webp" hidden>` +
    `<input type="file" id="logo-input" accept="image/jpeg,image/png,image/webp" hidden>` +

    // ---------- the link ----------
    `<div class="link-card">` +
    `<div class="link-card__body">` +
    `<p class="link-card__label">${esc(T.linkLabel)}</p>` +
    `<p class="link-card__url" id="shop-url">${esc(url)}</p>` +
    `<a class="link-card__view" href="${esc(`/@${shop.slug}`)}">${esc(T.viewShop)} ‹</a>` +
    `</div>` +
    `<button class="btn btn--primary link-card__copy" type="button" id="copy-link"` +
    ` data-copied="${esc(T.copied)}">${esc(T.copy)}</button>` +
    `</div>` +

    // ---------- fields ----------
    field({ name: 'name', label: T.nameLabel, value: v.name ?? '' }) +

    `<div class="field">` +
    `<label class="field__label" for="f-bio">${esc(T.bioLabel)}</label>` +
    `<div class="counted">` +
    `<textarea class="field__input field__input--area" id="f-bio" name="bio" rows="3"` +
    ` maxlength="${BIO_MAX}" placeholder="${esc(T.bioPlaceholder)}"` +
    ` data-max="${BIO_MAX}">${esc(v.bio ?? '')}</textarea>` +
    `<span class="counted__count" id="bio-count">` +
    `${esc(String((v.bio ?? '').length))}/${BIO_MAX}</span>` +
    `</div></div>` +

    select({ name: 'city', label: T.cityLabel, options: CITIES, value: v.city ?? 'erbil' }) +

    `<div class="field">` +
    `<label class="field__label" for="f-whatsapp">${esc(T.whatsappLabel)}</label>` +
    `<div class="icon-field icon-field--whatsapp">` +
    `<input class="field__input" id="f-whatsapp" name="whatsapp" type="tel" required` +
    ` inputmode="tel" dir="ltr" value="${esc(v.whatsapp ?? '')}" placeholder="0750 123 4567">` +
    `</div></div>` +

    `<div class="field">` +
    `<label class="field__label" for="f-phone">${esc(T.phoneLabel)}</label>` +
    `<div class="icon-field icon-field--phone">` +
    `<input class="field__input" id="f-phone" name="phone" type="tel"` +
    ` inputmode="tel" dir="ltr" value="${esc(v.phone ?? '')}" placeholder="0770 765 4321">` +
    `</div></div>` +

    `<div class="field">` +
    `<span class="field__label">${esc(T.socialLabel)}</span>` +
    socialRow('instagram', 'Instagram', iconInstagram(20), v.instagram) +
    socialRow('tiktok', 'TikTok', iconTiktok(20), v.tiktok) +
    socialRow('facebook', 'Facebook', iconFacebook(20), v.facebook) +
    `</div>` +

    `<div class="save-bar">` +
    button(T.save, { id: 'save-btn', attrs: ` data-saving="${esc(T.saving)}"` }) +
    `</div>` +
    `</form>` +
    `</div>` +
    cropSheet() +
    bottomNav('account')
  );
}
