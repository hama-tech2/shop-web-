/**
 * The admin screen.
 *
 * Server-rendered like everything else, and deliberately plain: it is a
 * work surface for one person, not a page anybody shares. Nothing here
 * is linked from the app — the route itself 404s for a non-admin.
 */

import {
  ADMIN as A, CITY_LABEL, PLAN_LABEL, REPORT_REASONS, UI,
} from '../config.js';
import { esc, price } from './html.js';

/** Latin dates and numbers flip inside an RTL page without this. */
const ltr = (value) => `<span dir="ltr" class="ltr">${esc(value)}</span>`;

const day = (iso) => (iso ? String(iso).slice(0, 10) : '—');

const TABS = [
  { href: '/admin', key: 'home', label: A.overview },
  { href: '/admin/shops', key: 'shops', label: A.shops },
  { href: '/admin/intents', key: 'intents', label: A.intents },
  { href: '/admin/reports', key: 'reports', label: A.reports },
];

function shell(active, body, { title = A.title, badge = null } = {}) {
  const tabs = TABS.map(
    (t) =>
      `<a class="adm-tab${t.key === active ? ' is-on' : ''}" href="${esc(t.href)}">` +
      `${esc(t.label)}` +
      (badge && badge[t.key] ? `<span class="adm-tab__n">${ltr(badge[t.key])}</span>` : '') +
      `</a>`,
  ).join('');

  return (
    `<div class="adm">` +
    `<header class="adm__head"><h1 class="adm__title">${esc(title)}</h1></header>` +
    `<nav class="adm-tabs">${tabs}</nav>` +
    body +
    `</div>`
  );
}

const statusLabel = (row) => {
  if (row.status === 'banned') return A.statusBanned;
  if (row.status !== 'active') return A.statusSuspended;
  if (!row.visible) return A.statusExpired;
  if (row.plan === 'trial') return A.statusTrial;
  return A.statusActive;
};

const statusKind = (row) => {
  if (row.status !== 'active') return 'off';
  if (!row.visible) return 'bad';
  if (row.plan === 'trial') return 'warn';
  return 'ok';
};

const pill = (row) =>
  `<span class="adm-pill adm-pill--${statusKind(row)}">${esc(statusLabel(row))}</span>`;

const days = (n) => {
  if (n === null || n === undefined) return '—';
  const late = n < 0;
  return (
    `<span${late ? ' class="adm-late"' : ''}>${ltr(late ? -n : n)} ` +
    `${esc(late ? A.dayUnitOver : A.dayUnit)}</span>`
  );
};

/* ============================================================
   overview
   ============================================================ */

export function adminHome({ stats, intents }) {
  const s = stats ?? {};

  const cell = (label, value) =>
    `<div class="adm-stat"><p class="adm-stat__n">${ltr(value ?? 0)}</p>` +
    `<p class="adm-stat__l">${esc(label)}</p></div>`;

  const body =
    `<a class="btn btn--quiet" href="/admin/shops">بەخشینی پلان بە دوکانێک</a>` +
    `<section class="adm-stats">` +
    cell(A.statShops, s.shops_total) +
    cell(A.statActive, s.shops_active) +
    cell(A.statTrial, s.shops_trial) +
    cell(A.statExpired, s.shops_expired) +
    cell(A.statSuspended, s.shops_suspended) +
    cell(A.statProducts, s.products_total) +
    `</section>` +
    `<h2 class="adm-h2">${esc(A.intentsTitle)}</h2>` +
    intentList(intents, 4) +
    (intents.length > 4
      ? `<a class="adm-more" href="/admin/intents">${esc(A.intents)}</a>`
      : '');

  return shell('home', body, {
    badge: { intents: s.intents_open || 0, reports: s.reports_open || 0 },
  });
}

/* ============================================================
   merchants
   ============================================================ */

const FILTERS = [
  { key: 'all', label: A.all },
  { key: 'active', label: A.statusActive },
  { key: 'trial', label: A.statusTrial },
  { key: 'expired', label: A.statusExpired },
  { key: 'suspended', label: A.statusSuspended },
];

