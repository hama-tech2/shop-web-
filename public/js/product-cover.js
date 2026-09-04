/* Product cover editing is local. Only the selected card variant is cropped. */
(function () {
  'use strict';
  var dialog = document.getElementById('cover-editor');
  if (!dialog) return;
  var stage = document.getElementById('cover-stage');
  var canvas = document.getElementById('cover-canvas');
  var ctx = canvas.getContext('2d');
  var zoom = document.getElementById('cover-zoom');
  var save = document.getElementById('cover-save');
  var status = document.getElementById('cover-message');
  var session, view, resolveOpen, token = 0, scheduled = false;
  var pointers = new Map(), pinchDistance = 0, pinchZoom = 1;
  function say(text) { status.textContent = text || ''; status.hidden = !text; }
  function frame() {
    var width = stage.clientWidth, height = stage.clientHeight;
    var w = Math.min(width * .86, height * .9 / view.ratio);
    return { x: (width - w) / 2, y: (height - w * view.ratio) / 2, w: w, h: w * view.ratio };
  }
  function geometry() {
    var f = frame(), turned = view.rotation % 180 !== 0;
    var w = turned ? view.bitmap.height : view.bitmap.width, h = turned ? view.bitmap.width : view.bitmap.height;
    var scale = Math.max(f.w / w, f.h / h) * view.zoom;
    view.x = Math.max(-(w * scale - f.w) / 2 / f.w, Math.min((w * scale - f.w) / 2 / f.w, view.x));
    view.y = Math.max(-(h * scale - f.h) / 2 / f.h, Math.min((h * scale - f.h) / 2 / f.h, view.y));
    return { frame: f, scale: scale };
  }
  function drawImage(context, middleX, middleY, scale, tx, ty) {
    context.save(); context.translate(middleX + tx, middleY + ty); context.rotate(view.rotation * Math.PI / 180); context.scale(scale, scale);
    context.drawImage(view.bitmap, -view.bitmap.width / 2, -view.bitmap.height / 2); context.restore();
  }
  function cropped(width) {
    var g = geometry(), f = g.frame;
    var out = document.createElement('canvas'); out.width = Math.max(1, Math.round(Math.min(width, f.w / g.scale))); out.height = Math.max(1, Math.round(out.width * view.ratio));
    var c = out.getContext('2d'), k = out.width / f.w; c.imageSmoothingQuality = 'high';
    drawImage(c, out.width / 2, out.height / 2, g.scale * k, view.x * f.w * k, view.y * f.h * k);
    return out;
  }
  function paint() {
    if (!view || !dialog.open) return;
    var g = geometry(), f = g.frame, sw = stage.clientWidth, sh = stage.clientHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.round(sw * dpr); canvas.height = Math.round(sh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, sw, sh);
    drawImage(ctx, sw / 2, sh / 2, g.scale, view.x * f.w, view.y * f.h);
    ctx.fillStyle = 'rgba(22,21,15,.28)';
    ctx.fillRect(0, 0, sw, f.y); ctx.fillRect(0, f.y + f.h, sw, sh - f.y - f.h);
    ctx.fillRect(0, f.y, f.x, f.h); ctx.fillRect(f.x + f.w, f.y, sw - f.x - f.w, f.h);
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.beginPath();
    for (var i = 1; i < 3; i++) { ctx.moveTo(f.x + f.w * i / 3, f.y); ctx.lineTo(f.x + f.w * i / 3, f.y + f.h); ctx.moveTo(f.x, f.y + f.h * i / 3); ctx.lineTo(f.x + f.w, f.y + f.h * i / 3); }
    ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath();
    [[f.x, f.y, 1, 1], [f.x + f.w, f.y, -1, 1], [f.x, f.y + f.h, 1, -1], [f.x + f.w, f.y + f.h, -1, -1]].forEach(function (p) { ctx.moveTo(p[0] + 16 * p[2], p[1]); ctx.lineTo(p[0], p[1]); ctx.lineTo(p[0], p[1] + 16 * p[3]); }); ctx.stroke();
    zoom.value = view.zoom; zoom.setAttribute('aria-valuetext', Math.round(view.zoom * 100) + '%');
    dialog.querySelectorAll('[name="cover-ratio"]').forEach(function (radio) { radio.checked = Number(radio.value) === view.ratio; });
    var item = session.items.find(function (entry) { return entry.id === view.id; });
    var preview = view.changed ? cropped(180).toDataURL('image/webp', .75) : item.preview;
    document.getElementById('cover-market-img').src = preview; document.getElementById('cover-shop-img').src = preview;
  }
  function repaint() { if (scheduled) return; scheduled = true; requestAnimationFrame(function () { scheduled = false; paint(); }); }
  function snapshot() { return { ratio: view.ratio, rotation: view.rotation, zoom: view.zoom, x: view.x, y: view.y }; }
  function remember() { if (view && session) session.drafts[view.id] = { state: snapshot(), changed: view.changed }; }
  async function select(id) {
    remember(); var mine = ++token; save.disabled = true; say('وێنەکە بار دەکرێت…');
    if (view) view.bitmap.close(); view = null; pointers.clear();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var item = session.items.find(function (entry) { return entry.id === id; });
    dialog.querySelectorAll('.cover-thumb').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.id === id)); });
    try {
      var bitmap = await createImageBitmap(await session.source(item));
      if (mine !== token || !dialog.open) { bitmap.close(); return; }
      var draft = session.drafts[id], state = (draft && draft.state) || item.cropState || { ratio: item.previewRatio > 1.1 ? 1.25 : 1, rotation: 0, zoom: 1, x: 0, y: 0 };
      view = Object.assign({ id: id, bitmap: bitmap, changed: !!(draft && draft.changed) }, state);
      say(''); save.disabled = false; paint();
    } catch (e) { if (mine === token) say('وێنەکە بار نەکرا؛ دووبارە هەڵیبژێرە.'); }
  }
  function change(fn) { if (!view || save.dataset.busy) return; fn(); view.changed = true; repaint(); }
  function setZoom(value) { change(function () { view.zoom = Math.max(1, Math.min(4, value)); }); }
  zoom.addEventListener('input', function () { setZoom(Number(zoom.value)); });
  document.getElementById('cover-plus').addEventListener('click', function () { if (view) setZoom(view.zoom + .1); });
  document.getElementById('cover-minus').addEventListener('click', function () { if (view) setZoom(view.zoom - .1); });
  document.getElementById('cover-right').addEventListener('click', function () { change(function () { view.rotation = (view.rotation + 90) % 360; view.x = view.y = 0; }); });
  document.getElementById('cover-left').addEventListener('click', function () { change(function () { view.rotation = (view.rotation + 270) % 360; view.x = view.y = 0; }); });
  document.getElementById('cover-reset').addEventListener('click', function () { change(function () { view.rotation = 0; view.zoom = 1; view.x = view.y = 0; }); });
  dialog.querySelectorAll('[name="cover-ratio"]').forEach(function (radio) { radio.addEventListener('change', function () { change(function () { view.ratio = Number(radio.value); view.zoom = 1; view.x = view.y = 0; }); }); });
  function spread() { var p = Array.from(pointers.values()); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
  stage.addEventListener('pointerdown', function (e) { if (!view) return; stage.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) { pinchDistance = spread(); pinchZoom = view.zoom; } });
  stage.addEventListener('pointermove', function (e) {
    if (!view || !pointers.has(e.pointerId)) return;
    var previous = pointers.get(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    change(function () {
      if (pointers.size === 1) { var f = frame(); view.x += (e.clientX - previous.x) / f.w; view.y += (e.clientY - previous.y) / f.h; }
      else if (pinchDistance) view.zoom = Math.max(1, Math.min(4, pinchZoom * spread() / pinchDistance));
    });
  });
  function release(e) { pointers.delete(e.pointerId); if (pointers.size < 2) pinchDistance = 0; }
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
  stage.addEventListener('keydown', function (e) {
    if (!view || !/^Arrow/.test(e.key)) return; e.preventDefault();
    change(function () { if (e.key === 'ArrowLeft') view.x -= .03; if (e.key === 'ArrowRight') view.x += .03; if (e.key === 'ArrowUp') view.y -= .03; if (e.key === 'ArrowDown') view.y += .03; });
  });
  new ResizeObserver(repaint).observe(stage);
  document.getElementById('cover-preview').addEventListener('click', function () { document.getElementById('cover-previews').focus(); });
  document.getElementById('cover-strip').addEventListener('click', function (e) { var button = e.target.closest('.cover-thumb'); if (button && !save.dataset.busy) select(button.dataset.id); });
  function finish(result) {
    token++; if (view) view.bitmap.close(); view = null; pointers.clear();
    var done = resolveOpen; resolveOpen = null; session = null;
    dialog.close(); delete save.dataset.busy; if (done) done(result);
  }
  document.getElementById('cover-cancel').addEventListener('click', function () { if (!save.dataset.busy) finish(null); });
  document.getElementById('cover-back').addEventListener('click', function () { if (!save.dataset.busy) finish(null); });
  dialog.addEventListener('cancel', function (e) { e.preventDefault(); if (!save.dataset.busy) finish(null); });
  save.addEventListener('click', function () {
    if (!view || save.dataset.busy) return; save.dataset.busy = '1'; save.disabled = true;
    var result = { id: view.id, state: snapshot(), changed: view.changed };
    if (!view.changed) { finish(result); return; }
    cropped(session.width).toBlob(function (blob) {
      if (!blob) { delete save.dataset.busy; save.disabled = false; say('پاشەکەوتکردنی کاڤەر سەرکەوتوو نەبوو.'); return; }
      result.blob = blob; finish(result);
    }, 'image/webp', session.quality);
  });
  window.ProductCover = { open: function (options) {
    if (dialog.open) return Promise.resolve(null);
    session = Object.assign({ drafts: {} }, options);
    var strip = document.getElementById('cover-strip'); strip.replaceChildren();
    options.items.forEach(function (item, index) { var button = document.createElement('button'); button.type = 'button'; button.className = 'cover-thumb'; button.dataset.id = item.id; button.setAttribute('aria-label', 'کاڤەر: وێنەی ' + (index + 1)); var img = document.createElement('img'); img.src = item.preview; img.alt = ''; button.appendChild(img); strip.appendChild(button); });
    dialog.querySelectorAll('.cover-preview-title').forEach(function (el) { el.textContent = options.title || 'ناوی بەرهەم'; });
    dialog.querySelectorAll('.cover-preview-price').forEach(function (el) { el.textContent = options.price ? options.price + ' د.ع' : ''; });
    return new Promise(function (resolve) { resolveOpen = resolve; dialog.showModal(); dialog.scrollTop = 0; select(options.id); });
  } };
})();
