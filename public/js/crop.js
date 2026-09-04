/**
 * Shop Web — the crop sheet.
 *
 * Drag, pinch and rotate over a fixed-ratio frame, then re-encode to
 * WebP at one or more sizes. Shared by the product form (4:5) and the
 * profile page (8:3 banner, 1:1 logo), which is why the ratio and the
 * output sizes are arguments rather than constants.
 *
 * Never upscales: the output is capped at however many source pixels
 * the frame actually covers.
 */
(function () {
  'use strict';

  var crop, stage, canvas, frameEl, ctx;
  var view = null;
  var onDone = null;
  var ready = false;
  var saving = false;
  var opener, previousOverflow;

  function grab() {
    if (ready) return true;
    crop = document.getElementById('crop');
    stage = document.getElementById('crop-stage');
    canvas = document.getElementById('crop-canvas');
    if (!crop || !stage || !canvas) return false;
    frameEl = crop.querySelector('.crop__frame');
    ctx = canvas.getContext('2d');
    wire();
    ready = true;
    return true;
  }

  /* ---------- geometry ---------- */

  function frameRect(ratio) {
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var w = Math.min(sw * 0.86, (sh * 0.86) / ratio);
    return { w: w, h: w * ratio, cx: sw / 2, cy: sh / 2 };
  }

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

  /* ---------- painting ---------- */

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

    guides();

    frameEl.style.width = view.frame.w + 'px';
    frameEl.style.height = view.frame.h + 'px';
  }

  /** Thirds and corner brackets, drawn here so they match to the pixel. */
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

    var arm = Math.min(26, f.w / 5, f.h / 5);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    [[x, y, 1, 1], [x + f.w, y, -1, 1], [x, y + f.h, 1, -1], [x + f.w, y + f.h, -1, -1]]
      .forEach(function (c) {
        ctx.moveTo(c[0] + arm * c[2], c[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(c[0], c[1] + arm * c[3]);
      });
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- gestures ---------- */

  var pointers = new Map();
  var pinchStart = 0;
  var scaleStart = 1;

  function spread() {
    var p = Array.from(pointers.values());
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  function wire() {
    stage.addEventListener('pointerdown', function (e) {
      if (!view || saving) return;
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { pinchStart = spread(); scaleStart = view.scale; }
    });

    stage.addEventListener('pointermove', function (e) {
      if (!view || saving || !pointers.has(e.pointerId)) return;
      var prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1) {
        view.tx += e.clientX - prev.x;
        view.ty += e.clientY - prev.y;
      } else if (pointers.size === 2 && pinchStart > 0) {
        view.scale = Math.max(minScale(),
          Math.min(8 * minScale(), scaleStart * (spread() / pinchStart)));
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

    document.getElementById('crop-rotate').addEventListener('click', function () {
      if (!view) return;
      view.rot = (view.rot + 90) % 360;
      view.scale = Math.max(view.scale, minScale());
      view.tx = 0; view.ty = 0;
      clamp();
      paint();
    });

    document.getElementById('crop-cancel').addEventListener('click', function () {
      if (saving) return;
      var done = onDone;
      close();
      if (done) done(null);
    });

    document.getElementById('crop-done').addEventListener('click', async function () {
      if (!view || saving) return;
      saving = true;
      crop.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
      var done = onDone;
      var out = {};
      try {
        for (var i = 0; i < view.targets.length; i++) {
          var t = view.targets[i];
          out[t.key] = await render(t);
          if (!out[t.key]) throw new Error('Image encoding failed');
        }
      } catch (error) {
        out = null;
        alert('ئامادەکردنی وێنەکە سەرکەوتوو نەبوو. تکایە دووبارە هەوڵ بدەوە.');
      }
      close();
      if (done) done(out);
    });

    document.addEventListener('keydown', function (event) {
      if (crop.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        document.getElementById('crop-cancel').click();
      } else if (event.key === 'Tab') {
        var items = Array.from(crop.querySelectorAll('button:not(:disabled),[tabindex="0"]'));
        var index = items.indexOf(document.activeElement);
        if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
          event.preventDefault();
          items[event.shiftKey ? items.length - 1 : 0].focus();
        }
      }
    });
    stage.addEventListener('keydown', function (event) {
      if (!view || saving) return;
      var moves = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
      var move = moves[event.key];
      if (move) { view.tx += move[0]; view.ty += move[1]; }
      else if (event.key === '+' || event.key === '=' || event.key === '-') {
        view.scale = Math.max(minScale(), Math.min(8 * minScale(), view.scale * (event.key === '-' ? 0.9 : 1.1)));
      } else return;
      event.preventDefault();
      clamp();
      paint();
    });
    window.addEventListener('resize', function () {
      if (!view || saving) return;
      var previous = view.frame;
      view.frame = frameRect(view.ratio);
      var factor = view.frame.w / previous.w;
      view.scale *= factor;
      view.tx *= factor;
      view.ty *= factor;
      clamp();
      paint();
    });
  }

  function close() {
    crop.hidden = true;
    if (view && view.bitmap.close) view.bitmap.close();
    view = null;
    onDone = null;
    saving = false;
    crop.querySelectorAll('button').forEach(function (button) { button.disabled = false; });
    document.body.style.overflow = previousOverflow;
    pointers.clear();
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }

  function render(target) {
    var sourcePx = view.frame.w / view.scale;
    var outW = Math.max(1, Math.round(Math.min(target.w, sourcePx)));
    var outH = Math.max(1, Math.round(outW * view.ratio));

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

  /**
   * open(file, { ratio, targets }, done)
   *   ratio   height / width of the crop frame (1.25 = 4:5, 0.375 = 8:3)
   *   targets [{ key, w, q }] — output sizes, height derived from ratio
   *   done    receives { key: Blob } or null if cancelled
   */
  async function open(file, opts, done) {
    if (!grab()) { done(null); return; }

    var bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (e) {
      alert('وێنەکە ناکرێتەوە. تکایە وێنەیەکی تر هەڵبژێرە.');
      done(null);
      return;
    }

    opener = document.activeElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    crop.hidden = false;
    var ratio = opts.ratio || 1;
    view = {
      bitmap: bitmap, ratio: ratio, targets: opts.targets,
      frame: frameRect(ratio), rot: 0, tx: 0, ty: 0, scale: 1,
    };
    view.scale = minScale();
    onDone = done;
    paint();
    document.getElementById('crop-cancel').focus();
  }

  window.ShopCrop = { open: open };
})();
