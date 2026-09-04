import { BIO_MAX, CITIES, PROFILE as T, PROFILE_VARIANTS as V } from '../config.js';
import { esc } from './html.js';
import { alert, button, field, select } from './forms.js';
import { bottomNav } from './appshell.js';
import { cropSheet } from './crop-sheet.js';
import { iconBack, iconCamera, iconFacebook, iconInstagram, iconPhone, iconTiktok, iconWhatsapp } from './icons.js';

const imgUrl = (key) => `/img/${key.split('/').map(encodeURIComponent).join('/')}`;

/** Instagram / TikTok / Facebook: handle only, with a muted @ prefix. */
function socialRow(platform, label, icon, value) {
  return (
    `<div class="social-row">` +
    `<span class="social-row__icon social-row__icon--${esc(platform)}">${icon}</span>` +
    `<label class="social-row__label" for="f-${esc(platform)}">${esc(label)}</label>` +
    `<span class="social-row__field">` +
    `<span class="social-row__at">@</span>` +
    `<input class="field__input" id="f-${esc(platform)}" type="text" name="${esc(platform)}"` +
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
    `<div class="shell shell--form profile-final">` +

    `<div class="edit-head">` +
    `<a class="icon-btn" href="/app" aria-label="${esc(T.title)}">${iconBack()}</a>` +
    `<h1 class="edit-head__title">${esc(T.title)}</h1>` +
    `<span class="edit-head__spacer" aria-hidden="true"></span>` +
    `</div>` +
    `<p class="profile-intro">ناسنامە و زانیارییەکانی دوکانەکەت نوێ بکەرەوە.</p>` +

    alert(error) +
    (saved ? `<p class="alert alert--ok" role="status">${esc(T.saved)}</p>` : '') +

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
    ` aria-label="${esc(T.changeBanner)}">${iconCamera(18)}<span>${esc(T.changeBanner)}</span></button>` +
    `<div class="edit-logo">` +
    logo +
    `<button class="camera-btn camera-btn--logo" type="button" id="logo-btn"` +
    ` aria-label="${esc(T.changeLogo)}">${iconCamera(16)}</button>` +
    `</div>` +
    `</div>` +
    `<input type="file" id="banner-input" accept="image/jpeg,image/png,image/webp" hidden>` +
    `<input type="file" id="logo-input" accept="image/jpeg,image/png,image/webp" hidden>` +
    `<p class="field__hint profile-image-status" id="profile-image-status" role="status"></p>` +

    `<div class="profile-name">` +
    field({ name: 'name', label: T.nameLabel, value: v.name ?? '', extra: ' minlength="2" maxlength="80"' }) +
    `</div>` +
    field({ name: 'slug', label: 'ناونیشانی دوکان', value: shop.slug,
      hint: 'ئەم ناونیشانە جێگیرە و لێرە ناگۆڕدرێت.', required: false,
      extra: ' readonly dir="ltr"' }) +

    // ---------- the link ----------
    `<div class="link-card">` +
    `<div class="link-card__body">` +
    `<p class="link-card__label">${esc(T.linkLabel)}</p>` +
    `<p class="link-card__url" id="shop-url">${esc(url)}</p>` +
    `<a class="link-card__view" href="${esc(`/@${shop.slug}`)}">${esc(T.viewShop)} ‹</a>` +
    `</div>` +
    `<button class="btn btn--quiet link-card__copy" type="button" id="copy-link"` +
    ` data-copied="${esc(T.copied)}">${esc(T.copy)}</button>` +
    `</div>` +

    // ---------- fields ----------
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
    iconWhatsapp(22) +
    `<input class="field__input" id="f-whatsapp" name="whatsapp" type="tel" required` +
    ` inputmode="tel" dir="ltr" value="${esc(v.whatsapp ?? '')}" placeholder="0750 123 4567">` +
    `</div></div>` +

    `<div class="field">` +
    `<label class="field__label" for="f-phone">${esc(T.phoneLabel)}</label>` +
    `<div class="icon-field icon-field--phone">` +
    iconPhone(22) +
    `<input class="field__input" id="f-phone" name="phone" type="tel"` +
    ` inputmode="tel" dir="ltr" value="${esc(v.phone ?? '')}" placeholder="0770 765 4321">` +
    `</div></div>` +

    `<div class="field">` +
    `<span class="field__label">${esc(T.socialLabel)}</span>` +
    socialRow('instagram', 'Instagram', iconInstagram(20), v.instagram) +
    socialRow('tiktok', 'TikTok', iconTiktok(20), v.tiktok) +
    socialRow('facebook', 'Facebook', iconFacebook(20), v.facebook) +
    `<div class="profile-unavailable">` +
    `<label class="field__label" for="f-snapchat">Snapchat <small>— لە ئێستادا بەردەست نییە</small></label>` +
    `<input class="field__input" id="f-snapchat" placeholder="@username" dir="ltr" disabled>` +
    `</div>` +
    `</div>` +
    `<details class="profile-optional"><summary>لینکی تر (هەڵبژاردەیی)</summary>` +
    `<p class="field__hint">زیادکردنی ئەم لینکانە لە ئێستادا بەردەست نییە.</p>` +
    field({ name: 'website', label: 'وێبسایت', type: 'url', required: false, extra: ' disabled dir="ltr"', placeholder: 'https://example.com' }) +
    field({ name: 'maps', label: 'شوێنی دوکان — Google Maps', type: 'url', required: false, extra: ' disabled dir="ltr"', placeholder: 'https://maps.app.goo.gl/…' }) +
    `</details>` +
    `</form>` +
    `<section class="profile-categories" id="shop-categories" aria-labelledby="profile-categories-title">` +
    `<h2 id="profile-categories-title">بەشەکانی دوکان</h2>` +
    `<p class="field__hint">بۆ دەستکاری بەشێک لێی بدە. گۆڕانکارییەکانی بەشەکان یەکسەر پاشەکەوت دەکرێن.</p>` +
    `<p id="category-status" role="status" aria-live="polite"></p>` +
    `<div id="profile-category-content"><a href="/app/categories">بەشەکان بکەرەوە ‹</a></div>` +
    `</section>` +
    `<div class="profile-save">` +
    button(T.save, { id: 'save-btn', attrs: ` form="profile-form" data-saving="${esc(T.saving)}"` }) +
    `</div>` +
    `</div>` +
    cropSheet() +
    `<script src="/js/profile-categories.js" defer></script>` +
    bottomNav('account')
  );
}
