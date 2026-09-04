import { AUTH } from '../config.js';
import { esc } from './html.js';
import { iconBack, iconGift, iconGlobe, iconUser, iconWhatsapp } from './icons.js';

/** Presentation inside /app, under its existing server-side session guard. */
export function settingsPanel({ shop }) {
  // /app does not pass user.email. SUPPORT_WHATSAPP currently contains a
  // placeholder, and no legal or account-deletion routes exist. Keep those
  // destinations unlinked rather than presenting unsupported actions.
  const unavailable = 'لە ئێستادا بەردەست نییە';
  const quietRow = (label, icon) =>
    `<div class="settings-row settings-row--unavailable">` +
    `<span class="settings-icon">${icon}</span><span class="settings-row__body">` +
    `<span class="settings-row__label">${label}</span>` +
    `<small>${unavailable}</small></span></div>`;
  return `<section class="shell account-settings" id="account-settings" aria-labelledby="settings-title">` +
    `<div class="edit-head"><a class="icon-btn" href="/app" id="settings-back" aria-label="گەڕانەوە بۆ پرۆفایل">${iconBack()}</a>` +
    `<h1 class="edit-head__title" id="settings-title" tabindex="-1">ڕێکخستن</h1><span class="edit-head__spacer"></span></div>` +
    `<p class="settings-intro">هەژمار و بەشداریکردنەکەت</p>` +
    `<div class="settings-identity"><span class="settings-avatar">${iconUser(28)}</span>` +
    `<div><h2>هەژماری من</h2><p>${esc(shop.name)}</p>` +
    `<small>ئیمەیڵ لەم پەڕەیەدا بەردەست نییە.</small></div></div>` +
    `<h2 class="settings-heading">بەشداریکردن</h2>` +
    `<div class="settings-group"><a class="settings-row" href="/app/subscription" id="settings-subscription">` +
    `<span class="settings-icon">${iconGift(22)}</span><span class="settings-row__body">` +
    `<span class="settings-row__label">بەشداریکردنی دوکان <span class="settings-badge" id="settings-plan-status" hidden></span></span>` +
    `<small id="settings-plan-detail" aria-live="polite">بینینی وردەکاری و پلانەکان</small></span><span class="settings-arrow" aria-hidden="true">‹</span></a></div>` +
    `<h2 class="settings-heading">یارمەتی و زانیاری</h2><div class="settings-group">` +
    quietRow('پشتگیری لە ڕێگەی واتساپ', iconWhatsapp(22)) +
    quietRow('تایبەتمەندی', iconGlobe(22)) +
    quietRow('مەرج و ڕێساکان', iconGlobe(22)) +
    `</div>` +
    `<form class="settings-logout" method="post" action="/logout">` +
    `<button class="settings-row" type="submit"><span class="settings-icon">${iconBack(22)}</span>` +
    `<span class="settings-row__label">${esc(AUTH.logout)}</span></button></form>` +
    `</section>`;
}
