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
    var previousValue = slug.value, pendingHyphen = false;

    function clean(value) {
      return value.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
    }

    function complete() {
      var value = clean(slug.value);
      slug.value = value.length >= 3 ? value : value ? value + '-shop' : slug.dataset.suggestion;
      previousValue = slug.value; pendingHyphen = false;
    }

    function say(state, key) {
      if (!hint) return;
      hint.dataset.state = state;
      hint.textContent = hint.dataset['msg' + key] || '';
    }

    function setBusy(busy) {
      if (next) next.disabled = busy;
    }

    function check() {
      var value = clean(slug.value);
      if (slug.value !== value) slug.value = value;

      if (value.length < 3) {
        say('', 'Format');
        setBusy(false);
        return;
      }

      say('', 'Checking');
      setBusy(false);
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
            var unavailable = verdict.reason === 'taken' || verdict.reason === 'reserved';
            say(unavailable ? 'bad' : '', unavailable ? 'Taken' : 'Format');
            setBusy(unavailable);
          }
        })
        .catch(function () {
          // Never block submission on a failed check — the server decides.
          if (mine === seq) { say('', 'Format'); setBusy(false); }
        });
    }

    slug.addEventListener('input', function (event) {
      // Invalidate the old request immediately, including when cleared.
      seq++;
      clearTimeout(timer);
      if (event.isComposing) { setBusy(false); return; }
      var raw = slug.value, caret = slug.selectionStart;
      // Remember a space typed at the end even though the visible slug is trimmed.
      if (pendingHyphen && event.inputType !== 'deleteContentBackward' && raw.indexOf(previousValue) === 0 && raw.length > previousValue.length) {
        raw = previousValue + '-' + raw.slice(previousValue.length); caret++;
      }
      pendingHyphen = /[\s_-]$/.test(raw);
      slug.value = clean(raw);
      previousValue = slug.value;
      var position = clean(raw.slice(0, caret)).length;
      slug.setSelectionRange(position, position);
      say('', 'Format');
      setBusy(false);
      timer = setTimeout(check, 300);
    });

    slug.addEventListener('blur', function () { complete(); check(); });
    document.getElementById('slug-form').addEventListener('submit', complete);

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
