import {
  APP_NAME, FIB_NUMBER, PLANS, SUBSCRIPTION as T, SUPPORT_WHATSAPP,
  TRIAL_PRODUCT_LIMIT, UI,
} from '../config.js';
import { esc, price } from './html.js';
import { bottomNav } from './appshell.js';
import { planState } from '../plan-state.js';
import { iconBack, iconCheck, iconCopy, iconGift, iconLink, iconShield, iconStore, iconWhatsapp } from './icons.js';

/** 2026/09/06 — Latin digits, isolated so the slashes do not flip. */
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

const ltr = (value) => `<span dir="ltr">${esc(value)}</span>`;

/** One line naming where the seller stands. */
function statusLine(plan, state) {
  switch (plan.key) {
    case 'pending': return T.statePending;
    case 'grace': return T.stateGrace(plan.days);
    case 'expired': return T.stateExpired;
    case 'trial': return plan.days <= 1 ? T.stateTrialLast : T.stateTrial(plan.days);
    default: return T.stateActive(formatDate(state?.expires_at));
  }
}

/**
 * A field the seller has to copy into a bank app: the value, large and
 * LTR, with a button beside it. Copying by hand off a phone screen is
 * where a reference code gets mistyped, and a mistyped code is a
 * transfer the owner cannot match to a shop.
 */
function copyRow(label, value, id) {
  return (
    `<div class="pay-row">` +
    `<span class="pay-row__label">${esc(label)}</span>` +
    `<span class="pay-row__value" id="${esc(id)}" dir="ltr">${esc(value)}</span>` +
    `<button class="btn btn--quiet pay-row__copy" type="button"` +
    ` data-copy="${esc(value)}" data-copied="${esc(T.payCopied)}"` +
    ` aria-label="${esc(`${T.payCopy} ${label}`)}">${iconCopy(16)}` +
    `<span>${esc(T.payCopy)}</span></button>` +
    `</div>`
  );
}

/* ============================================================
   the plan screen
   ============================================================ */

// Pricing remains in PLANS. These names are display-only Latin-digit labels.
const planName = (p) => p.key === 'year_1' ? '1 ساڵ' : '6 مانگ';
const monthly = (p) => `<bdi>${esc(price(p.monthly))} د.ع</bdi> مانگانە`;
const amount = (p) => `<span class="billing-amount"><bdi>${esc(price(p.amount))}</bdi> <span>د.ع</span></span>`;
const bestBadge = (p) => p.best ? `<span class="billing-best">${esc(T.best)}</span>` : '';
const billingHeader = (title, back) =>
  `<header class="billing-head"><a class="icon-btn" href="${esc(back)}" aria-label="گەڕانەوە">${iconBack()}</a>` +
  `<h1>${esc(title)}</h1><span></span></header>`;
const trust = () => `<p class="billing-trust">${iconShield(18)}<span>پارەدان بە سەلامەتی لەڕێی <bdi>Wayl</bdi></span></p>` +
  `<p class="billing-safety">${esc(APP_NAME)} هیچ <bdi>PIN</bdi>، <bdi>OTP</bdi> یان ژمارەی کارت وەرناگرێت</p>`;
const availability = 'پارەدانی ئۆنلاین هێشتا چالاک نەکراوە. هیچ پارەیەک لێت وەرناگیرێت.';

/**
 * `paymentsEnabled` is the server's word, never the browser's. When it
 * is off the form stays exactly where it was — a GET that lands back
 * on this page and says online payment is not switched on. When it is
 * on, the same button posts to the checkout route, and the seller's
 * next screen is Wayl's.
 */
