/**
 * Shop Web — profile, categories and subscription.
 *
 * All three work without JavaScript: every field is in a form that
 * posts, every category action is its own form, and the plan cards fall
 * back to the first plan. This adds the banner and logo crop-and-upload,
 * the bio counter, copy-to-clipboard, and plan selection.
 */
(function () {
  'use strict';

  /* =========================================================
     copy the shop link
     ========================================================= */

  var copy = document.getElementById('copy-link');
  if (copy) {
    var copyLabel = copy.textContent;
    var copyTimer;
    copy.addEventListener('click', function () {
      var target = document.getElementById('shop-url');
      if (!target) return;
      var text = target.textContent.trim();
      var done = function () {
        clearTimeout(copyTimer);
        copy.textContent = copy.dataset.copied || 'ok';
        copyTimer = setTimeout(function () { copy.textContent = copyLabel; }, 1600);
      };
      function fallback() {
        var box = document.createElement('textarea');
        box.className = 'visually-hidden';
        box.value = text;
        document.body.appendChild(box);
        box.select();
        try {
          if (document.execCommand('copy')) done();
          else copy.textContent = 'لینکەکە هەڵبژێرە و کۆپی بکە';
        } catch (e) { copy.textContent = 'لینکەکە هەڵبژێرە و کۆپی بکە'; }
        document.body.removeChild(box);
        copy.focus();
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    });
  }

  /* =========================================================
     bio counter
     ========================================================= */

  var bio = document.getElementById('f-bio');
  var bioCount = document.getElementById('bio-count');
  if (bio && bioCount) {
    var max = Number(bio.dataset.max) || 120;
    bio.addEventListener('input', function () {
      bioCount.textContent = bio.value.length + '/' + max;
    });
  }

  /* =========================================================
     banner and logo: crop, resize, upload
     ========================================================= */

  var form = document.getElementById('profile-form');
  if (form && window.ShopCrop) {
    var D = form.dataset;
    var uploads = 0;
    var save = document.getElementById('save-btn');
    var imageStatus = document.getElementById('profile-image-status');

    var slots = {
      banner: {
        input: document.getElementById('banner-input'),
        btn: document.getElementById('banner-btn'),
        preview: document.getElementById('banner-preview'),
        field: document.getElementById('cover-key'),
        ratio: Number(D.bannerRatio),
        w: Number(D.bannerW),
        q: Number(D.bannerQ),
      },
      logo: {
        input: document.getElementById('logo-input'),
        btn: document.getElementById('logo-btn'),
        preview: document.getElementById('logo-preview'),
        field: document.getElementById('logo-key'),
        ratio: Number(D.logoRatio),
        w: Number(D.logoW),
        q: Number(D.logoQ),
      },
    };

    Object.keys(slots).forEach(function (kind) {
      var slot = slots[kind];
      if (!slot.input || !slot.btn) return;

      slot.btn.addEventListener('click', function () {
        slot.input.value = '';
        slot.input.click();
      });

      slot.input.addEventListener('change', function () {
        var file = slot.input.files && slot.input.files[0];
        if (!file) return;

        window.ShopCrop.open(
          file,
          { ratio: slot.ratio, targets: [{ key: 'image', w: slot.w, q: slot.q }] },
          function (blobs) {
            if (!blobs) {
              if (!/^image\/(jpeg|png|webp)$/.test(file.type)) alert(D.msgType);
              return;
            }
            send(kind, slot, blobs.image);
          },
        );
      });
    });

    function send(kind, slot, blob) {
      var body = new FormData();
      body.append('kind', kind);
      body.append('image', blob, kind + '.webp');

      slot.btn.disabled = true;
      uploads++;
      if (save) save.disabled = true;
      if (imageStatus) imageStatus.textContent = 'وێنەکە بار دەکرێت…';

      fetch('/app/profile/image', { method: 'POST', body: body })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (data) {
          slot.field.value = data.key;
          // Swap a placeholder <span> for a real <img> the first time.
          if (slot.preview.tagName !== 'IMG') {
            var img = document.createElement('img');
            img.className = slot.preview.className.replace(/\s+\S+--empty/g, '');
            img.id = slot.preview.id;
            img.alt = '';
            slot.preview.replaceWith(img);
            slot.preview = img;
          }
          slot.preview.src = data.url + '?v=' + Date.now();
          if (imageStatus) imageStatus.textContent = 'وێنەکە ئامادەیە. بۆ جێگیرکردن پاشەکەوت بکە.';
        })
        .catch(function () {
          if (imageStatus) imageStatus.textContent = D.msgImage;
          else alert(D.msgImage);
        })
        .finally(function () {
          slot.btn.disabled = false;
          uploads--;
          if (save) save.disabled = uploads > 0;
        });
    }

    form.addEventListener('submit', function (event) {
      if (event.defaultPrevented) return;
      if (uploads) { event.preventDefault(); return; }
      if (save) { save.disabled = true; save.textContent = save.dataset.saving; }
    });
  }

  /* =========================================================
     plan cards
     ========================================================= */

  var planForm = document.getElementById('plan-form');
  if (planForm) {
    var planField = document.getElementById('plan-field');
    planForm.addEventListener('click', function (e) {
      var card = e.target.closest && e.target.closest('.plan');
      if (!card) return;
      var all = planForm.querySelectorAll('.plan');
      for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
      card.setAttribute('aria-pressed', 'true');
      planField.value = card.dataset.plan;
    });
  }
})();
