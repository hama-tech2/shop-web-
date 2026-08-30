/**
 * Shop Web — add / edit product.
 *
 * The phone does the expensive work so the network does not: every photo
 * is cropped to 4:5 and re-encoded to two WebP variants before a byte is
 * uploaded. A 5MB camera original becomes roughly 60-120KB.
 *
 * The Worker still re-checks everything — magic bytes, size, count — and
 * picks the R2 key itself. Nothing here is trusted on the server.
 */
(function () {
  'use strict';

  var form = document.getElementById('product-form');
  if (!form) return;

  var D = form.dataset;
  var MAX = Number(D.max) || 10;
  var CARD = { w: +D.cardW, h: +D.cardH, q: +D.cardQ };
  var FULL = { w: +D.fullW, h: +D.fullH, q: +D.fullQ };

  var thumbs = document.getElementById('thumbs');
  var addBtn = document.getElementById('add-photo');
  var input = document.getElementById('photo-input');
  var countOut = document.getElementById('photo-count');
  var imagesField = document.getElementById('images-field');
  var saveBtn = document.getElementById('save-btn');

  var items = [];
  try { items = JSON.parse(imagesField.value || '[]'); } catch (e) { items = []; }

  /* =========================================================
     gallery bookkeeping
     ========================================================= */

  function sync() {
    imagesField.value = JSON.stringify(items);
    countOut.textContent = items.length + ' / ' + MAX;
    addBtn.hidden = items.length >= MAX;

    // The first thumbnail is the cover; the badge has to follow it.
    var nodes = thumbs.querySelectorAll('.thumb[data-card]');
    for (var i = 0; i < nodes.length; i++) {
      var badge = nodes[i].querySelector('.thumb__badge');
      if (i === 0 && !badge) {
        badge = document.createElement('span');
        badge.className = 'thumb__badge';
        badge.textContent = 'سەرەکی';
        nodes[i].appendChild(badge);
      } else if (i !== 0 && badge) {
        badge.remove();
      }
    }
  }

  function makeThumb(objectUrl) {
    var el = document.createElement('div');
    el.className = 'thumb';
    el.dataset.busy = '1';
    el.innerHTML =
      '<img alt="" decoding="async">' +
      '<button class="thumb__x" type="button" aria-label="لابردنی وێنە">✕</button>' +
      '<span class="thumb__bar"><span class="thumb__bar-fill"></span></span>';
    el.querySelector('img').src = objectUrl;
    thumbs.insertBefore(el, addBtn);
    return el;
  }

  thumbs.addEventListener('click', function (e) {
    var x = e.target.closest && e.target.closest('.thumb__x');
    if (!x) return;
    var thumb = x.closest('.thumb');
    var key = thumb.dataset.card;
    if (key) items = items.filter(function (it) { return it.card !== key; });
    thumb.remove();
    sync();
  });

  addBtn.addEventListener('click', function () {
    if (items.length >= MAX) { alert(D.msgLimit); return; }
    input.value = '';
    input.click();
  });

  input.addEventListener('change', function () {
    var files = Array.prototype.slice.call(input.files || []);
    if (files.length) queue(files);
  });

  /* =========================================================
     crop — delegated to the shared sheet in crop.js
     ========================================================= */

  var pending = [];   // files still to crop

  /* =========================================================
     queue: crop each picked file, then upload it
     ========================================================= */

  function queue(files) {
    pending = pending.concat(files);
    if (pending.length === files.length) step();
  }

  // A file the browser cannot decode comes back as a cancel; say so
  // rather than letting it vanish silently.
  function maybeType(file) {
    if (file && !/^image\/(jpeg|png|webp)$/.test(file.type)) alert(D.msgType);
  }

  function step() {
    if (!pending.length) return;
    if (items.length >= MAX) { pending = []; alert(D.msgLimit); return; }

    var file = pending.shift();
    window.ShopCrop.open(
      file,
      { ratio: CARD.h / CARD.w,
        targets: [{ key: 'card', w: CARD.w, q: CARD.q },
                  { key: 'full', w: FULL.w, q: FULL.q }] },
      function (blobs) {
        if (blobs) upload(blobs); else if (!blobs) maybeType(file);
        step();
      },
    );
  }

  function upload(blobs) {
    var preview = URL.createObjectURL(blobs.card);
    var thumb = makeThumb(preview);
    var fill = thumb.querySelector('.thumb__bar-fill');

    var body = new FormData();
    body.append('draft_id', D.draft);
    body.append('card', blobs.card, 'card.webp');
    body.append('full', blobs.full, 'full.webp');

    // XHR rather than fetch: fetch cannot report upload progress.
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/app/upload');
    xhr.responseType = 'json';

    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) fill.style.width = Math.round((e.loaded / e.total) * 100) + '%';
    };

    xhr.onload = function () {
      URL.revokeObjectURL(preview);
      if (xhr.status !== 200 || !xhr.response || !xhr.response.card) {
        thumb.remove();
        alert(xhr.response && xhr.response.error === 'limit' ? D.msgLimit : D.msgUpload);
        return;
      }
      thumb.dataset.card = xhr.response.card;
      thumb.dataset.full = xhr.response.full;
      thumb.querySelector('img').src = xhr.response.url;
      thumb.querySelector('.thumb__bar').hidden = true;
      delete thumb.dataset.busy;
      items.push({ card: xhr.response.card, full: xhr.response.full });
      sync();
    };

    xhr.onerror = function () {
      URL.revokeObjectURL(preview);
      thumb.remove();
      alert(D.msgUpload);
    };

    xhr.send(body);
  }

  /* =========================================================
     price, category, visibility, save
     ========================================================= */

  var price = document.getElementById('f-price');
  if (price) {
    price.addEventListener('input', function () {
      var digits = price.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      price.value = digits ? Number(digits).toLocaleString('en-US') : '';
    });
  }

  var chips = document.getElementById('category-chips');
  var categoryField = document.getElementById('category-field');
  if (chips) {
    chips.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.chip');
      if (!chip) return;
      var all = chips.querySelectorAll('.chip');
      for (var i = 0; i < all.length; i++) all[i].removeAttribute('aria-current');
      chip.setAttribute('aria-current', 'true');
      categoryField.value = chip.dataset.category || '';
    });
  }

  var toggle = document.getElementById('visibility');
  var statusField = document.getElementById('status-field');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var on = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(on));
      toggle.querySelector('.switch__text').textContent = on ? toggle.dataset.on : toggle.dataset.off;
      statusField.value = on ? 'active' : 'hidden';
    });
  }

  form.addEventListener('submit', function (e) {
    if (!items.length) {
      e.preventDefault();
      alert(form.dataset.msgUpload && document.querySelector('.thumb[data-busy]')
        ? D.msgUpload
        : 'لانیکەم یەک وێنە زیاد بکە.');
      return;
    }
    if (thumbs.querySelector('.thumb[data-busy]')) {
      e.preventDefault();
      alert(D.msgUpload);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = saveBtn.dataset.saving;
  });

  sync();
})();
