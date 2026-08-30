/** Tiny HTML helpers. No template engine, no framework. */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape anything that lands in markup. Everything user-supplied goes through this. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Latin digits with thousands separators — 35,000 — as in the mockups. */
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export function price(value) {
  return nf.format(value);
}

export function attr(name, value) {
  return value === null || value === undefined || value === false
    ? ''
    : ` ${name}="${esc(value)}"`;
}

export function html(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (values[i] ?? ''), '');
}
