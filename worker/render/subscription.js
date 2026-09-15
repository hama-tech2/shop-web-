import {
  APP_NAME, FIB_NUMBER, PLANS, SUBSCRIPTION as T, SUPPORT_WHATSAPP,
  FREE_PRODUCT_LIMIT, FREE_IMAGE_LIMIT, UI,
} from '../config.js';
import { esc, price } from './html.js';
import { bottomNav } from './appshell.js';
import { planState } from '../plan-state.js';
import { iconBack, iconCheck, iconCopy, iconLink, iconShield, iconStore } from './icons.js';

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
    case 'free': return 'بەخۆڕایی';
    case 'none': return T.warnNone;
    case 'pending': return T.statePending;
    case 'grace': return T.stateGrace(plan.days);
    case 'expired': return T.stateExpired;
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
const bestBadge = (p) => p.best ? `<span class="billing-best">باشترین هەڵبژاردە</span>` : '';
const billingHeader = (title, back) =>
  `<header class="billing-head"><a class="icon-btn" href="${esc(back)}" aria-label="گەڕانەوە">${iconBack()}</a>` +
  `<h1>${esc(title)}</h1><span></span></header>`;
const trust = () => `<p class="billing-trust">${iconShield(18)}<span>پارەدان بە سەلامەتی لەڕێی <bdi>Wayl</bdi></span></p>` +
  `<p class="billing-safety">${esc(APP_NAME)} هیچ <bdi>PIN</bdi>، <bdi>OTP</bdi> یان ژمارەی کارت وەرناگرێت</p>`;
const availability = 'پارەدانی ئۆنلاین هێشتا چالاک نەکراوە. هیچ پارەیەک لێت وەرناگیرێت.';
const hostedTrust = () => `<p class="billing-trust">${iconShield(18)}<span>پارەدانێکی پارێزراو لەڕێی <bdi>Wayl</bdi></span></p>`;
/**
 * The exact dinar figure, beside the button that leaves for Wayl.
 *
 * The plans are named in dollars and charged in dinars. A seller must
 * not meet the dinar number for the first time on Wayl's screen, so it
 * is said here, on the last screen we own.
 */
const chargeLine = (p) =>
  `<p class="billing-charge" data-charge="${esc(String(p.amount))}">` +
  `<bdi>${esc(T.chargeNotice(price(p.amount)))}</bdi></p>`;
const paidOptions = () => PLANS.slice().sort((a, b) => Number(a.best) - Number(b.best));
const defaultPlan = () => (PLANS.find((p) => p.best) || PLANS[0]).key;
const storefrontHeader = (title, subtitle, back) =>
  `<header class="billing-intro"><div class="billing-brand"><a class="icon-btn" href="${esc(back)}" aria-label="گەڕانەوە">${iconBack()}</a>` +
  `<span>${esc(APP_NAME)}</span><span></span></div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></header>`;

/**
 * `paymentsEnabled` is the server's word, never the browser's. When it
 * is off the form stays exactly where it was — a GET that lands back
 * on this page and says online payment is not switched on. When it is
 * on, the same button posts to the checkout route, and the seller's
 * next screen is Wayl's.
 */
