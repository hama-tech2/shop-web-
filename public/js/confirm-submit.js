/** Keep destructive confirmations compatible with a CSP that forbids inline scripts. */
(function () {
  'use strict';
  document.addEventListener('submit', function (event) {
    var message = event.target && event.target.dataset
      ? event.target.dataset.confirm
      : '';
    if (message && !window.confirm(message)) event.preventDefault();
  });
})();
