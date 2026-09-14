/**
 * Bazaro — the last screen before Wayl.
 *
 * Two jobs, both about a seller tapping twice.
 *
 *  1. Show the dinar figure for whichever plan is selected. The plans
 *     are named in dollars and charged in dinars, and nobody should
 *     meet the dinar number for the first time on somebody else's site.
 *
 *  2. Stop the second tap. Creating a checkout is a round trip to Wayl,
 *     so the button sits there looking dead for a second or two, which
 *     is exactly when a person presses it again.
 *
 * Neither is a protection. The server is: wayl_start_intent reuses the
 * one live attempt per shop per plan, so a double post returns the same
 * checkout rather than making a second one. This only spares the seller
 * the confusion. With JavaScript off, everything below simply does not
 * happen and the page still works.
 */
(function () {
  'use strict';

  /* ---------- 1. the charge follows the selection ---------- */

  var planForm = document.getElementById('plan-form');
  if (planForm) {
    // The charge lines moved into the dock, outside the form.
    var lines = document.querySelectorAll('[data-charge-for]');
    var syncCharge = function () {
      var picked = planForm.querySelector('input[name="plan"]:checked');
      var key = picked ? picked.value : null;
      for (var i = 0; i < lines.length; i += 1) {
        lines[i].hidden = lines[i].getAttribute('data-charge-for') !== key;
      }
    };
    planForm.addEventListener('change', syncCharge);
    syncCharge();
  }

  /* ---------- 2. one tap, once ---------- */

  /**
   * A form's submit button, wherever it is.
   *
   * The renewal screen keeps its radios in the form and its button in
   * the dock, associated by the form attribute. Looking only inside the
   * form would find nothing and silently drop the busy state.
   */
  function submitFor(form) {
    return form.querySelector('button[type="submit"]')
      || (form.id && document.querySelector('[form="' + form.id + '"][type="submit"]'));
  }

  var forms = document.querySelectorAll('form[data-checkout]');

  Array.prototype.forEach.call(forms, function (form) {
    var busy = false;

    form.addEventListener('submit', function (event) {
      // Already on its way to Wayl. Swallow the second press rather
      // than letting the browser post the form again.
      if (busy) {
        event.preventDefault();
        return;
      }
      busy = true;

      var button = submitFor(form);
      if (!button) return;

      // Disabling before the post would drop the button's own name and
      // value from the body, so it waits a tick — the form is already
      // on the wire by then.
      window.setTimeout(function () {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.classList.add('is-busy');
      }, 0);
    });

    // Coming back with the back button hands the page over from the
    // browser's cache with the button still dead. Give it back.
    window.addEventListener('pageshow', function () {
      busy = false;
      var button = submitFor(form);
      if (!button) return;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.classList.remove('is-busy');
    });
  });
})();