export function adminShops({ rows, q, status }) {
  const chips = FILTERS.map(
    (f) =>
      `<a class="chip"${f.key === status ? ' aria-current="true"' : ''}` +
      ` href="/admin/shops?status=${esc(f.key)}${q ? `&q=${encodeURIComponent(q)}` : ''}">` +
      `${esc(f.label)}</a>`,
  ).join('');

  const search =
    `<form class="adm-search" method="get" action="/admin/shops">` +
    `<input type="hidden" name="status" value="${esc(status)}">` +
    `<input class="field__input" type="search" name="q" value="${esc(q || '')}"` +
    ` placeholder="${esc(A.searchPlaceholder)}" aria-label="${esc(A.searchLabel)}">` +
    `<button class="btn btn--primary" type="submit">${esc(A.search)}</button>` +
    `</form>`;

  const list = rows.length
    ? rows.map(shopRow).join('')
    : `<p class="adm-empty">${esc(A.shopsEmpty)}</p>`;

  return shell('shops', search + `<div class="adm-chips">${chips}</div>` + list);
}

function shopRow(row) {
  const meta = [
    CITY_LABEL[row.city] || row.city,
    PLAN_LABEL[row.plan] || row.plan,
  ].filter(Boolean);

  return (
    `<a class="adm-row" href="/admin/shops/${esc(row.id)}">` +
    `<div class="adm-row__main">` +
    `<p class="adm-row__name">${esc(row.name)}</p>` +
    `<p class="adm-row__slug ltr" dir="ltr">/@${esc(row.slug)}</p>` +
    `<p class="adm-row__meta">${esc(meta.join(' · '))}</p>` +
    `</div>` +
    `<div class="adm-row__side">` +
    pill(row) +
    `<p class="adm-row__days">${days(row.days_left)}</p>` +
    `<p class="adm-row__meta">${esc(A.colProducts)} ${ltr(row.product_count)}` +
    ` · ${ltr(day(row.created_at))}</p>` +
    `</div></a>`
  );
}

/* ============================================================
   one shop
   ============================================================ */

export function adminShop({ shop, sub, products, note, grants = [], origin, saved, error }) {
  const row = { ...shop, plan: sub?.plan, visible: sub?.visible };

  const line = (label, value) =>
    `<div class="adm-line"><span class="adm-line__l">${esc(label)}</span>` +
    `<span class="adm-line__v">${value}</span></div>`;

  const suspended = shop.status !== 'active';

  const body =
    `<a class="adm-back" href="/admin/shops">${esc(A.back)}</a>` +
    (saved ? `<p class="alert alert--ok">${esc(A.saved)}</p>` : '') +
    (error ? `<p class="alert alert--error">${esc(error)}</p>` : '') +

    `<h2 class="adm-h1">${esc(shop.name)}</h2>` +
    `<p class="adm-row__slug ltr" dir="ltr">${esc(origin)}/@${esc(shop.slug)}</p>` +

    `<div class="adm-card">` +
    line(A.colStatus, pill(row)) +
    line(A.owner, ltr(shop.owner_email || '—')) +
    line(A.colCity, esc(CITY_LABEL[shop.city] || shop.city)) +
    line(A.colPlan, esc(PLAN_LABEL[sub?.plan] || sub?.plan || '—')) +
    line(A.expiryTitle, ltr(day(sub?.expires_at))) +
    line(A.colDays, days(sub?.days_left)) +
    line(A.signedUp, ltr(day(shop.created_at))) +
    line(A.colProducts, ltr(products.length)) +
    `</div>` +

    `<div class="adm-actions">` +
    `<a class="btn btn--primary" href="/admin/shops/${esc(shop.id)}/grant">بەخشینی پلان</a>` +
    `<a class="btn btn--quiet" href="${esc(origin)}/@${esc(shop.slug)}">${esc(A.viewShop)}</a>` +
    `<form method="post" action="/admin/shops/${esc(shop.id)}/status">` +
    `<input type="hidden" name="to" value="${suspended ? 'active' : 'suspended'}">` +
    `<button class="btn ${suspended ? 'btn--primary' : 'btn--danger'}" type="submit"` +
    (suspended ? '' : ` data-confirm="${esc(A.suspendConfirm)}"`) +
    `>${esc(suspended ? A.unsuspend : A.suspend)}</button>` +
    `</form></div>` +

    `<form class="adm-card" method="post" action="/admin/shops/${esc(shop.id)}/expiry">` +
    `<label class="field__label" for="f-expiry">${esc(A.expiryLabel)}</label>` +
    `<input class="field__input ltr" dir="ltr" id="f-expiry" type="date" name="expires_at"` +
    ` value="${esc(day(sub?.expires_at))}" required>` +
    `<p class="field__hint">${esc(A.expiryHint)}</p>` +
    `<button class="btn btn--primary" type="submit">${esc(A.expirySave)}</button>` +
    `</form>` +

    `<form class="adm-card" method="post" action="/admin/shops/${esc(shop.id)}/note">` +
    `<label class="field__label" for="f-note">${esc(A.notesTitle)}</label>` +
    `<textarea class="field__input field__input--area" id="f-note" name="note"` +
    ` maxlength="4000" placeholder="${esc(A.notesPlaceholder)}">${esc(note || '')}</textarea>` +
    `<button class="btn btn--primary" type="submit">${esc(A.notesSave)}</button>` +
    `</form>` +

    (grants.length ? `<h2 class="adm-h2">مێژووی بەخشینی پلان — بەخۆڕایی</h2>` +
      grants.map((g) => `<article class="adm-card adm-grant-history">` +
        `<strong>${esc(PLAN_LABEL[g.plan] || g.plan)}</strong> · ${ltr(day(g.paid_at))}` +
        `<p class="adm-report__details">${esc(g.note)}</p>` +
        `<p class="field__hint">ناسنامەی ئەدمین: ${ltr(g.recorded_by || '—')}</p>` +
        `</article>`).join('') : '') +
    `<h2 class="adm-h2">${esc(A.productsTitle)}</h2>` +
    (products.length
      ? products.map((p) => productRow(p, shop)).join('')
      : `<p class="adm-empty">${esc(A.productsEmpty)}</p>`);

  return shell('shops', body, { title: A.detailTitle });
}