export function subscriptionPage({ state, selected, intent, payments = [], error, paymentsEnabled = false }) {
  const plan = state ? planState(state, Boolean(intent && intent.status === 'pending')) : null;
  if (plan && Number.isInteger(state.days_left) && state.tier === 'paid') plan.days = state.days_left;
  const key = state?.status === 'suspended' ? 'suspended' : state?.tier === 'free' ? 'free' : plan?.key;
  const chosen = PLANS.some((p) => p.key === selected) ? selected : defaultPlan();
  const hasTime = key === 'active' && plan.days > 0;
  const currentName = key === 'free' ? T.freeName
    : PLANS.find((p) => p.key === state?.plan);
  const currentLabel = typeof currentName === 'string' ? currentName : currentName ? planName(currentName) : '';
  return `<main class="shell billing billing--plans">` +
    storefrontHeader('نوێکردنەوەی پلان', 'پلانێک هەڵبژێرە بۆ بەردەوامبوون', '/app#account-settings') +
    `<div class="billing-state"${key ? ` data-plan-state="${esc(key)}"${key === 'free' ? '' : ` data-plan-days="${plan?.days ?? 0}"`}` : ''}>` +
    `<p class="billing-state__label">پلانی ئێستا</p>` +
    (currentLabel ? `<h2>${esc(currentLabel)}</h2>` : '') +
    `<p>${esc(!state ? 'وردەکاری پلان لە ئێستادا بەردەست نییە.' : key === 'suspended' ? 'بەشداریکردنەکەت ناچالاکە'
      : key === 'free' ? 'بەخۆڕایی' : hasTime ? `${plan.days} ڕۆژ ماوە` : statusLine(plan, state))}</p>` +
    (hasTime ? `<p class="billing-renewal-note">ماوەی پلانی نوێ دوای کۆتایی ماوەی ئێستات دەست پێ دەکات.</p>` : '') + `</div>` +
    (error ? `<p class="alert alert--error" role="alert">${esc(error)}</p>` : '') +
    `<form method="${paymentsEnabled ? 'post' : 'get'}" ` +
    `action="${paymentsEnabled ? '/app/subscription/checkout' : '/app/subscription'}" ` +
    `id="plan-form" data-native-plans${paymentsEnabled ? ' data-checkout' : ''}>` +
    (paymentsEnabled ? '' : `<input type="hidden" name="step" value="checkout">`) +
    `<fieldset class="billing-options"><legend class="visually-hidden">پلانێک هەڵبژێرە</legend>` +
    paidOptions().map((p) => planCard(p, chosen)).join('') + `</fieldset>` +
    // The form keeps the radios; its submit button lives in the dock
    // below and reaches back here by id. One form, one action, unchanged.
    `</form>` +
    hostedTrust() + (paymentsEnabled ? '' : `<p class="billing-availability">${availability}</p>`) +
    // Historical records stay available; no SW code or manual-payment entry CTA.
    `<details class="billing-history"><summary>${esc(T.historyTitle)}</summary>${paymentHistory(payments)}</details>` +
    `</main>` +
    // The same dock as the plan gate: the action sits fixed above the
    // bottom navigation instead of at the end of the page, so a seller
    // never has to scroll past their payment history to renew. The
    // button submits #plan-form through the form attribute, so the
    // route, the method and the selected plan are exactly as before.
    `<div class="action-dock plans-dock">` +
    (paymentsEnabled ? PLANS.map((p) =>
      `<p class="billing-charge" id="charge-${esc(p.key)}" data-charge-for="${esc(p.key)}"` +
      `${p.key === chosen ? '' : ' hidden'}><bdi>${esc(T.chargeNotice(price(p.amount)))}</bdi></p>`).join('') : '') +
    `<button class="billing-primary" type="submit" id="pay-btn" form="plan-form">بەردەوامبوون بۆ پارەدان ${iconBack(20)}</button>` +
    `</div>` + bottomNav('account', { accountLabel: 'هەژمار' });
}

function planCard(plan, selected, gate = false) {
  return `<label class="billing-choice billing-plan${gate ? ' gate-plan' : ''}" data-plan="${esc(plan.key)}">` +
    `<input type="radio" name="${gate ? 'gate-plan' : 'plan'}" value="${esc(plan.key)}"${plan.key === selected ? ' checked' : ''} required>` +
    `<span class="billing-choice__surface"><span class="billing-plan__top">` +
    `<span class="billing-plan__name">${planName(plan)}</span>${bestBadge(plan)}</span>` +
    `<span class="billing-plan__bottom"><span>${amount(plan)}<span class="billing-monthly">${monthly(plan)}</span></span>` +
    `<span class="billing-radio" aria-hidden="true"></span></span></span></label>`;
}

/* ============================================================
   the access screen
   ============================================================ */

/**
 * Every Free entry to Add Product. Availability/slots come from the server;
 * choosing Free continues without starting a subscription or writing data.
 * Keep the legacy argument name while the routes share this renderer.
 */
