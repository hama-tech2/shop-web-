import { PRODUCT_CURRENCIES, SITE_ORIGIN } from '../config.js';
import { moneyText } from './money.js';

/** Only the joined seller's public contact number; never customer information. */
function contactUrl(raw, message) {
  let number = String(raw || '').replace(/[٠-٩۰-۹]/g, (digit) =>
    String('٠١٢٣٤٥٦٧٨٩'.includes(digit) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[\s()+.-]/g, '');
  if (number.startsWith('00')) number = number.slice(2);
  else if (number.startsWith('0')) number = '964' + number.slice(1);
  return /^[1-9][0-9]{6,14}$/.test(number) && message
    ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}

const component = (value) => typeof value === 'string' && value.trim()
  ? encodeURIComponent(value.trim()) : null;

/** Both detail objects and shared card objects carry their own joined shop. */
export function productWhatsappUrl(product) {
  if (!product) return null;
  const slug = component(product.shop ? product.shop.slug : product.shopSlug);
  const id = component(product.id);
  const title = typeof product.title === 'string' ? product.title.trim() : '';
  if (!slug || !id || !title) return null;
  const phone = product.shop ? product.shop.whatsapp || product.shop.phone : product.shopWhatsapp;
  const url = `${SITE_ORIGIN}/@${slug}/p/${id}`;
  // Null/invalid prices must never become an invented zero. Missing currency
  // on legacy rows follows the existing display's IQD fallback.
  const hasPrice = (typeof product.price === 'number' ||
    (typeof product.price === 'string' && product.price.trim() !== '')) &&
    Number.isFinite(Number(product.price)) && Number(product.price) >= 0 &&
    (product.currency == null || Object.hasOwn(PRODUCT_CURRENCIES, product.currency));
  const message = `سڵاو، دەمەوێت دەربارەی ئەم بەرهەمە بپرسم:\nبەرهەم: ${title}\n` +
    (hasPrice ? `نرخ: \u2066${moneyText(product.price, product.currency)}\u2069\n` : '') + url;
  // This only opens an editable composer. Nothing sends a message or attaches a file.
  return contactUrl(phone, message);
}

export function shopWhatsappUrl(shop) {
  const slug = component(shop?.slug);
  if (!slug) return null;
  return contactUrl(shop.whatsapp || shop.phone,
    `سڵاو، دەمەوێت دەربارەی دوکانەکەتان بپرسم.\n${SITE_ORIGIN}/@${slug}`);
}
