/**
 * Shop Web — auth, wizard and seller-area behaviour.
 *
 * Every page here works with JavaScript switched off: the forms post to
 * the server and the server re-renders. This file only makes three
 * things nicer — a live slug check, a logo preview, and copy-to-clipboard.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     step 2 — is this link free?
     The server re-checks on submit; this is only the hint.
     --------------------------------------------------------- */

  var slug = document.getElementById('f-slug');

  if (slug) {
    var hint = document.getElementById('slug-hint');
    var next = document.getElementById('slug-next');
    var timer = null;
    var seq = 0;

    function say(state, key) {
      if (!hint) return;
      hint.dataset.state = state;
      hint.textContent = hint.dataset['msg' + key] || '';
    }

    function setBusy(busy) {
      if (next) next.disabled = busy;
    }

    function check() {
      var value = slug.value.trim().toLowerCase();
      if (slug.value !== value) slug.value = value;

      if (!value) {
        say('', 'Format');
        setBusy(false);
        return;
      }

      say('', 'Checking');
      setBusy(true);
      var mine = ++seq;

      fetch('/api/slug-check?slug=' + encodeURIComponent(value), {
        headers: { accept: 'application/json' },
      })
        .then(function (r) { return r.json(); })
        .then(function (verdict) {
          if (mine !== seq) return;             // a newer keystroke won
          if (verdict.available) {
            say('ok', 'Ok');
            setBusy(false);
          } else {
            var key = verdict.reason === 'taken' ? 'Taken'
                    : verdict.reason === 'reserved' ? 'Reserved'
                    : 'Format';
            say('bad', key);
            setBusy(true);
          }
        })
        .catch(function () {
          // Never block submission on a failed check — the server decides.
          if (mine === seq) { say('', 'Format'); setBusy(false); }
        });
    }

    slug.addEventListener('input', function () {
      // Invalidate the old request immediately, including when cleared.
      seq++;
      clearTimeout(timer);
      say('', 'Format');
      setBusy(false);
      timer = setTimeout(check, 300);
    });

    if (slug.value.trim()) check();
  }

  /* ---------------------------------------------------------
     step 4 — logo preview
     --------------------------------------------------------- */

  var logo = document.getElementById('f-logo');
  if (logo) {
    logo.addEventListener('change', function () {
      var file = logo.files && logo.files[0];
      if (!file) return;

      var preview = document.getElementById('logo-preview');
      var label = document.getElementById('logo-label');
      if (preview) {
        if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
        var objectUrl = URL.createObjectURL(file);
        preview.dataset.objectUrl = objectUrl;
        preview.src = objectUrl;
        preview.hidden = false;
      }
      if (label) label.textContent = file.name;
    });
  }

  // The shop link and its copy button live on the profile screen, which
  // loads /js/account.js. Nothing on the pages this file serves renders
  // one, so there is no copy handler here.
})();