export function subscriptionPage({ state, selected, intent, payments = [], error, paymentsEnabled = false }) {
  const plan = state ? planState(state, Boolean(intent && intent.status === 'pending')) : null;
  const key = state?.status === 'suspended' ? 'suspended' : plan?.key;
  const ordered = PLANS.slice().sort((a, b) => Number(b.best) - Number(a.best));
  const chosen = PLANS.some((p) => p.key === selected) ? selected : ordered[0].key;
  const features = [
    ['تا 1000 بەرهەم', iconCheck()], // products_limit_1000, unchanged.
    ['پرۆفایلی گشتی دوکان', iconStore(20)],
    ['لینکی دوکان بۆ بیۆی تۆڕە کۆمەڵایەتییەکان', iconLink(20)],
    ...(SUPPORT_WHATSAPP ? [['پشتیوانی', iconWhatsapp(20)]] : []),
  ];
  return `<main class="shell billing billing--plans">` +
    billingHeader(T.title, '/app#account-settings') +
    `<div class="billing-state"${key ? ` data-plan-state="${esc(key)}" data-plan-days="${plan?.days ?? 0}"` : ''}>` +
    `<span class="billing-state__icon">${iconGift(24)}</span><div>` +
    `<p>${esc(!state ? 'وردەکاری پلان لە ئێستادا بەردەست نییە.' : key === 'suspended' ? 'بەشداریکردنەکەت ناچالاکە' : statusLine(plan, state))}</p>` +
    (state?.plan === 'trial' ? `<small>تا ${TRIAL_PRODUCT_LIMIT} بەرهەم لە مانگی بەخۆڕاییدا</small>` : '') + `</div></div>` +
    (error ? `<p class="alert alert--error" role="alert">${esc(error)}</p>` : '') +
    `<form method="${paymentsEnabled ? 'post' : 'get'}" ` +
    `action="${paymentsEnabled ? '/app/subscription/checkout' : '/app/subscription'}" ` +
    `id="plan-form" data-native-plans>` +
    (paymentsEnabled ? '' : `<input type="hidden" name="step" value="checkout">`) +
    `<fieldset class="billing-options"><legend class="visually-hidden">پلانێک هەڵبژێرە</legend>` +
    ordered.map((p) => planCard(p, chosen)).join('') + `</fieldset>` +
    `<section class="billing-features" aria-labelledby="billing-features-title"><h2 id="billing-features-title">چی لە پلانەکە دەستدەکەوێت؟</h2><ul>` +
    features.map(([text, icon]) => `<li><span class="billing-feature-icon">${icon}</span><span>${text}</span></li>`).join('') +
    `</ul></section><button class="billing-primary" type="submit" id="pay-btn">بەردەوام بە پارەدان</button>` +
    trust() + (paymentsEnabled ? '' : `<p class="billing-availability">${availability}</p>`) + `</form>` +
    // Historical records stay available; no SW code or manual-payment entry CTA.
    `<details class="billing-history"><summary>${esc(T.historyTitle)}</summary>${paymentHistory(payments)}</details>` +
    `</main>` + bottomNav('account', { accountLabel: 'هەژمار' });
}

function planCard(plan, selected) {
  return `<label class="billing-choice billing-plan" data-plan="${esc(plan.key)}">` +
    `<input type="radio" name="plan" value="${esc(plan.key)}"${plan.key === selected ? ' checked' : ''} required>` +
    `<span class="billing-choice__surface"><span class="billing-plan__top">` +
    `<span class="billing-plan__name">${planName(plan)}</span>${bestBadge(plan)}</span>` +
    `<span class="billing-plan__bottom"><span>${amount(plan)}<span class="billing-monthly">${monthly(plan)}</span></span>` +
    `<span class="billing-radio" aria-hidden="true"></span></span></span></label>`;
}

/** A read-only method chooser. No provider session, reference or payment is made. */
export function paymentMethodPage({ plan, method = 'fib', unavailable = false }) {
  const methods = [
    { key: 'fib', name: 'FIB', mark: 'FIB', helper: 'پارەدان لەڕێی ئەپی FIB' },
    { key: 'superqi', name: 'SuperQi', mark: 'Qi', helper: 'پارەدان لەڕێی ئەپی SuperQi' },
  ];
  const selected = methods.find((m) => m.key === method) || methods[0];
  return `<main class="shell billing billing--method">` +
    billingHeader('پارەدان', '/app/subscription?plan=' + plan.key) +
    `<section class="billing-summary" aria-label="پلانی هەڵبژێردراو"><div><p>پلانی هەڵبژێردراو</p>` +
    `<h2>${planName(plan)}</h2></div>${bestBadge(plan)}<div>${amount(plan)}` +
    `<p class="billing-monthly">${monthly(plan)}</p></div></section>` +
    `<form method="get" action="/app/subscription" id="payment-method-form">` +
    `<input type="hidden" name="step" value="method"><input type="hidden" name="plan" value="${esc(plan.key)}">` +
    `<fieldset class="billing-options billing-methods"><legend>ڕێگای پارەدان هەڵبژێرە</legend>` +
    methods.map((m) => `<label class="billing-choice billing-method"><input type="radio" name="method" value="${m.key}"${selected.key === m.key ? ' checked' : ''} required>` +
      `<span class="billing-choice__surface"><span class="billing-method__brand billing-method__brand--${m.key}" aria-hidden="true">${m.mark}</span>` +
      `<span class="billing-method__body"><strong dir="ltr">${m.name}</strong><span>${m.helper}</span></span>` +
      `<span class="billing-radio" aria-hidden="true"></span></span></label>`).join('') + `</fieldset>` +
    `<p class="billing-availability">${availability}</p>` +
    `<div class="billing-result" id="payment-unavailable" role="status" tabindex="-1"${unavailable ? '' : ' hidden'}>` +
    `پارەدان لە ئێستادا بەردەست نییە. تکایە دواتر هەوڵ بدەوە. هیچ پارەدانێک ئەنجام نەدرا.</div>` +
    `<button class="billing-primary" type="submit" name="continue" value="1" id="method-continue">بەردەوام بە <bdi>${selected.name}</bdi></button>` +
    trust() + `</form></main>` + bottomNav('account', { accountLabel: 'هەژمار' });
}

