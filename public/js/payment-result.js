/**
 * Watching a payment that is still in the air.
 *
 * This file knows nothing about payments. It asks the server, and the
 * server asks Wayl. It cannot make a payment succeed, fail or cancel,
 * and there is no state machine here to be tampered with: the moment
 * the server says the payment is no longer in progress, the page is
 * reloaded and the server renders the result.
 *
 * Closing the page does not cancel anything. Nothing is posted here.
 */
(function () {
  'use strict';

  var main = document.querySelector('[data-result-ref]');
  if (!main) return;

  var reference = main.getAttribute('data-result-ref');
  if (!/^[A-Za-z0-9-]{6,64}$/.test(reference)) return;

  var slow = document.getElementById('payment-result-slow');
  var startedAt = Date.now();
  var EVERY = 2000;      // how often to ask while a payment is fresh
  var SLOWER = 5000;     // and after it has been a while
  var CALM = 30000;      // when to say it is taking longer than usual
  var EASE_OFF = 60000;  // when to stop asking every two seconds
  var GIVE_UP = 900000;  // 15 minutes of asking is enough

  function again() {
    var waited = Date.now() - startedAt;
    // Not an error, and never presented as one: the payment is still
    // going, and the server is still the only thing that can say so.
    if (waited > GIVE_UP) return;
    if (slow && slow.hidden && waited > CALM) slow.hidden = false;
    setTimeout(ask, waited > EASE_OFF ? SLOWER : EVERY);
  }

  function ask() {
    fetch('/app/subscription/status?ref=' + encodeURIComponent(reference), {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        // Anything other than "still going" is the server's answer, and
        // the server is what draws it.
        if (data && data.state && data.state !== 'checking') {
          window.location.replace(window.location.pathname + window.location.search);
          return;
        }
        again();
      })
      .catch(again);
  }

  setTimeout(ask, EVERY);
})();
