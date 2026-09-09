/** Fragment navigation only; the protected server page supplies Account data. */
(function () {
  'use strict';
  var panel = document.getElementById('account-settings');
  if (!panel) return;
  var open = document.getElementById('settings-open');
  var originalTitle = document.title;
  var wasOpen = false;
  var logo = panel.querySelector('.settings-avatar img');
  if (logo) {
    var fallback = function () { logo.hidden = true; };
    logo.addEventListener('error', fallback);
    if (logo.complete && !logo.naturalWidth) fallback();
  }
  function sync() {
    var visible = location.hash === '#account-settings';
    document.title = visible ? 'هەژمار — ' + originalTitle : originalTitle;
    if (visible) {
      document.getElementById('settings-title').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } else if (wasOpen) {
      if (open) open.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    wasOpen = visible;
  }
  document.getElementById('settings-back').addEventListener('click', function (event) {
    event.preventDefault();
    location.hash = '';
  });
  window.addEventListener('hashchange', sync);
  // Native fragment navigation can move focus after deferred scripts run.
  // Restore the view heading once the initial page (or bfcache page) is shown.
  window.addEventListener('pageshow', sync);
  sync();
})();
