/** QR generation stays on this device; only the canonical public URL is encoded. */
(function () {
  'use strict';
  var page = document.getElementById('shop-qr');
  if (!page) return;
  var canvas = document.getElementById('shop-qr-canvas');
  var download = document.getElementById('qr-download');
  var status = document.getElementById('qr-status');
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) location.reload(); // Re-read the owned slug after Back/BFCache.
  });
  try {
    var url = new URL(page.dataset.url);
    if (url.origin !== 'https://bazarnow.xyz' || url.search || url.hash || url.username || url.password ||
        !/^\/@[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(url.pathname)) throw new Error('Invalid public shop URL');
    var qr = qrcode(0, 'M');
    qr.addData(url.href, 'Byte');
    qr.make();
    var modules = qr.getModuleCount();
    var quiet = 4; // Four full white modules on every side, never cropped.
    var cell = Math.ceil(1200 / (modules + quiet * 2));
    canvas.width = canvas.height = (modules + quiet * 2) * cell;
    var context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    for (var row = 0; row < modules; row++) {
      for (var col = 0; col < modules; col++) {
        if (qr.isDark(row, col)) context.fillRect((col + quiet) * cell, (row + quiet) * cell, cell, cell);
      }
    }
    canvas.hidden = false;
    download.disabled = false;
  } catch (_) {
    status.textContent = page.dataset.error;
    return; // Copy and Share still work when QR generation is unavailable.
  }
  download.addEventListener('click', function () {
    download.disabled = true;
    status.textContent = '';
    function fail() { status.textContent = page.dataset.downloadError; download.disabled = false; }
    try {
      canvas.toBlob(function (blob) {
        if (!blob) return fail();
        var objectUrl;
        var link = document.createElement('a');
        try {
          objectUrl = URL.createObjectURL(blob);
          link.href = objectUrl;
          link.download = 'bazaro-' + page.dataset.slug + '-qr.png';
          document.body.appendChild(link);
          link.click();
          status.textContent = page.dataset.downloaded;
        } catch (_) { fail(); }
        finally {
          link.remove();
          download.disabled = false;
          // Allow mobile browsers time to consume the download before revoking.
          if (objectUrl) setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 60000);
        }
      }, 'image/png');
    } catch (_) { fail(); }
  });
})();
