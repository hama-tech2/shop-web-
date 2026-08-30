import { esc } from './html.js';

/** Form primitives shared by the auth pages and the wizard. */

export function field({ name, label, type = 'text', value = '', placeholder = '',
                        hint = '', autocomplete, required = true, invalid = false,
                        inputmode, id, extra = '' }) {
  const fieldId = id || `f-${name}`;
  return (
    `<div class="field">` +
    `<label class="field__label" for="${esc(fieldId)}">${esc(label)}</label>` +
    `<input class="field__input" id="${esc(fieldId)}" name="${esc(name)}" type="${esc(type)}"` +
    ` value="${esc(value)}" placeholder="${esc(placeholder)}"` +
    (autocomplete ? ` autocomplete="${esc(autocomplete)}"` : '') +
    (inputmode ? ` inputmode="${esc(inputmode)}"` : '') +
    (required ? ' required' : '') +
    (invalid ? ' aria-invalid="true"' : '') +
    (hint ? ` aria-describedby="${esc(fieldId)}-hint"` : '') +
    extra +
    `>` +
    (hint ? `<p class="field__hint" id="${esc(fieldId)}-hint">${esc(hint)}</p>` : '') +
    `</div>`
  );
}

export function select({ name, label, options, value, id }) {
  const fieldId = id || `f-${name}`;
  const opts = options
    .map(
      (o) =>
        `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>` +
        `${esc(o.label)}</option>`,
    )
    .join('');
  return (
    `<div class="field">` +
    `<label class="field__label" for="${esc(fieldId)}">${esc(label)}</label>` +
    `<select class="field__input" id="${esc(fieldId)}" name="${esc(name)}">${opts}</select>` +
    `</div>`
  );
}

export const button = (label, { kind = 'primary', type = 'submit', href, id, attrs = '' } = {}) =>
  href
    ? `<a class="btn btn--${esc(kind)}"${id ? ` id="${esc(id)}"` : ''} href="${esc(href)}"${attrs}>${esc(label)}</a>`
    : `<button class="btn btn--${esc(kind)}" type="${esc(type)}"${id ? ` id="${esc(id)}"` : ''}${attrs}>${esc(label)}</button>`;

export const alert = (message, kind = 'error') =>
  message ? `<p class="alert alert--${esc(kind)}">${esc(message)}</p>` : '';

export const divider = (label) => `<div class="divider">${esc(label)}</div>`;

/** Google's mark, inline so the button paints with the page. */
export const googleMark = () =>
  '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' +
  '<path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6Z"/>' +
  '<path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z"/>' +
  '<path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z"/>' +
  '<path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.3A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z"/>' +
  '</svg>';