export function accessGatePage({ trialAvailable: freeAvailable = false, slotsLeft = null, error = null, back = '/app' }) {
  const chosen = freeAvailable ? 'free' : defaultPlan();
  const free =
      `<label class="billing-choice billing-plan gate-plan gate-free" data-plan="free">` +
      `<input type="radio" name="gate-plan" value="free"${freeAvailable ? ' checked' : ' disabled'} required>` +
      `<span class="billing-choice__surface"><span class="billing-plan__top">` +
      `<span class="billing-plan__name">${esc(T.freeName)}</span></span>` +
      `<span class="billing-plan__bottom"><span>${amount({ amount: 0 })}<span class="billing-monthly">بێ پارەدان دەست پێ بکە</span></span>` +
      `<span class="billing-radio" aria-hidden="true"></span></span>` +
      `<span class="gate-free__explanation">${esc(T.freeAllowance(FREE_PRODUCT_LIMIT, FREE_IMAGE_LIMIT))}` +
      (freeAvailable && Number.isInteger(slotsLeft) ? ` ${esc(T.freeSlotsLeft(slotsLeft))}` : '') + `</span>` +
      `</span></label>`;
  const features = [['بڵاوکردنەوەی بەرهەم', iconCheck(20)], ['پرۆفایلی گشتی دوکان', iconStore(20)], ['بەستەری دوکان بۆ هاوبەشکردن', iconLink(20)]];
  return `<main class="shell billing billing--gate">` +
    storefrontHeader('بەرهەمەکانت بڵاو بکەرەوە', 'یەکێک لەم هەڵبژاردانە هەڵبژێرە بۆ دەستپێکردن', back) +
    (error ? `<p class="alert alert--error" role="alert">${esc(error)}</p>` : '') +
    `<fieldset class="billing-options" id="gate-options"><legend class="visually-hidden">پلانێک هەڵبژێرە</legend>` +
    free + paidOptions().map((p) => planCard(p, chosen, true)).join('') + `</fieldset>` +
    (!freeAvailable ? `<p class="billing-availability"><a href="/app">بەڕێوەبردن و سڕینەوەی بەرهەمەکان</a></p>` : '') +
    `<section class="billing-features" aria-labelledby="billing-features-title"><h2 id="billing-features-title">لە هەموو پلانەکاندا</h2><ul>` +
    features.map(([label, icon]) => `<li><span class="billing-feature-icon">${icon}</span><span>${label}</span></li>`).join('') + `</ul></section>` +
    // Said once, in the scroll, rather than under every paid button. The
    // dock below holds the action and nothing else.
    hostedTrust() +
    (freeAvailable ? `<p class="billing-availability">دواتر دەتوانیت پلانێکی پارەدراو هەڵبژێریت</p>` : '') +
    `</main>` +
    // The action sits in a dock fixed above the bottom navigation, not
    // at the end of the page. A seller who has just chosen Free should
    // not have to scroll past the benefits to find out they may use it —
    // that made an available plan look unavailable.
    //
    // Still one form per choice, still the existing POST actions, and
    // still native radios deciding which one is shown. Selection writes
    // nothing and no JavaScript is involved in choosing where a tap goes.
    `<div class="action-dock gate-actions" role="group" aria-label="بەردەوامبوون">` +
    (freeAvailable ? `<form method="post" action="/app/subscription/free" data-choice="free">` +
      `<button class="billing-primary" type="submit" id="start-trial">بەردەوامبوون بەخۆڕایی ${iconBack(20)}</button>` +
      `</form>` : '') +
    paidOptions().map((p) => `<form method="post" action="/app/subscription/checkout" data-choice="${esc(p.key)}" data-checkout>` +
      `<input type="hidden" name="plan" value="${esc(p.key)}">` +
      chargeLine(p) +
      `<button class="billing-primary" type="submit" aria-label="بەردەوامبوون بۆ پارەدان — ${planName(p)}">بەردەوامبوون بۆ پارەدان ${iconBack(20)}</button>` +
      `</form>`).join('') + `</div>` +
    bottomNav('account', { accountLabel: 'هەژمار' });
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
