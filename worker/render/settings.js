import { CITY_LABEL, SUBSCRIPTION as S, SUPPORT_WHATSAPP, TRIAL_PRODUCT_LIMIT } from '../config.js';
import { esc } from './html.js';
import { iconBack, iconCalendar, iconDocument, iconExternal, iconLogout,
  iconPhone, iconPin, iconShield, iconStore, iconWhatsapp } from './icons.js';
import { planBannerHtml } from './appshell.js';

const statusLabels = {
  none: 'بێ پلان',
  trial: 'تاقیکردنەوە', active: 'چالاک', pending: 'چاوەڕوانی پشتڕاستکردنەوە',
  grace: 'لە کاتی زیادەدایە', expired: 'بەسەرچووە', suspended: 'ناچالاک',
};
const planLabels = {
  none: 'هێشتا پلانێک نییە', trial: 'ماوەی بەخۆڕایی',
  month_1: '1 مانگ', months_6: '6 مانگ', year_1: 'ساڵانە',
};

/**
 * How close the end is, said once, on the card the seller already
 * looks at.
 *
 * Deliberately not a popup and not repeated: a line inside the plan
 * card, and the access screen in front of a new product. A seller who
 * has three days left should be told so where they can act on it, not
 * interrupted wherever they happen to be.
 *
 * grace counts as over. What is already posted stays visible during
 * grace, but nothing new can be, and that is what this warns about.
 */
function planWarning(plan) {
  if (!plan) return null;
  if (plan.key === 'none') return { level: 'blocked', text: S.warnNone };
  if (plan.key === 'expired' || plan.key === 'grace') {
    return { level: 'blocked', text: S.warnExpired };
  }
  if (plan.key !== 'trial' && plan.key !== 'active' && plan.key !== 'pending') return null;
  const days = Number(plan.days) || 0;
  if (days <= 1) return { level: 'urgent', text: S.warnLast };
  if (days <= 3) return { level: 'urgent', text: S.warnUrgent(days) };
  if (days <= 7) return { level: 'soon', text: S.warnSoon(days) };
  return null;
}
const arrow = `<span class="settings-arrow">${iconBack(18)}</span>`;
const latin = (text) => String(text).replace(/[٠-٩۰-۹]/g, (digit) =>
  String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

function subscriptionCard(subscription) {
  const state = subscription?.state;
  const plan = subscription?.plan;
  // Use the existing server-derived state. Missing data is not expiry.
  const key = state?.status === 'suspended' ? 'suspended' : state ? plan?.key : null;
  const label = statusLabels[key];
  const date = state?.expires_at && !Number.isNaN(Date.parse(state.expires_at))
    ? new Date(state.expires_at).toISOString().slice(0, 10) : '';
  // products_limit_1000 still applies to paid shops. The trial cap is additional.
  const limit = state?.plan === 'trial' ? TRIAL_PRODUCT_LIMIT
    : ['months_6', 'year_1'].includes(state?.plan) ? 1000 : null;
  const warning = planWarning(plan);
  return `<section class="settings-plan" aria-labelledby="settings-plan-title"${key ? ` data-status="${esc(key)}"` : ''}>` +
    `<div class="settings-plan__top"><span class="settings-plan__icon">${iconCalendar(24)}</span>` +
    `<div class="settings-plan__identity"><p class="settings-plan__eyebrow">پلانی ئێستا</p>` +
    `<h2 id="settings-plan-title">${esc(planLabels[state?.plan] || 'بەشداریکردن')}</h2></div>` +
    (label ? `<span class="settings-badge" id="settings-plan-status">${esc(label)}</span>` : '') + `</div>` +
    `<p class="settings-plan__date" id="settings-plan-detail">` +
    (key === 'none' ? esc(S.warnNone)
      : date ? `کۆتایی پلان: <time datetime="${esc(date)}" dir="ltr">${date.replaceAll('-', '/')}</time>`
      : 'وردەکاری پلان لە ئێستادا بەردەست نییە.') + `</p>` +
    (warning
      ? `<p class="settings-plan__warn" id="settings-plan-warning" data-level="${esc(warning.level)}" role="status">` +
        `${esc(warning.text)}</p>`
      : '') +
    `<div class="settings-plan__foot">` +
    (limit !== null ? `<span class="settings-plan__limit">تا <bdi>${limit}</bdi> بەرهەم</span>` : '') +
    `<a class="settings-plan__action" href="/app/subscription" id="settings-subscription">` +
    `${esc(warning ? S.warnAction : 'بینینی پلان')} ${arrow}</a>` +
    `</div></section>`;
}

/** Account stays at the existing protected /app fragment. */
export function settingsPanel({ shop, banner = null, subscription = null }) {
  const support = String(SUPPORT_WHATSAPP || '').replace(/[^0-9]/g, '');
  const supportHref = /^[1-9][0-9]{6,14}$/.test(support) ? `https://wa.me/${support}` : null;
  const row = (label, icon, href, external = false) => {
    const content = `<span class="settings-icon">${icon}</span><span class="settings-row__body">` +
      `<span class="settings-row__label">${label}</span>` +
      (!href ? `<small>لە ئێستادا بەردەست نییە</small>` : '') + `</span>`;
    return href ? `<a class="settings-row" href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${content}${arrow}</a>`
      : `<div class="settings-row settings-row--unavailable">${content}</div>`;
  };
  const phone = shop.phone || shop.whatsapp;
  const location = CITY_LABEL[shop.city] || '';
  return `<section class="shell account-settings" id="account-settings" aria-labelledby="settings-title">` +
    `<header class="settings-head"><a class="icon-btn" href="/app" id="settings-back" aria-label="گەڕانەوە بۆ پرۆفایل">${iconBack()}</a>` +
    `<h1 id="settings-title" tabindex="-1">هەژمار</h1><span></span></header>` +
    `<div class="settings-identity"><span class="settings-avatar">${iconStore(30)}` +
    (shop.logo_key ? `<img src="/img/${esc(shop.logo_key)}" alt="" width="64" height="64" decoding="async">` : '') + `</span>` +
    `<div class="settings-identity__body"><h2>${esc(shop.name)}</h2>` +
    (phone ? `<p>${iconPhone(14)}<bdi dir="ltr">${esc(latin(phone))}</bdi></p>` : '') +
    (location ? `<p>${iconPin(14)}<span>${esc(location)}</span></p>` : '') + `</div>` +
    `<a class="settings-edit" href="/app/profile">دەستکاری پرۆفایل ${arrow}</a></div>` +
    subscriptionCard(subscription) + planBannerHtml(banner) +
    `<h2 class="settings-heading">هەژمار و دوکان</h2><div class="settings-group">` +
    row('دەستکاری پرۆفایلی دوکان', iconStore(), '/app/profile') +
    row('بینینی پرۆفایلی گشتی', iconExternal(), '/@' + shop.slug) + `</div>` +
    `<h2 class="settings-heading">پشتیوانی و یاسایی</h2><div class="settings-group">` +
    row('یارمەتی و پشتیوانی', iconWhatsapp(22), supportHref, true) +
    row('مەرج و ڕێساکان', iconShield(), null) +
    row('سیاسەتی تایبەتمەندی', iconDocument(), null) + `</div>` +
    `<form class="settings-logout" method="post" action="/logout">` +
    `<button class="settings-row" type="submit"><span class="settings-icon">${iconLogout()}</span>` +
    `<span class="settings-row__body settings-row__label">چوونە دەرەوە</span>${arrow}</button></form></section>`;
}
