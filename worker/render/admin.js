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

export function adminShop({ shop, sub, products, note, origin, saved, error }) {
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

    `<h2 class="adm-h2">${esc(A.productsTitle)}</h2>` +
    (products.length
      ? products.map((p) => productRow(p, shop)).join('')
      : `<p class="adm-empty">${esc(A.productsEmpty)}</p>`);

  return shell('shops', body, { title: A.detailTitle });
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

export function adminIntents({ intents }) {
  return shell('intents', `<h2 class="adm-h1">${esc(A.intentsTitle)}</h2>` + intentList(intents));
}

function intentList(intents, limit) {
  const rows = limit ? intents.slice(0, limit) : intents;
  if (!rows.length) return `<p class="adm-empty">${esc(A.intentsEmpty)}</p>`;

  return rows
    .map((i) => {
      const wa = String(i.shops?.whatsapp || '').replace(/[^0-9]/g, '');
      return (
        `<div class="adm-card adm-intent">` +
        `<a class="adm-intent__shop" href="/admin/shops/${esc(i.shop_id)}">` +
        `${esc(i.shops?.name || '—')}</a>` +
        `<p class="adm-row__slug ltr" dir="ltr">/@${esc(i.shops?.slug || '')}</p>` +
        `<p class="adm-intent__line">` +
        `${esc(A.intentPlan)}: ${esc(PLAN_LABEL[i.plan] || i.plan)} · ` +
        `${esc(A.intentAmount)}: <span dir="ltr" class="ltr">${esc(price(i.amount))} ` +
        `${esc(UI.currency)}</span> · ${esc(A.intentDate)}: ${ltr(day(i.created_at))}</p>` +
        `<div class="adm-actions">` +
        (wa
          ? `<a class="btn btn--quiet" target="_blank" rel="noopener"` +
            ` href="https://wa.me/${esc(wa)}">${esc(A.intentWhatsapp)}</a>`
          : '') +
        `<form method="post" action="/admin/intents/${esc(i.id)}/activate">` +
        `<button class="btn btn--primary" type="submit"` +
        ` data-confirm="${esc(A.intentConfirm)}">${esc(A.intentActivate)}</button>` +
        `</form></div></div>`
      );
    })
    .join('');
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
