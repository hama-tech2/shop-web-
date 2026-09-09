/** Selection is native HTML. No payment API is called while Wayl is unavailable. */
(function () {
  'use strict';
  var form = document.getElementById('payment-method-form');
  if (!form) return;
  var button = document.getElementById('method-continue');
  var notice = document.getElementById('payment-unavailable');
  function sync() {
    var selected = form.querySelector('input[name="method"]:checked');
    button.querySelector('bdi').textContent = selected && selected.value === 'superqi' ? 'SuperQi' : 'FIB';
  }
  form.addEventListener('change', sync);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    notice.hidden = false;
    notice.focus({ preventScroll: true });
    notice.scrollIntoView({ block: 'nearest' });
  });
  window.addEventListener('pageshow', sync);
  sync();
})();
