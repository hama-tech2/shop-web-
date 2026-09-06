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

  // The five states, named once on the server and read here. Deriving
  // them a second time in the browser is how the panel and the plan
  // screen end up disagreeing about whether a shop has expired.
  var PLAN_LABEL = {
    trial: 'تاقیکردنەوە',
    pending: 'چاوەڕوانی پشتڕاستکردنەوە',
    active: 'چالاکە',
    grace: 'لە کاتی زیادەدایە',
    expired: 'بەسەرچووە',
  };

  async function subscription() {
    if (controller) controller.abort();
    var request = controller = new AbortController();
    badge.hidden = true;
    detail.textContent = 'بینینی وردەکاری و پلانەکان';
    try {
      var response = await fetch('/app/subscription', { credentials: 'same-origin', cache: 'no-store', signal: request.signal });
      if (!response.ok || new URL(response.url).pathname !== '/app/subscription') return;
      var doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      var source = doc.querySelector('[data-plan-state]');
      if (request.signal.aborted || !source) return;
      var label = PLAN_LABEL[source.dataset.planState];
      if (!label) return;
      var days = Number(source.dataset.planDays);
      badge.textContent = label;
      badge.hidden = false;
      detail.textContent =
        (source.dataset.planState === 'trial' || source.dataset.planState === 'active')
        && Number.isFinite(days) && days > 0
          ? days + ' ڕۆژ ماوە'
          : 'بینینی وردەکاری و پلانەکان';
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
