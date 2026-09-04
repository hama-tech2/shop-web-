import { APP_NAME, CITIES, ONBOARDING as T } from '../config.js';
import { esc } from './html.js';
import { alert, button, field, select } from './forms.js';

const TOTAL = 4;

function frame(step, title, sub, inner) {
  const bars = Array.from({ length: TOTAL }, (_, i) =>
    `<span class="wizard__step" data-done="${i < step}"></span>`).join('');

  return (
    `<div class="wizard">` +
    `<p class="auth__brand">${esc(APP_NAME)}</p>` +
    `<div class="wizard__steps">${bars}</div>` +
    `<p class="wizard__count">${esc(T.stepOf(step, TOTAL))}</p>` +
    `<h1 class="wizard__title">${esc(title)}</h1>` +
    `<p class="wizard__sub">${esc(sub)}</p>` +
    inner +
    `</div>`
  );
}

export const stepName = ({ draft = {}, error }) =>
  frame(1, T.nameTitle, T.nameSub,
    alert(error) +
    `<form method="post" action="/onboarding/name">` +
    field({
      name: 'name', label: T.nameLabel, value: draft.name ?? '',
      placeholder: T.namePlaceholder, autocomplete: 'organization',
    }) +
    `<div class="wizard__actions">${button(T.next)}</div>` +
    `</form>`);

export const stepSlug = ({ draft = {}, error, origin }) =>
  frame(2, T.slugTitle, T.slugSub,
    alert(error) +
    `<form method="post" action="/onboarding/slug" id="slug-form">` +
    `<div class="field">` +
    `<label class="field__label" for="f-slug">${esc(T.slugLabel)}</label>` +
    `<div class="slug-row">` +
    `<span class="slug-row__prefix">${esc(origin.replace(/^https?:\/\//, ''))}/@</span>` +
    `<input class="field__input" id="f-slug" name="slug" type="text" required` +
    ` value="${esc(draft.slug ?? '')}" autocomplete="off" autocapitalize="none"` +
    ` spellcheck="false" inputmode="url" maxlength="40"` +
    ` data-check-url="/api/slug-check" aria-describedby="slug-hint">` +
    `</div>` +
    `<p class="slug-url" id="slug-url" data-origin="${esc(origin)}"></p>` +
    `<p class="field__hint" id="slug-hint"` +
    ` data-msg-checking="${esc(T.slugChecking)}" data-msg-ok="${esc(T.slugOk)}"` +
    ` data-msg-taken="${esc(T.slugTaken)}" data-msg-reserved="${esc(T.slugReserved)}"` +
    ` data-msg-format="${esc(T.slugFormat)}">${esc(T.slugFormat)}</p>` +
    `</div>` +
    `<div class="wizard__actions">` +
    button(T.next, { id: 'slug-next' }) +
    button(T.back, { kind: 'ghost', href: '/onboarding' }) +
    `</div></form>`);

export const stepContact = ({ draft = {}, error }) =>
  frame(3, T.contactTitle, T.contactSub,
    alert(error) +
    `<form method="post" action="/onboarding/contact">` +
    select({ name: 'city', label: T.cityLabel, options: CITIES, value: draft.city ?? 'erbil' }) +
    field({
      name: 'whatsapp', label: T.whatsappLabel, type: 'tel',
      value: draft.whatsapp ?? '', placeholder: T.whatsappPlaceholder,
      autocomplete: 'tel', inputmode: 'tel',
    }) +
    `<div class="wizard__actions">` +
    button(T.next) +
    button(T.back, { kind: 'ghost', href: '/onboarding/slug' }) +
    `</div></form>`);

export const stepLogo = ({ error, shop }) =>
  frame(4, T.logoTitle, T.logoSub,
    alert(error) +
    `<form method="post" action="/onboarding/logo" enctype="multipart/form-data" id="logo-form">` +
    `<label class="logo-pick" for="f-logo">` +
    (shop?.logo_key
      ? `<img class="logo-pick__preview" id="logo-preview" src="/img/${esc(shop.logo_key)}" alt="" width="96" height="96">`
      : `<img class="logo-pick__preview" id="logo-preview" alt="" width="96" height="96" hidden>`) +
    `<span id="logo-label">${esc(T.logoPick)}</span>` +
    `<span class="field__hint">${esc(T.logoHint)}</span>` +
    `<input type="file" id="f-logo" name="logo" accept="image/jpeg,image/png,image/webp" class="visually-hidden">` +
    `</label>` +
    `<div class="wizard__actions">` +
    button(T.finish) +
    button(T.skip, { kind: 'ghost', href: '/app' }) +
    `</div></form>`);