export function adminGrant({ shop, sub, plan = '', reason = '', review, proof, error }) {
  const action = `/admin/shops/${esc(shop.id)}/grant`;
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const identity = `<h2 class="adm-h1">${esc(shop.name)}</h2>` +
    `<p class="adm-row__slug" dir="ltr">/@${esc(shop.slug)}</p>` +
    `<p class="field__hint">کۆتایی پلانی ئێستا: ${ltr(day(sub?.expires_at))}</p>`;
  const fields = review
    ? `<div class="adm-card adm-grant-review">` +
      `<h2 class="adm-h2">پشتڕاستکردنەوەی بەخشین</h2>` + identity +
      `<p><strong>${esc(PLAN_LABEL[plan])}</strong> — بەخۆڕایی، هیچ پارەیەک وەرنەگیراوە.</p>` +
      `<p class="adm-report__details">هۆکار: ${esc(reason)}</p>` +
      `<p class="field__hint">ماوەکە لە کۆتایی پلانی ئێستا یان ئەمڕۆوە زیاد دەکرێت، هەر کامیان دواتر بێت.</p>` +
      `<p class="field__hint">ئەم بەخشینە بە ناسنامەی ئەکاونتەکەت تۆمار دەکرێت.</p>` +
      hidden('plan', plan) + hidden('reason', reason) + hidden('request', review.request) +
      hidden('until', review.until) + hidden('proof', proof) +
      `<div class="adm-actions"><button class="btn btn--primary" name="step" value="confirm" type="submit">پشتڕاستە، پلانەکە ببەخشە</button>` +
      `<button class="btn btn--quiet" name="step" value="edit" type="submit">گەڕانەوە بۆ دەستکاری</button></div></div>`
    : `<div class="adm-card">${identity}` +
      `<label class="field__label" for="grant-plan">پلان</label>` +
      `<select class="field__input" id="grant-plan" name="plan" required>` +
      `<option value="">پلانێک هەڵبژێرە</option>` +
      ['months_6', 'year_1'].map((p) => `<option value="${p}"${p === plan ? ' selected' : ''}>${esc(PLAN_LABEL[p])}</option>`).join('') +
      `</select><label class="field__label" for="grant-reason">هۆکاری بەخشین (پێویستە)</label>` +
      `<textarea class="field__input field__input--area" id="grant-reason" name="reason" maxlength="500" required>${esc(reason)}</textarea>` +
      `<p class="field__hint">بەخشینی بەخۆڕاییە؛ وەک پارەدان تۆمار ناکرێت.</p>` +
      `<button class="btn btn--primary" name="step" value="review" type="submit"${!sub ? ' disabled' : ''}>پێداچوونەوە</button></div>`;
  return shell('shops', `<a class="adm-back" href="/admin/shops/${esc(shop.id)}">${esc(A.back)}</a>` +
    (error ? `<p class="alert alert--error" role="alert">${esc(error)}</p>` : '') +
    `<form class="adm-grant" method="post" action="${action}">${fields}</form>`, { title: 'بەخشینی پلان' });
}

