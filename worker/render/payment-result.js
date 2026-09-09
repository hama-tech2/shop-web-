import { APP_NAME, PLANS, SUBSCRIPTION as T } from '../config.js';
import { esc, price } from './html.js';
import { iconBack, iconCheck } from './icons.js';
import { layout } from './layout.js';

const copy = {
  checking: ['پارەدانەکەت دەپشکنرێت', 'تەنها چەند چرکەیەک چاوەڕێ بکە'],
  success: ['پارەدان سەرکەوتوو بوو', 'پلانت چالاک کرا'],
  failed: ['پارەدان سەرکەوتوو نەبوو', 'تکایە دووبارە هەوڵ بدەوە'],
  cancelled: ['پارەدان هەڵوەشێنرایەوە', 'دەتوانیت دووبارە هەوڵ بدەیتەوە'],
};
const row = (label, value) => `<div class="payment-result__row"><dt>${label}</dt><dd>${value}</dd></div>`;

/** Presentation only. Every input is an authenticated, ownership-checked
 * server payment record — never a URL parameter, storage, or a status the
 * client supplied. worker/routes/payment.js is the only production caller,
 * and it renders `success` only after Wayl has confirmed the payment to the
 * server AND the subscription has actually been extended.
 *
 * `reference` is the opaque Wayl reference the page polls with. It is passed
 * only while a payment is unfinished, and it is not a claim about anything:
 * the answer still comes from the server asking Wayl.
 */
export function paymentResult({ state, plan, amount, expiresAt, method, shopSlug, reference } = {}) {
  if (!Object.hasOwn(copy, state) || !PLANS.some((p) => p.key === plan) ||
      !Number.isSafeInteger(amount) || amount < 0) {
    throw new TypeError('Payment Result requires a valid server payment record');
  }
  const date = expiresAt ? new Date(expiresAt) : null;
  if (state === 'success' && (!date || Number.isNaN(date.getTime()) ||
      typeof shopSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(shopSlug))) {
    throw new TypeError('Success requires the activated expiry and owned shop slug');
  }
  const [title, subtitle] = copy[state];
  const checking = state === 'checking', success = state === 'success';
  const plansURL = '/app/subscription?plan=' + plan;
  const symbol = checking ? '<span class="payment-result__spinner"></span>' :
    success ? iconCheck(38) : '<span class="payment-result__stop">' + (state === 'failed' ? '×' : '−') + '</span>';
  const dateLabel = success ? `${date.getUTCFullYear()}/${String(date.getUTCMonth()+1).padStart(2,'0')}/${String(date.getUTCDate()).padStart(2,'0')}` : '';
  // Only an unfinished payment carries one, and only in a shape the
  // status endpoint would accept back.
  const watch = checking && typeof reference === 'string' && /^[A-Za-z0-9-]{6,64}$/.test(reference)
    ? ` data-result-ref="${esc(reference)}"` : '';
  return `<main class="payment-result" data-result-state="${state}"${watch} aria-labelledby="payment-result-heading">` +
    `<header class="payment-result__header"><a href="${esc(plansURL)}" aria-label="گەڕانەوە بۆ پلانەکان">${iconBack()}</a><h1>پارەدان</h1><span></span></header>` +
    `<section class="payment-result__content" aria-labelledby="payment-result-heading">` +
    `<div class="payment-result__symbol" aria-hidden="true">${symbol}</div>` +
    `<div role="status" aria-live="polite" aria-atomic="true"><h2 id="payment-result-heading">${title}</h2><p class="payment-result__subtitle">${subtitle}</p></div>` +
    (checking ? `<p class="payment-result__helper">کاتێک پشتڕاست بکرێتەوە، پلانت خۆکار چالاک دەبێت</p>` +
      // Shown by the poller after about 30 seconds. Taking a while is
      // not failing, and this page never turns one into the other.
      `<p class="payment-result__slow" id="payment-result-slow" role="status" hidden>${esc(T.resultSlow)}</p>` : '') +
    `<dl class="payment-result__details">` +
    row('پلان', plan === 'year_1' ? '1 ساڵ' : '6 مانگ') +
    row('بڕی پارە', `<span class="payment-result__amount"><bdi>${esc(price(amount))}</bdi> <span>د.ع</span></span>`) +
    (success ? row('دۆخ', '<span class="payment-result__active">' + iconCheck(16) + 'چالاک</span>') +
      row('چالاک تا', `<bdi>${dateLabel}</bdi>`) +
      (typeof method === 'string' && method.trim() ? row('شێوازی پارەدان', `<bdi>${esc(method)}</bdi>`) : '') : '') + `</dl>` +
    (checking ? '' : `<div class="payment-result__actions">` +
      `<a class="payment-result__primary" href="${success ? '/app#account-settings' : esc(plansURL + '&step=checkout')}">${success ? 'گەڕانەوە بۆ هەژمار' : state === 'failed' ? 'دووبارە هەوڵ بدەوە' : 'هەوڵێکی تر بدەوە'}</a>` +
      `<a class="payment-result__secondary" href="${success ? '/@' + esc(shopSlug) : esc(plansURL)}">${success ? 'بینینی دوکانەکەم' : 'گەڕانەوە بۆ پلانەکان'}</a></div>`) +
    `</section></main>`;
}

/** The four states share a single document/fragment architecture; no app nav.
 * `scripts` is empty unless the caller is watching an unfinished payment. */
export function paymentResultPage(record, { scripts = [] } = {}) {
  return layout({ title: 'پارەدان — ' + APP_NAME, description: APP_NAME, body: paymentResult(record), scripts });
}