/* ============================================================
   what the seller has paid
   ============================================================ */

function paymentHistory(payments) {
  const rows = payments.map((p) => {
    const done = p.status === 'confirmed';
    return (
      `<li class="pay-history__row">` +
      `<span class="pay-history__date">${ltr(formatDate(p.paid_at ?? p.created_at))}</span>` +
      `<span class="pay-history__amount">${ltr(price(Number(p.amount) || 0))} ${esc(UI.currency)}</span>` +
      `<span class="pay-history__status${done ? ' is-done' : ''}">` +
      `${esc(done ? T.historyConfirmed : T.historyPending)}</span>` +
      `</li>`
    );
  }).join('');

  return (
    `<section class="pay-history" aria-labelledby="pay-history-title">` +
    `<h2 class="sub-heading" id="pay-history-title">${esc(T.historyTitle)}</h2>` +
    (rows
      ? `<ul class="pay-history__list">${rows}</ul>`
      : `<p class="field__hint">${esc(T.historyEmpty)}</p>`) +
    `</section>`
  );
}

/* ============================================================
   the instructions
   ============================================================ */

/**
 * What to transfer, where, and with which code.
 *
 * There is deliberately no success state here. Until the owner has seen
 * the money, the strongest thing this screen says is "waiting to be
 * confirmed" — a green tick before that is a lie the seller would act
 * on. It also never asks for a PIN, a password or a card number, and
 * says so on the page, because that is the shape every transfer scam in
 * Iraq takes.
 */
export function payPage({ plan, intent, shopName, error }) {
  const waiting = intent.status === 'pending';

  const text =
    `سڵاو 👋\nپلانی ${plan.name} بۆ دوکانی «${shopName}»` +
    `\n${T.payReference}: ${intent.reference ?? ''}`;
  const href = `https://wa.me/${SUPPORT_WHATSAPP.replace(/[^0-9]/g, '')}` +
    `?text=${encodeURIComponent(text)}`;

  return (
    `<div class="shell shell--pay">` +
    `<div class="edit-head">` +
    `<a class="icon-btn" href="/app/subscription" aria-label="${esc(T.payBack)}">${iconBack()}</a>` +
    `<h1 class="edit-head__title">${esc(waiting ? T.payWaitingTitle : T.payTitle)}</h1>` +
    `<span class="edit-head__count"></span>` +
    `</div>` +

    (error ? `<p class="alert alert--error">${esc(error)}</p>` : '') +

    (waiting
      ? `<p class="alert alert--wait" role="status">${esc(T.payWaitingBody)}</p>`
      : '') +

    `<div class="pay-card">` +
    `<div class="pay-row">` +
    `<span class="pay-row__label">${esc(T.payPlan)}</span>` +
    `<span class="pay-row__value">${esc(plan.name)}</span></div>` +
    `<div class="pay-row">` +
    `<span class="pay-row__label">${esc(T.payAmount)}</span>` +
    `<span class="pay-row__value" dir="ltr">${esc(price(Number(intent.amount) || 0))} ` +
    `${esc(UI.currency)}</span></div>` +
    copyRow(T.payReference, intent.reference ?? '', 'pay-reference') +
    copyRow(T.payFib, FIB_NUMBER, 'pay-fib') +
    `</div>` +

    `<p class="pay-instruction">${esc(T.payNote)}</p>` +

    (waiting
      ? ''
      : `<form method="post" action="/app/subscription/sent" class="pay-sent">` +
        `<input type="hidden" name="intent" value="${esc(intent.id)}">` +
        `<button class="btn btn--dark" type="submit" id="sent-btn">${esc(T.paySent)}</button>` +
        `</form>`) +

    `<p class="pay-safety">${esc(T.paySafety)}</p>` +

    `<a class="btn btn--whatsapp" href="${esc(href)}" target="_blank" rel="noopener">` +
    `${esc(T.payWhatsapp)}</a>` +
    `<a class="btn btn--ghost" href="/app/subscription">${esc(T.payBack)}</a>` +
    `</div>` +
    bottomNav('account')
  );
}
