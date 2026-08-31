/**
 * Hearts.
 *
 * Signed out, a heart is a product id in localStorage and nothing else
 * — it works on the first tap, with no account and no round trip.
 * Signed in, the same tap also writes to the favorites table, and the
 * ids the browser was holding are handed over once and then dropped.
 *
 * ES5-ish on purpose: this runs on cheap Android phones with old
 * WebViews, and a syntax error here would break every heart at once.
 */
(function () {
  'use strict';

  var KEY = 'shopweb:favorites';
  var MAX = 200;
  var signedIn = false;

  /* ---------- localStorage, defensively ---------- */

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
    } catch (e) {
      // Private mode, or storage disabled. Hearts still toggle for the
      // life of the page; they just do not survive it.
      return [];
    }
  }

  function write(list) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    } catch (e) { /* nothing to do about a full or blocked store */ }
  }

  function has(id) { return read().indexOf(id) !== -1; }

  function add(id) {
    var list = read();
    if (list.indexOf(id) === -1) { list.unshift(id); write(list); }
  }

  function remove(id) {
    var list = read();
    var i = list.indexOf(id);
    if (i !== -1) { list.splice(i, 1); write(list); }
  }

  /* ---------- painting ---------- */

  function paintOne(button, on) {
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /** Reflect the current set onto every heart on the page. */
  function paint(ids) {
    var buttons = document.querySelectorAll('[data-fav]');
    for (var i = 0; i < buttons.length; i += 1) {
      paintOne(buttons[i], ids.indexOf(buttons[i].getAttribute('data-fav')) !== -1);
    }
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
  }

  /* ---------- the tap ---------- */

  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-fav]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    var id = button.getAttribute('data-fav');
    var on = button.getAttribute('aria-pressed') !== 'true';

    // Paint first: the heart must never wait on the network.
    paintOne(button, on);
    if (on) add(id); else remove(id);

    if (signedIn) {
      post('/api/favorites', { id: id, on: on })['catch'](function () {});
    }

    // On /saved, un-hearting removes the card there and then.
    if (!on && document.querySelector('.page--saved')) {
      var card = button.closest('article, .card');
      if (card && card.parentNode) card.parentNode.removeChild(card);
      showEmptyIfBare();
    }
  });

  /* ---------- /saved ---------- */

  function showEmptyIfBare() {
    var grid = document.getElementById('grid');
    var empty = document.getElementById('saved-empty');
    var bare = !grid || !grid.children.length;
    if (grid) grid.hidden = bare;
    if (empty) empty.hidden = !bare;
  }

  /** Signed out, the server sent an empty shell. Fill it from here. */
  function fillSaved() {
    var page = document.querySelector('.page--saved');
    if (!page || page.getAttribute('data-signed-in') === '1') return;

    var note = document.getElementById('saved-note');
    var ids = read();
    if (!ids.length) { showEmptyIfBare(); return; }
    if (note) note.hidden = false;

    fetch('/api/favorites/cards?ids=' + encodeURIComponent(ids.join(',')), {
      credentials: 'same-origin',
    })
      .then(function (res) { return res.ok ? res.text() : ''; })
      .then(function (html) {
        if (!html) { showEmptyIfBare(); return; }
        var list = document.getElementById('saved-list');
        list.innerHTML = '<div class="grid" id="grid">' + html + '</div>';
        paint(ids);
        showEmptyIfBare();
      })
      ['catch'](function () { showEmptyIfBare(); });
  }

  /* ---------- start ---------- */

  // One request answers both questions: who is this, and what have they
  // already saved? Signed in, whatever the browser was holding is
  // merged now and the local copy retired.
  fetch('/api/favorites', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (state) {
      if (!state) { paint(read()); fillSaved(); return; }
      signedIn = state.signedIn;

      if (!signedIn) { paint(read()); fillSaved(); return; }

      var local = read();
      if (!local.length) { paint(state.ids || []); return; }

      return post('/api/favorites/merge', { ids: local })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (merged) {
          // Only forget the local list once the account has it.
          if (merged && merged.ok) {
            write([]);
            paint(merged.ids || []);
          } else {
            paint(local);
          }
        });
    })
    ['catch'](function () { paint(read()); fillSaved(); });
}());
