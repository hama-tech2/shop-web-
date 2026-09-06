import {
  FIB_NUMBER, PLANS, SUBSCRIPTION as T, SUPPORT_WHATSAPP, UI,
} from '../config.js';
import { esc, price } from './html.js';
import { bottomNav } from './appshell.js';
import { planState } from '../plan-state.js';
import { iconBack, iconCheck, iconCopy } from './icons.js';

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

export function subscriptionPage({ state, selected, intent, payments = [], error }) {
  const plan = planState(state, Boolean(intent && intent.status === 'pending'));
  const total = state?.total_days ?? 30;
  const used = Math.max(0, Math.min(1, 1 - plan.days / Math.max(total, 1)));

  const cards = PLANS.map((p) => planCard(p, selected)).join('');
  const benefits = T.benefits
    .map((b) => `<li class="benefit"><span class="benefit__tick">${iconCheck()}</span>` +
                `<span>${esc(b)}</span></li>`)
    .join('');

  return (
    `<div class="shell shell--sub">` +

    `<div class="edit-head">` +
    `<a class="icon-btn" href="/app" aria-label="${esc(T.title)}">${iconBack()}</a>` +
    `<h1 class="edit-head__title">${esc(T.title)}</h1>` +
    `<span class="edit-head__count"></span>` +
    `</div>` +

    // The settings panel reads these two rather than re-deriving the
    // state: one place decides which of the five a seller is in.
    `<div class="trial" data-plan-state="${esc(plan.key)}"` +
    ` data-plan-days="${esc(String(plan.days))}">` +
    `<div class="trial__track"><span class="trial__fill" style="width:${(used * 100).toFixed(0)}%"></span></div>` +
    `<p class="trial__line">${esc(statusLine(plan, state))}</p>` +
    `</div>` +

    (error ? `<p class="alert alert--error">${esc(error)}</p>` : '') +

    // A transfer already waiting: the way back to its instructions has
    // to be the first thing on the screen, not a second payment.
    (intent
      ? `<a class="notice notice--link" href="/app/subscription/pay">` +
        `<span class="notice__title">${esc(intent.status === 'pending'
          ? T.payWaitingTitle : T.payTitle)}</span>` +
        `<span>${esc(T.payReference)}: ${esc(intent.reference ?? '')}</span></a>`
      : '') +

    `<form method="post" action="/app/subscription" id="plan-form">` +
    `<input type="hidden" name="plan" id="plan-field" value="${esc(selected)}">` +
    `<div class="plans">${cards}</div>` +

    `<h2 class="sub-heading">${esc(T.whatYouGet)}</h2>` +
    `<ul class="benefits">${benefits}</ul>` +

    `<div class="save-bar save-bar--dark">` +
    `<button class="btn btn--dark" type="submit" id="pay-btn">${esc(T.pay)}</button>` +
    `<p class="pay-note">${esc(T.payVia)}</p>` +
    `</div>` +
    `</form>` +

    paymentHistory(payments) +

    `</div>` +
    bottomNav('account')
  );
}

function planCard(plan, selected) {
  const active = plan.key === selected;
  return (
    `<button class="plan${plan.best ? ' plan--best' : ''}" type="button"` +
    ` data-plan="${esc(plan.key)}" aria-pressed="${active}">` +
    (plan.best ? `<span class="plan__badge">${esc(T.best)}</span>` : '') +
    `<span class="plan__name">${esc(plan.name)}</span>` +
    `<span class="plan__price">` +
    `<span class="plan__amount">${esc(price(plan.amount))}</span>` +
    `<span class="plan__currency">${esc(UI.currency)}</span></span>` +
    `<span class="plan__monthly">${esc(T.perMonth(price(plan.monthly)))}</span>` +
    (plan.best ? `<span class="plan__savings">${esc(T.savings)}</span>` : '') +
    `</button>`
  );
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