function productRow(p, shop) {
  return (
    `<a class="adm-row" href="/@${esc(shop.slug)}/p/${esc(p.id)}">` +
    `<div class="adm-row__main">` +
    `<p class="adm-row__name">${esc(p.title)}</p>` +
    `<p class="adm-row__meta">${ltr(day(p.created_at))}</p>` +
    `</div>` +
    `<div class="adm-row__side">` +
    (p.status === 'active'
      ? ''
      : `<span class="adm-pill adm-pill--off">${esc(A.statusHidden)}</span>`) +
    `<p class="adm-row__days ltr" dir="ltr">${esc(price(p.price))} ${esc(UI.currency)}</p>` +
    `</div></a>`
  );
}

/* ============================================================
   payment intents
   ============================================================ */

export function adminIntents({ intents, expiring = [] }) {
  return shell(
    'intents',
    `<h2 class="adm-h1">${esc(A.intentsTitle)}</h2>` +
    intentList(intents) +
    expiringList(expiring),
  );
}

/**
 * The payments waiting on the owner.
 *
 * Two buttons, and neither of them is a rejection. Activate applies the
 * date rule and, because visibility is derived from the expiry date,
 * unhides the shop in the same statement. Not-found puts the intent
 * back where it was so the owner can chase the seller on WhatsApp —
 * nothing is destroyed and no money is implied to have moved.
 */
function intentList(intents, limit) {
  const rows = limit ? intents.slice(0, limit) : intents;
  if (!rows.length) return `<p class="adm-empty">${esc(A.intentsEmpty)}</p>`;

  return rows
    .map((i) => {
      const wa = String(i.whatsapp || i.shops?.whatsapp || '').replace(/[^0-9]/g, '');
      const name = i.name || i.shops?.name || '—';
      const slug = i.slug || i.shops?.slug || '';
      const pending = i.status === 'pending';
      return (
        `<div class="adm-card adm-intent${pending ? ' adm-intent--pending' : ''}">` +
        `<a class="adm-intent__shop" href="/admin/shops/${esc(i.shop_id)}">${esc(name)}</a>` +
        `<span class="adm-intent__badge">` +
        `${esc(pending ? A.intentPendingBadge : A.intentOpenBadge)}</span>` +
        `<p class="adm-row__slug ltr" dir="ltr">/@${esc(slug)}</p>` +
        `<p class="adm-intent__line">` +
        `${esc(A.intentPlan)}: ${esc(PLAN_LABEL[i.plan] || i.plan)} · ` +
        `${esc(A.intentAmount)}: <span dir="ltr" class="ltr">${esc(price(i.amount))} ` +
        `${esc(UI.currency)}</span> · ${esc(A.intentDate)}: ${ltr(day(i.created_at))}</p>` +
        // The code the seller was told to write in the transfer note.
        // This is what the owner matches against the bank statement, so
        // it is the one thing on the row that is set large and LTR.
        `<p class="adm-intent__ref">${esc(A.intentReference)}: ` +
        `<span class="adm-intent__code" dir="ltr">${esc(i.reference || '—')}</span></p>` +
        `<div class="adm-actions">` +
        (wa
          ? `<a class="btn btn--quiet" target="_blank" rel="noopener"` +
            ` href="https://wa.me/${esc(wa)}">${esc(A.intentWhatsapp)}</a>`
          : '') +
        `<form method="post" action="/admin/intents/${esc(i.id)}/activate">` +
        `<button class="btn btn--primary" type="submit"` +
        ` data-confirm="${esc(A.intentConfirm)}">${esc(A.intentActivate)}</button>` +
        `</form>` +
        (pending
          ? `<form method="post" action="/admin/intents/${esc(i.id)}/not-found">` +
            `<button class="btn btn--danger" type="submit"` +
            ` data-confirm="${esc(A.intentNotFoundConfirm)}">${esc(A.intentNotFound)}</button>` +
            `</form>`
          : '') +
        `</div></div>`
      );
    })
    .join('');
}

