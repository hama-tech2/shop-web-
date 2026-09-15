/**
 * Shop Web — rendering one product's price in its own currency.
 *
 * Every price a customer sees goes through here, so that the symbol,
 * the side it sits on and the spacing are decided once instead of in
 * each of the four views that show a price.
 *
 * The two currencies disagree about where the symbol goes, which is the
 * only thing that makes this more than a lookup:
 *
 *     IQD   25,000 د.ع     number first, space, symbol
 *     USD   $25            symbol first, no space
 *
 * Both price rows are laid out `direction: ltr` (see .card__price,
 * .pdp-price, .row__price), so the order the parts are emitted in IS
 * the order they are read in, and USD only needs the gap closed.
 *
 * Nothing here converts anything. There is one amount and one currency,
 * and no rate exists anywhere in this app to turn one into the other.
 */

import { DEFAULT_CURRENCY, PRODUCT_CURRENCIES } from '../config.js';
import { attr, esc, price as digits } from './html.js';

/**
 * The currency to DISPLAY a row in.
 *
 * Anything unrecognised reads as IQD: a product written before the
 * column existed, or a row from a future the database check does not
 * allow yet. A price must render as something, and the currency every
 * existing product has is the honest fallback.
 *
 * This is deliberately forgiving because it is the read path. The write
 * path is not — see parseCurrency in worker/routes/products.js, which
 * refuses anything that is not exactly IQD or USD.
 */
export function currencyOf(value) {
  return Object.hasOwn(PRODUCT_CURRENCIES, value) ? value : DEFAULT_CURRENCY;
}

/** The symbol alone: `د.ع` or `$`. Used by the form's price field. */
export const symbolOf = (value) => PRODUCT_CURRENCIES[currencyOf(value)].symbol;

/**
 * The price as plain text — `25,000 د.ع`, `$25`.
 *
 * For the places markup cannot go: the OG description WhatsApp shows in
 * a link preview, and the data-money attribute the search suggestions
 * read rather than re-assembling the parts with a space of their own.
 */
export function moneyText(amount, currency) {
  const c = PRODUCT_CURRENCIES[currencyOf(currency)];
  const n = digits(Number(amount) || 0);
  return c.lead ? `${c.symbol}${n}` : `${n} ${c.symbol}`;
}

/**
 * The price as markup, as one element with its parts inside.
 *
 * The element carries `data-currency` (which CSS closes the gap on for
 * USD) and `data-money` (the same string moneyText gives, so anything
 * copying this price out of the DOM does not have to guess the spacing
 * back). Class names are passed in, because the four views style their
 * price differently and this is not the place to unify that.
 */
export function moneyHtml(amount, currency, {
  tag = 'span', cls = '', amountClass = '', currencyClass = '', extra = '',
} = {}) {
  const code = currencyOf(currency);
  const c = PRODUCT_CURRENCIES[code];
  const n = esc(digits(Number(amount) || 0));

  const value = `<span class="${esc(amountClass)}">${n}</span>`;
  const symbol = `<span class="${esc(currencyClass)}">${esc(c.symbol)}</span>`;

  return (
    `<${tag}${cls ? ` class="${esc(cls)}"` : ''}` +
    attr('data-currency', code) +
    attr('data-money', moneyText(amount, code)) +
    extra + `>` +
    (c.lead ? symbol + value : value + symbol) +
    `</${tag}>`
  );
}
