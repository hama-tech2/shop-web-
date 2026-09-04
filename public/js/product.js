/* Seller publishing: local image preparation, cover order, and existing upload contract. */
(function () {
  'use strict';
  var form = document.getElementById('product-form');
  if (!form) return;
  var D = form.dataset, max = Number(D.max) || 10;
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
    document.getElementById('photo-count').textContent = items.length + ' / ' + max;
    thumbs.querySelectorAll('.publish-photo, .thumb:not(.thumb--add)').forEach(function (el) { el.remove(); });
    items.forEach(function (item, i) {
      var wrap = document.createElement('div'); wrap.className = 'publish-photo'; wrap.dataset.id = item.id; wrap.draggable = !item.loading;
      var photo = document.createElement('div'); photo.className = 'thumb' + (i === 0 ? ' is-cover' : '');
      var select = button('هەڵبژاردنی وێنەی ' + (i + 1) + ' بۆ کاڤەر', 'thumb__select', ''); select.disabled = !!item.loading;
      if (item.preview) { var img = document.createElement('img'); img.onload = function () { item.previewRatio = img.naturalHeight / img.naturalWidth; }; img.src = item.preview; img.alt = ''; img.draggable = false; select.appendChild(img); }
      else select.textContent = '…';
      photo.appendChild(select);
      var number = document.createElement('span'); number.className = 'thumb__number'; number.textContent = i + 1; photo.appendChild(number);
      if (!i) { var badge = document.createElement('span'); badge.className = 'thumb__badge'; badge.textContent = 'کاڤەر'; photo.appendChild(badge); }
      var remove = button('لابردنی وێنەی ' + (i + 1), 'thumb__x', '×'); remove.disabled = !!item.loading; photo.appendChild(remove);
      wrap.appendChild(photo);
      var order = document.createElement('div'); order.className = 'photo-order';
      var earlier = button('بردنی وێنە بۆ پێشەوە', 'photo-earlier', '→'); earlier.disabled = i === 0 || !!preparing;
      var later = button('بردنی وێنە بۆ دواوە', 'photo-later', '←'); later.disabled = i === items.length - 1 || !!preparing;
      order.append(earlier, later); wrap.appendChild(order); thumbs.insertBefore(wrap, add);
    });
    add.hidden = items.length >= max;
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
      var side = Math.min(bitmap.width, bitmap.height);
      var card = document.createElement('canvas'); card.width = card.height = Math.min(+D.cardW, side);
      card.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, card.width, card.height);
      return { full: await toBlob(full, +D.fullQ), card: await toBlob(card, +D.cardQ) };
    } finally { bitmap.close(); }
  }
  add.addEventListener('click', function () { if (!busy && items.length < max) { input.value = ''; input.click(); } });
  input.addEventListener('change', async function () {
    var files = Array.from(input.files || []); if (!files.length) return;
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
    if (!window.ProductCover) { say('تکایە لاپەڕەکە نوێ بکەرەوە.'); return; }
    var result = await window.ProductCover.open({ items: items, id: id, source: source, title: document.getElementById('f-title').value, price: price.value, width: +D.cardW, quality: +D.cardQ });
    if (!result) return;
    var item = items.find(function (entry) { return entry.id === result.id; });
    if (result.changed) {
      var needed = items.filter(function (entry) { return !entry.card || entry.cardBlob; }).length + (item.card && !item.cardBlob ? 1 : 0);
      if (storedSlots + needed > max) { say('سنووری ناردنی وێنە پڕە؛ گۆڕینی بڕینی وێنەی پاشەکەوتکراو پێویستی بە شوێنی بەتاڵ هەیە. دەتوانیت تەنها کاڤەر هەڵبژێریت.'); return; }
      item.cardBlob = result.blob; item.fullBlob = await source(item); releasePreview(item); item.preview = localUrl(result.blob); item.cropState = result.state;
    }
    move(result.id, 0); say('کاڤەر هەڵبژێردرا.');
  }

  function digits(value) {
    return value.replace(/[٠-٩]/g, function (c) { return c.charCodeAt(0) - 1632; }).replace(/[۰-۹]/g, function (c) { return c.charCodeAt(0) - 1776; }).replace(/\D/g, '');
  }
  price.addEventListener('input', function () { var value = digits(price.value).slice(0, 9); price.value = value ? Number(value).toLocaleString('en-US') : ''; });
  var categoryKey = 'shopweb:last-market-category';
  if (D.restoreCategory === 'true') {
    try { var last = localStorage.getItem(categoryKey); if (last !== null && Array.from(category.options).some(function (option) { return option.value === last; })) category.value = last; } catch (e) { /* Storage is optional. */ }
  }
  category.addEventListener('change', function () { try { localStorage.setItem(categoryKey, category.value); } catch (e) { /* Storage is optional. */ } });
  // Category management opens separately; refresh just the options on return.
  var refreshCategories = false;
  document.querySelector('.category-manage').addEventListener('click', function () { refreshCategories = true; });
  window.addEventListener('focus', async function () {
    if (!refreshCategories || busy) return;
    refreshCategories = false;
    try {
      var response = await fetch('/app/new', { credentials: 'same-origin' });
      if (!response.ok) return;
      var doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      var options = doc.querySelector('#f-own-category');
      if (!options) return;
      var own = document.getElementById('f-own-category'), selected = own.value;
      own.replaceChildren.apply(own, Array.from(options.children));
      own.value = Array.from(own.options).some(function (option) { return option.value === selected; }) ? selected : '';
    } catch (e) { /* Existing options and the unsaved product remain available. */ }
  });
  var toggle = document.getElementById('visibility');
  toggle.addEventListener('click', function () { var on = toggle.getAttribute('aria-checked') !== 'true'; toggle.setAttribute('aria-checked', String(on)); document.getElementById('status-field').value = on ? 'active' : 'hidden'; });
  var description = document.getElementById('f-description');
  function countDescription() { document.getElementById('description-count').textContent = Array.from(description.value).length + ' پیت'; }
  description.addEventListener('input', countDescription); countDescription();

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
    if (storedSlots + pending.length > max) { say('سنووری ناردنی وێنە پڕە. ڕێکخستنی وێنە پاشەکەوتکراوەکان پێویستی بە شوێنی بەتاڵ هەیە.'); return; }
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
