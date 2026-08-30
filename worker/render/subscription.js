import { PLANS, SUBSCRIPTION as T, SUPPORT_WHATSAPP, UI } from '../config.js';
import { esc, price } from './html.js';
import { bottomNav } from './appshell.js';
import { iconBack, iconCheck, iconGift } from './icons.js';

/**
 * The plan screen.
 *
 * The pay button does not take money — FIB is not integrated. It files a
 * payment_intent and sends the seller to a page telling them we will get
 * in touch, which is honest about where the product actually is.
 */
export function subscriptionPage({ state, selected, error }) {
  const days = state?.days_left ?? 0;
  const total = state?.total_days ?? 30;
  const onTrial = state?.plan === 'trial';

  // Bar fills as the trial is used up.
  const used = Math.max(0, Math.min(1, 1 - days / Math.max(total, 1)));

  let statusLine;
  if (state?.in_grace) statusLine = T.inGrace(days);
  else if (!state?.publicly_visible) statusLine = T.expired;
  else if (onTrial) statusLine = days === 1 ? T.daysLeftOne : T.daysLeft(days);
  else statusLine = T.activeUntil(formatDate(state?.expires_at));

  const cards = PLANS.map((plan) => planCard(plan, selected)).join('');

  const benefits = T.benefits
    .map(
      (b) =>
        `<li class="benefit"><span class="benefit__tick">${iconCheck()}</span>` +
        `<span>${esc(b)}</span></li>`,
    )
    .join('');

  return (
    `<div class="shell shell--sub">` +

    `<div class="edit-head">` +
    `<a class="icon-btn" href="/app" aria-label="${esc(T.title)}">${iconBack()}</a>` +
    `<h1 class="edit-head__title">${esc(T.title)}</h1>` +
    `<span class="edit-head__count"></span>` +
    `</div>` +

    `<div class="trial">` +
    `<div class="trial__track"><span class="trial__fill" style="width:${(used * 100).toFixed(0)}%"></span></div>` +
    `<p class="trial__line">${esc(statusLine)}</p>` +
    `</div>` +

    (error ? `<p class="alert alert--error">${esc(error)}</p>` : '') +

    `<form method="post" action="/app/subscription" id="plan-form">` +
    `<input type="hidden" name="plan" id="plan-field" value="${esc(selected)}">` +
    `<div class="plans">${cards}</div>` +

    `<h2 class="sub-heading">${esc(T.whatYouGet)}</h2>` +
    `<ul class="benefits">${benefits}</ul>` +

    (onTrial
      ? `<div class="offer"><span class="offer__icon">${iconGift()}</span>` +
        `<span>${esc(T.offer)}</span></div>`
      : '') +

    `<div class="save-bar save-bar--dark">` +
    `<button class="btn btn--dark" type="submit" id="pay-btn">${esc(T.pay)}</button>` +
    `<p class="pay-note">${esc(T.payVia)}</p>` +
    `<a class="pay-link" href="/app/products">${esc(T.startFree)}</a>` +
    `</div>` +
    `</form>` +

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

/** The screen after the pay button — honest about there being no processor. */
export function intentPage({ plan, origin, shopName }) {
  const text =
    `سڵاو 👋\nدەمەوێت پلانی ${plan.name} بۆ دوکانی «${shopName}» چالاک بکەم.` +
    `\n${price(plan.amount)} ${UI.currency}`;
  const href = `https://wa.me/${SUPPORT_WHATSAPP.replace(/[^0-9]/g, '')}` +
    `?text=${encodeURIComponent(text)}`;

  return (
    `<div class="shell">` +
    `<div class="edit-head">` +
    `<a class="icon-btn" href="/app/subscription" aria-label="${esc(T.backToPlans)}">${iconBack()}</a>` +
    `<h1 class="edit-head__title">${esc(T.requestedTitle)}</h1>` +
    `<span class="edit-head__count"></span>` +
    `</div>` +

    `<div class="notice">` +
    `<p class="notice__title">${esc(T.requestedPlan)}: ${esc(plan.name)} — ` +
    `${esc(price(plan.amount))} ${esc(UI.currency)}</p>` +
    `<p>${esc(T.requestedBody)}</p>` +
    `</div>` +

    `<a class="btn btn--whatsapp" href="${esc(href)}" target="_blank" rel="noopener">` +
    `${esc(T.contactUs)}</a>` +
    `<a class="btn btn--ghost" href="/app/subscription">${esc(T.backToPlans)}</a>` +
    `</div>` +
    bottomNav('account')
  );
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
