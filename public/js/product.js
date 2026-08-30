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
     crop sheet — 4:5, drag, pinch, rotate
     ========================================================= */

  var crop = document.getElementById('crop');
  var stage = document.getElementById('crop-stage');
  var canvas = document.getElementById('crop-canvas');
  var frameEl = crop.querySelector('.crop__frame');
  var ctx = canvas.getContext('2d');

  var view = null;   // { bitmap, scale, tx, ty, rot, frame }
  var pending = [];  // files still to crop
  var onDone = null;

  function frameRect() {
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var w = Math.min(sw * 0.86, sh * 0.86 * 0.8);
    return { w: w, h: w * 1.25, cx: sw / 2, cy: sh / 2 };
  }

  /** Rotation swaps which image side spans the frame's width. */
  function drawnSize() {
    var b = view.bitmap;
    var turned = view.rot === 90 || view.rot === 270;
    return { w: turned ? b.height : b.width, h: turned ? b.width : b.height };
  }

  function minScale() {
    var d = drawnSize();
    return Math.max(view.frame.w / d.w, view.frame.h / d.h);
  }

  function clamp() {
    var d = drawnSize();
    var halfW = (d.w * view.scale - view.frame.w) / 2;
    var halfH = (d.h * view.scale - view.frame.h) / 2;
    view.tx = Math.max(-Math.max(halfW, 0), Math.min(Math.max(halfW, 0), view.tx));
    view.ty = Math.max(-Math.max(halfH, 0), Math.min(Math.max(halfH, 0), view.ty));
  }

  function paint() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var sw = stage.clientWidth, sh = stage.clientHeight;

    if (canvas.width !== Math.round(sw * dpr) || canvas.height !== Math.round(sh * dpr)) {
      canvas.width = Math.round(sw * dpr);
      canvas.height = Math.round(sh * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sw, sh);

    ctx.save();
    ctx.translate(view.frame.cx + view.tx, view.frame.cy + view.ty);
    ctx.rotate((view.rot * Math.PI) / 180);
    ctx.scale(view.scale, view.scale);
    ctx.drawImage(view.bitmap, -view.bitmap.width / 2, -view.bitmap.height / 2);
    ctx.restore();

    // The frame element supplies the dimming; the guides are drawn here
    // so they line up with the crop region to the pixel.
    guides(sw, sh);

    frameEl.style.width = view.frame.w + 'px';
    frameEl.style.height = view.frame.h + 'px';
  }

  function guides() {
    var f = view.frame;
    var x = f.cx - f.w / 2;
    var y = f.cy - f.h / 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 1; i < 3; i++) {
      ctx.moveTo(x + (f.w / 3) * i, y);
      ctx.lineTo(x + (f.w / 3) * i, y + f.h);
      ctx.moveTo(x, y + (f.h / 3) * i);
      ctx.lineTo(x + f.w, y + (f.h / 3) * i);
    }
    ctx.stroke();

    var arm = Math.min(26, f.w / 5);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // each corner: two arms meeting at the frame's corner
    [[x, y, 1, 1], [x + f.w, y, -1, 1], [x, y + f.h, 1, -1], [x + f.w, y + f.h, -1, -1]]
      .forEach(function (c) {
        ctx.moveTo(c[0] + arm * c[2], c[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(c[0], c[1] + arm * c[3]);
      });
    ctx.stroke();
    ctx.restore();
  }

  async function openCrop(file, done) {
    var bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (e) {
      alert(D.msgType);
      done(null);
      return;
    }

    crop.hidden = false;
    var frame = frameRect();
    view = { bitmap: bitmap, frame: frame, rot: 0, tx: 0, ty: 0, scale: 1 };
    view.scale = minScale();
    onDone = done;
    paint();
  }

  function closeCrop() {
    crop.hidden = true;
    if (view && view.bitmap.close) view.bitmap.close();
    view = null;
  }

  /* ---- gestures ---- */

  var pointers = new Map();
  var pinchStart = 0;
  var scaleStart = 1;

  stage.addEventListener('pointerdown', function (e) {
    if (!view) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      pinchStart = spread();
      scaleStart = view.scale;
    }
  });

  stage.addEventListener('pointermove', function (e) {
    if (!view || !pointers.has(e.pointerId)) return;
    var prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      view.tx += e.clientX - prev.x;
      view.ty += e.clientY - prev.y;
    } else if (pointers.size === 2 && pinchStart > 0) {
      view.scale = Math.max(minScale(), Math.min(8 * minScale(),
        scaleStart * (spread() / pinchStart)));
    }
    clamp();
    paint();
  });

  function release(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  function spread() {
    var p = Array.from(pointers.values());
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  document.getElementById('crop-rotate').addEventListener('click', function () {
    if (!view) return;
    view.rot = (view.rot + 90) % 360;
    view.scale = Math.max(view.scale, minScale());
    view.tx = 0; view.ty = 0;
    clamp();
    paint();
  });

  document.getElementById('crop-cancel').addEventListener('click', function () {
    var done = onDone;
    closeCrop();
    if (done) done(null);
  });

  document.getElementById('crop-done').addEventListener('click', async function () {
    if (!view) return;
    var done = onDone;
    var card = await render(CARD);
    var full = await render(FULL);
    closeCrop();
    if (done) done({ card: card, full: full });
  });

  /**
   * Draw the framed region at the target size.
   *
   * Never upscale: the output is capped at however many source pixels
   * the frame actually covers, so a small photo stays small instead of
   * being blown up into a bigger, blurrier file.
   */
  function render(target) {
    var sourcePx = view.frame.w / view.scale;
    var outW = Math.max(1, Math.round(Math.min(target.w, sourcePx)));
    var outH = Math.round(outW * (target.h / target.w));

    var out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    var octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';

    var k = outW / view.frame.w;
    octx.translate(outW / 2, outH / 2);
    octx.scale(k, k);
    octx.translate(view.tx, view.ty);
    octx.rotate((view.rot * Math.PI) / 180);
    octx.scale(view.scale, view.scale);
    octx.drawImage(view.bitmap, -view.bitmap.width / 2, -view.bitmap.height / 2);

    return new Promise(function (resolve) {
      out.toBlob(function (blob) { resolve(blob); }, 'image/webp', target.q);
    });
  }

  /* =========================================================
     queue: crop each picked file, then upload it
     ========================================================= */

  function queue(files) {
    pending = pending.concat(files);
    if (pending.length === files.length) step();
  }

  function step() {
    if (!pending.length) return;
    if (items.length >= MAX) { pending = []; alert(D.msgLimit); return; }

    var file = pending.shift();
    openCrop(file, function (blobs) {
      if (blobs) upload(blobs);
      step();
    });
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
