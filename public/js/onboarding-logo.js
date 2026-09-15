/**
 * Shop Web — the logo step of onboarding, with the cropper.
 *
 * This is not a cropper. It is twenty lines of wiring between the file
 * input on /onboarding/logo and window.ShopCrop, which is the same
 * cropper /app/profile has always used for the same image, with the
 * same settings read from the same place.
 *
 * Before this, the step posted whatever came out of the file picker.
 * A phone camera hands back a rectangle two thousand pixels wide, so
 * the seller's logo was squashed into a square by the browser with no
 * say in which part survived — while the very same seller editing that
 * logo later, from the profile screen, got to place it.
 *
 * The form still posts to /onboarding/logo as a multipart upload. What
 * changes is only which bytes are in it: a 400×400 WebP the seller
 * framed, instead of the original file. Every server-side check —
 * session, shop, type, size, the R2 key prefix — runs exactly as it
 * did, because none of them can tell it was cropped.
 */
(function () {
  'use strict';

  var form = document.getElementById('logo-form');
  var input = document.getElementById('f-logo');
  var preview = document.getElementById('logo-preview');
  if (!form || !input) return;

  // No cropper, no interception. The step keeps working exactly as it
  // did rather than leaving the seller with a picker that does nothing.
  if (!window.ShopCrop || typeof DataTransfer === 'undefined') return;

  var D = form.dataset;
  var busy = false;

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (!file || busy) return;

    // The picked file is not what gets sent, so let go of it now. If the
    // seller cancels, the input is already empty and nothing uploads.
    input.value = '';

    busy = true;
    window.ShopCrop.open(
      file,
      {
        ratio: Number(D.logoRatio),
        targets: [{ key: 'image', w: Number(D.logoW), q: Number(D.logoQ) }],
      },
      function (blobs) {
        busy = false;

        // Cancelled, or a file the cropper could not decode. Back to the
        // logo screen with nothing uploaded and nothing changed; only a
        // file that is not an image at all is worth a word about it.
        if (!blobs || !blobs.image) {
          if (!/^image\/(jpeg|png|webp)$/.test(file.type) && D.msgType) alert(D.msgType);
          return;
        }

        // Hand the cropped bytes back to the same input the form already
        // posts, so the request the server sees is the one it has always
        // seen. A File rather than a Blob: multipart needs the filename,
        // and the extension has to match the type the server maps.
        var cropped = new File([blobs.image], 'logo.webp', { type: 'image/webp' });
        var box = new DataTransfer();
        box.items.add(cropped);
        input.files = box.files;

        // Shown for the moment before the post lands. On a slow phone
        // that moment is long enough to be worth filling with the logo
        // they just framed rather than the empty placeholder.
        if (preview) {
          preview.src = URL.createObjectURL(blobs.image);
          preview.hidden = false;
        }

        // Confirming the crop is the seller saying yes to this logo.
        // Making them find Finish afterwards is a second confirmation of
        // the same decision, on the screen where they are least likely
        // to be looking for one.
        if (form.requestSubmit) form.requestSubmit();
        else form.submit();
      },
    );
  });
}());
