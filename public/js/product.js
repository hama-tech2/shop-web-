/* Seller publishing: local image preparation, cover order, and existing upload contract. */
(function () {
  'use strict';
  var form = document.getElementById('product-form');
  if (!form) return;
  var D = form.dataset, max = Number(D.max) || 5, storageMax = Number(D.storageMax) || max, coverOnly = D.coverOnly === 'true';
  var thumbs = document.getElementById('thumbs');
  var add = document.getElementById('add-photo');
  var input = document.getElementById('photo-input');
  var imagesField = document.getElementById('images-field');
  var save = document.getElementById('save-btn');
  var message = document.getElementById('product-message');
  var category = document.getElementById('category-field');
  var price = document.getElementById('f-price');
  var serial = 0, busy = false, preparing = 0;
  var items = [];
  try { items = JSON.parse(imagesField.value || '[]'); } catch (e) { items = []; }
  var storedSlots = items.length;
  var urls = [];
  var normalSaveLabel = save.textContent;
  function imageUrl(key) { return '/img/' + key.split('/').map(encodeURIComponent).join('/'); }
  function localUrl(blob) { var url = URL.createObjectURL(blob); urls.push(url); return url; }
  function releasePreview(item) {
    if (item.preview && item.preview.startsWith('blob:')) {
      URL.revokeObjectURL(item.preview); urls = urls.filter(function (url) { return url !== item.preview; });
    }
  }
  items.forEach(function (item) { item.id = String(++serial); item.preview = imageUrl(item.card); });
  function say(text) { message.textContent = text || ''; message.hidden = !text; }
  function button(label, className, text) {
    var el = document.createElement('button'); el.type = 'button'; el.className = className;
    el.setAttribute('aria-label', label); el.textContent = text; return el;
  }
  function sync() {
    imagesField.value = JSON.stringify(items.filter(function (item) { return item.card; }).map(function (item) { return { card: item.card, full: item.full }; }));
    document.getElementById('photo-count').textContent = items.length > max ? items.length + ' وێنەی پارێزراو' : items.length + ' / ' + max;
    thumbs.querySelectorAll('.publish-photo, .thumb:not(.thumb--add)').forEach(function (el) { el.remove(); });
    items.forEach(function (item, i) {
      var wrap = document.createElement('div'); wrap.className = 'publish-photo'; wrap.dataset.id = item.id; wrap.draggable = !coverOnly && !item.loading;
      var photo = document.createElement('div'); photo.className = 'thumb' + (i === 0 ? ' is-cover' : '');
      var select = button('هەڵبژاردنی وێنەی ' + (i + 1) + ' بۆ کاڤەر', 'thumb__select', ''); select.disabled = !!item.loading;
      if (item.preview) { var img = document.createElement('img'); img.onload = function () { item.previewRatio = img.naturalHeight / img.naturalWidth; }; img.src = item.preview; img.alt = ''; img.draggable = false; select.appendChild(img); }
      else select.textContent = '…';
      photo.appendChild(select);
      var number = document.createElement('span'); number.className = 'thumb__number'; number.textContent = i + 1; photo.appendChild(number);
      if (!i) { var badge = document.createElement('span'); badge.className = 'thumb__badge'; badge.textContent = 'کاڤەر'; photo.appendChild(badge); }
      if (!coverOnly) { var remove = button('لابردنی وێنەی ' + (i + 1), 'thumb__x', '×'); remove.disabled = !!item.loading; photo.appendChild(remove); }
      wrap.appendChild(photo);
      if (!coverOnly) {
        var order = document.createElement('div'); order.className = 'photo-order';
        var earlier = button('بردنی وێنە بۆ پێشەوە', 'photo-earlier', '→'); earlier.disabled = i === 0 || !!preparing;
        var later = button('بردنی وێنە بۆ دواوە', 'photo-later', '←'); later.disabled = i === items.length - 1 || !!preparing;
        order.append(earlier, later); wrap.appendChild(order);
      }
      thumbs.insertBefore(wrap, add);
    });
    add.hidden = !coverOnly && items.length >= max;
    save.disabled = busy || preparing > 0;
  }
  function move(id, to) {
    var from = items.findIndex(function (item) { return item.id === id; });
    if (from < 0 || to < 0 || to >= items.length || preparing || busy) return;
    items.splice(to, 0, items.splice(from, 1)[0]); sync();
    var selected = thumbs.querySelector('[data-id="' + id + '"] .thumb__select'); if (selected) selected.focus();
  }
  thumbs.addEventListener('click', function (e) {
    var wrap = e.target.closest('.publish-photo'); if (!wrap || busy || preparing) return;
    var index = items.findIndex(function (item) { return item.id === wrap.dataset.id; });
    if (e.target.closest('.thumb__x')) { releasePreview(items[index]); items.splice(index, 1); sync(); add.focus(); }
    else if (e.target.closest('.photo-earlier')) move(wrap.dataset.id, index - 1);
    else if (e.target.closest('.photo-later')) move(wrap.dataset.id, index + 1);
    else if (e.target.closest('.thumb__select')) editCover(wrap.dataset.id);
  });
  var dragged;
  thumbs.addEventListener('dragstart', function (e) {
    var wrap = e.target.closest('.publish-photo'); if (!wrap || busy || preparing) { e.preventDefault(); return; }
    dragged = wrap.dataset.id; e.dataTransfer.setData('text/plain', dragged); e.dataTransfer.effectAllowed = 'move';
  });
  thumbs.addEventListener('dragover', function (e) { if (dragged && e.target.closest('.publish-photo')) e.preventDefault(); });
  thumbs.addEventListener('drop', function (e) {
    var wrap = e.target.closest('.publish-photo'); if (!wrap || !dragged) return;
    e.preventDefault(); move(dragged, items.findIndex(function (item) { return item.id === wrap.dataset.id; })); dragged = null;
  });
  thumbs.addEventListener('dragend', function () { dragged = null; });

  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) { canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error(D.msgType)); }, 'image/webp', quality); });
  }
  async function prepare(file) {
    var bitmap = await createImageBitmap(file);
    try {
      var scale = Math.min(1, +D.fullW / bitmap.width, +D.fullH / bitmap.height);
      var full = document.createElement('canvas'); full.width = Math.max(1, Math.round(bitmap.width * scale)); full.height = Math.max(1, Math.round(bitmap.height * scale));
      full.getContext('2d').drawImage(bitmap, 0, 0, full.width, full.height);
      var cropW = Math.min(bitmap.width, bitmap.height), cropH = cropW;
      var card = document.createElement('canvas'); card.width = Math.max(1, Math.round(Math.min(+D.cardW, cropW))); card.height = card.width;
      card.getContext('2d').drawImage(bitmap, (bitmap.width - cropW) / 2, (bitmap.height - cropH) / 2, cropW, cropH, 0, 0, card.width, card.height);
      return { full: await toBlob(full, +D.fullQ), card: await toBlob(card, +D.cardQ) };
    } finally { bitmap.close(); }
  }
  add.addEventListener('click', function () { if (!busy && (coverOnly || items.length < max)) { input.value = ''; input.click(); } });
  input.addEventListener('change', async function () {
    var files = Array.from(input.files || []); if (!files.length) return;
    if (coverOnly) {
      var previous = items[0];
      var replacement = { id: String(++serial), loading: true };
      if (items.length) items[0] = replacement; else items.push(replacement);
      preparing++; sync();
      try {
        if (!/^image\/(jpeg|png|webp)$/.test(files[0].type)) throw new Error(D.msgType);
        var coverBlobs = await prepare(files[0]);
        replacement.source = coverBlobs.full;
        replacement.fullBlob = coverBlobs.full;
        replacement.cardBlob = coverBlobs.card;
        replacement.preview = localUrl(coverBlobs.card);
        replacement.loading = false;
        preparing--; sync();
        if (!await editCover(replacement.id)) {
          releasePreview(replacement);
          if (previous) items[0] = previous; else items.shift();
          sync();
        }
      } catch (e) {
        if (replacement.loading) preparing--;
        releasePreview(replacement);
        if (previous) items[0] = previous; else items.shift();
        say(D.msgType); sync();
      }
      return;
    }
    var available = max - items.length;
    say(files.length > available ? D.msgLimit : ''); files = files.slice(0, available);
    var batch = files.map(function (file) { var item = { id: String(++serial), loading: true }; items.push(item); return { file: file, item: item }; });
    preparing += batch.length; sync();
    for (var entry of batch) {
      try {
        if (!/^image\/(jpeg|png|webp)$/.test(entry.file.type)) throw new Error(D.msgType);
        var blobs = await prepare(entry.file);
        entry.item.source = blobs.full; entry.item.fullBlob = blobs.full; entry.item.cardBlob = blobs.card;
        entry.item.preview = localUrl(blobs.card); entry.item.loading = false;
      } catch (e) { items = items.filter(function (item) { return item !== entry.item; }); say(D.msgType); }
      preparing--; sync();
    }
  });
  async function source(item) {
    if (item.source) return item.source;
    var response = await fetch(imageUrl(item.full || item.card), { credentials: 'same-origin' });
    if (!response.ok) throw new Error('وێنەکە بار نەکرا؛ دووبارە هەوڵ بدەرەوە.');
    item.source = await response.blob(); return item.source;
  }
  async function editCover(id) {
    if (!window.ProductCover) { say('تکایە لاپەڕەکە نوێ بکەرەوە.'); return false; }
    var result = await window.ProductCover.open({ items: items, id: id, source: source, title: document.getElementById('f-title').value, price: price ? price.value : D.price, width: +D.cardW, quality: +D.cardQ });
    if (!result) return false;
    var item = items.find(function (entry) { return entry.id === result.id; });
    if (result.changed) {
      var needed = items.filter(function (entry) { return !entry.card || entry.cardBlob; }).length + (item.card && !item.cardBlob ? 1 : 0);
      if (storedSlots + needed > storageMax) { say('سنووری ناردنی وێنە پڕە؛ گۆڕینی بڕینی وێنەی پاشەکەوتکراو پێویستی بە شوێنی بەتاڵ هەیە. دەتوانیت تەنها کاڤەر هەڵبژێریت.'); return false; }
      item.cardBlob = result.blob; item.fullBlob = await source(item); releasePreview(item); item.preview = localUrl(result.blob); item.cropState = result.state;
    }
    move(result.id, 0); say('کاڤەر هەڵبژێردرا.'); return true;
  }

  function digits(value) {
    return value.replace(/[٠-٩]/g, function (c) { return c.charCodeAt(0) - 1632; }).replace(/[۰-۹]/g, function (c) { return c.charCodeAt(0) - 1776; }).replace(/\D/g, '');
  }
  if (price) price.addEventListener('input', function () { var value = digits(price.value).slice(0, 9); price.value = value ? Number(value).toLocaleString('en-US') : ''; });

  /* The unit beside the price follows the currency the seller picked.
     The server already rendered the right one for the stored value, so
     this only keeps it in step while they are looking at it — and it
     deliberately never touches price.value: there is no rate in this
     app, and changing the number under somebody because they pressed a
     button is not a conversion, it is a new price they did not set. */
  var unit = document.getElementById('price-unit');
  var seg = document.getElementById('currency-seg');
  if (unit && seg) {
    seg.addEventListener('change', function (event) {
      var picked = event.target;
      if (picked && picked.name === 'currency' && picked.dataset.symbol) {
        unit.textContent = picked.dataset.symbol;
      }
    });
  }
  var categoryKey = 'shopweb:last-market-category';
  if (D.restoreCategory === 'true') {
    try { var last = localStorage.getItem(categoryKey); if (last !== null && Array.from(category.options).some(function (option) { return option.value === last; })) category.value = last; } catch (e) { /* Storage is optional. */ }
  }
  category.addEventListener('change', function () { try { localStorage.setItem(categoryKey, category.value); } catch (e) { /* Storage is optional. */ } });
  var description = document.getElementById('f-description');
  if (description) {
    function countDescription() { document.getElementById('description-count').textContent = Array.from(description.value).length + ' پیت'; }
    description.addEventListener('input', countDescription); countDescription();
  }

  function upload(item, index, total) {
    return new Promise(function (resolve, reject) {
      var body = new FormData(); body.append('draft_id', D.draft); body.append('card', item.cardBlob, 'card.webp'); body.append('full', item.fullBlob, 'full.webp');
      var xhr = new XMLHttpRequest(); xhr.open('POST', '/app/upload'); xhr.responseType = 'json'; xhr.timeout = 120000;
      xhr.upload.onprogress = function (e) { say('ناردنی وێنە ' + index + ' / ' + total + (e.lengthComputable ? ' · ' + Math.round(e.loaded / e.total * 100) + '%' : '')); };
      xhr.onload = function () {
        if (xhr.status !== 200 || !xhr.response || !xhr.response.card) { reject(new Error(xhr.response && xhr.response.error === 'limit' ? D.msgLimit : D.msgUpload)); return; }
        item.card = xhr.response.card; item.full = xhr.response.full; item.cardBlob = null; item.fullBlob = null; storedSlots++; resolve();
      };
      xhr.onerror = xhr.ontimeout = function () { reject(new Error(D.msgUpload)); }; xhr.send(body);
    });
  }
  form.addEventListener('submit', async function (e) {
    e.preventDefault(); if (busy || preparing) return;
    if (!items.length) { say('لانیکەم یەک وێنە زیاد بکە.'); add.focus(); return; }
    if (!form.reportValidity()) return;
    var pending = items.filter(function (item) { return !item.card || item.cardBlob; });
    if (pending.length && storedSlots + pending.length > storageMax) { say('سنووری ناردنی وێنە پڕە. ڕێکخستنی وێنە پاشەکەوتکراوەکان پێویستی بە شوێنی بەتاڵ هەیە.'); return; }
    busy = true; form.inert = true; save.disabled = true; save.textContent = save.dataset.saving;
    try {
      for (var i = 0; i < pending.length; i++) await upload(pending[i], i + 1, pending.length);
      sync(); HTMLFormElement.prototype.submit.call(form);
    } catch (error) { say(error.message || D.msgUpload); busy = false; form.inert = false; save.textContent = normalSaveLabel; sync(); }
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) { busy = false; form.inert = false; save.textContent = normalSaveLabel; sync(); } });
  window.addEventListener('pagehide', function (e) { if (!e.persisted) urls.forEach(function (url) { URL.revokeObjectURL(url); }); });
  sync();
})();
