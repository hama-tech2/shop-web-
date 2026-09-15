/** Optional password visibility. Native form submission needs no JavaScript. */
(function () {
  'use strict';
  var toggle = document.querySelector('.login__reveal');
  var password = document.getElementById('f-password');
  if (!toggle || !password) return;

  toggle.hidden = false;
  toggle.addEventListener('click', function () {
    var show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
  });
})();