/**
 * Shops whose plan runs out within the week.
 *
 * The WhatsApp link opens a chat and stops there. Sending the message
 * automatically would need the WhatsApp Business API; the owner types
 * it himself.
 */
function expiringList(rows) {
  const body = rows.length
    ? rows.map((r) => {
        const wa = String(r.whatsapp || '').replace(/[^0-9]/g, '');
        return (
          `<div class="adm-card adm-expiring">` +
          `<a class="adm-intent__shop" href="/admin/shops/${esc(r.shop_id)}">` +
          `${esc(r.name || '—')}</a>` +
          `<p class="adm-row__slug ltr" dir="ltr">/@${esc(r.slug || '')}</p>` +
          `<p class="adm-intent__line">` +
          `${esc(PLAN_LABEL[r.plan] || r.plan)} · ` +
          `${esc(A.intentDate)}: ${ltr(day(r.expires_at))} · ` +
          `${r.in_grace
            ? esc(A.expiringGrace)
            : esc(A.expiringDays(Math.max(0, r.days_left ?? 0)))}</p>` +
          (wa
            ? `<div class="adm-actions">` +
              `<a class="btn btn--quiet" target="_blank" rel="noopener"` +
              ` href="https://wa.me/${esc(wa)}">${esc(A.expiringWhatsapp)}</a></div>`
            : '') +
          `</div>`
        );
      }).join('')
    : `<p class="adm-empty">${esc(A.expiringEmpty)}</p>`;

  return `<h2 class="adm-h1 adm-h1--spaced">${esc(A.expiringTitle)}</h2>${body}`;
}

/* ============================================================
   reports
   ============================================================ */

export function adminReports({ reports }) {
  const body =
    `<h2 class="adm-h1">${esc(A.reportsTitle)}</h2>` +
    (reports.length
      ? reports.map(reportCard).join('')
      : `<p class="adm-empty">${esc(A.reportsEmpty)}</p>`);

  return shell('reports', body);
}

function reportCard(r) {
  const product = r.products;
  const shop = product?.shops || r.shops;
  const target = product
    ? `<a href="/@${esc(shop?.slug || '')}/p/${esc(product.id)}">${esc(product.title)}</a>`
    : `<a href="/@${esc(shop?.slug || '')}">${esc(shop?.name || '—')}</a>`;

  return (
    `<div class="adm-card">` +
    `<p class="adm-intent__line">${esc(A.reportTarget)}: ${target}</p>` +
    `<p class="adm-intent__line">${esc(A.reportReason)}: ` +
    `${esc(REPORT_REASONS[r.reason] || r.reason)} · ${ltr(day(r.created_at))}</p>` +
    (r.details ? `<p class="adm-report__details">${esc(r.details)}</p>` : '') +
    `<div class="adm-actions">` +
    (product
      ? `<form method="post" action="/admin/reports/${esc(r.id)}/hide">` +
        `<button class="btn btn--danger" type="submit"` +
        ` data-confirm="${esc(A.reportHideConfirm)}">${esc(A.reportHide)}</button></form>`
      : '') +
    `<form method="post" action="/admin/reports/${esc(r.id)}/dismiss">` +
    `<button class="btn btn--quiet" type="submit">${esc(A.reportDismiss)}</button>` +
    `</form></div></div>`
  );
}
