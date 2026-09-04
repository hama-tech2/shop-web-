/** A fragment view of the protected owner page; authentication stays on the server. */
(function () {
  'use strict';
  var panel = document.getElementById('account-settings');
  if (!panel) return;
  var controller;
  var badge = document.getElementById('settings-plan-status');
  var detail = document.getElementById('settings-plan-detail');
  var open = document.getElementById('settings-open');
  var originalTitle = document.title;
  var wasOpen = false;

  async function subscription() {
    if (controller) controller.abort();
    var request = controller = new AbortController();
    badge.hidden = true;
    detail.textContent = 'بینینی وردەکاری و پلانەکان';
    try {
      var response = await fetch('/app/subscription', { credentials: 'same-origin', cache: 'no-store', signal: request.signal });
      if (!response.ok || new URL(response.url).pathname !== '/app/subscription') return;
      var doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      var source = doc.querySelector('[data-settings-subscription]');
      var state = source && JSON.parse(source.dataset.settingsSubscription);
      if (request.signal.aborted || !state) return;
      var days = Number.isFinite(state.days_left) ? Math.max(0, Math.floor(state.days_left)) : null;
      var label, note = '';
      if (state.status === 'suspended') { label = 'ڕاگیراوە'; }
      else if (state.in_grace === true) { label = 'لە کاتی زیادەدایە'; }
      else if (state.status === 'expired' || (days === 0 && state.in_grace === false)) { label = 'بەسەرچووە'; }
      else if (state.status === 'trialing') { label = 'تاقیکردنەوە'; }
      else if (state.status === 'active') { label = 'چالاکە'; }
      else return;
      if ((state.status === 'trialing' || state.status === 'active') && !state.in_grace && days > 0) note = days + ' ڕۆژ ماوە';
      badge.textContent = label;
      badge.hidden = false;
      detail.textContent = note || 'بینینی وردەکاری و پلانەکان';
    } catch (error) { /* The real subscription link remains usable, with no invented status. */ }
  }

  function sync() {
    var visible = location.hash === '#account-settings';
    document.title = visible ? 'ڕێکخستن — ' + originalTitle : originalTitle;
    if (visible) {
      document.getElementById('settings-title').focus({ preventScroll: true });
      window.scrollTo(0, 0);
      subscription();
    } else if (wasOpen) {
      if (controller) controller.abort();
      open.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    wasOpen = visible;
  }
  document.getElementById('settings-back').addEventListener('click', function (event) {
    event.preventDefault();
    location.hash = '';
  });
  window.addEventListener('hashchange', sync);
  sync();
})();
