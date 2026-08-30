/**
 * Shop Web — the public shop page and product page.
 *
 * Both pages are complete before this runs. The carousel already swipes
 * (CSS scroll-snap) and every link already works. This only adds the
 * dots, the share sheet and the heart.
 */
(function () {
  'use strict';

  /* ---------- carousel dots ---------- */

  var rail = document.getElementById('pdp-carousel');
  var dots = document.getElementById('pdp-dots');

  if (rail && dots) {
    var marks = dots.querySelectorAll('.dot');
    var ticking = false;

    rail.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      // One read per frame: scroll fires far too often to touch layout
      // on every event, and this runs on cheap phones.
      requestAnimationFrame(function () {
        var i = Math.round(Math.abs(rail.scrollLeft) / rail.clientWidth);
        for (var k = 0; k < marks.length; k++) {
          marks[k].classList.toggle('is-active', k === i);
        }
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---------- share ---------- */

  var share = document.getElementById('share-btn');
  if (share) {
    share.addEventListener('click', function () {
      var url = share.dataset.url;
      var title = share.dataset.title || document.title;

      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
        return;
      }

      var done = function () {
        var label = share.getAttribute('aria-label');
        share.setAttribute('aria-label', share.dataset.copied || 'ok');
        share.classList.add('is-done');
        setTimeout(function () {
          share.setAttribute('aria-label', label);
          share.classList.remove('is-done');
        }, 1600);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () {});
      } else {
        var box = document.createElement('textarea');
        box.value = url;
        document.body.appendChild(box);
        box.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(box);
      }
    });
  }

  /* ---------- hearts — visual only until favourites are wired up ---------- */

  document.addEventListener('click', function (event) {
    var heart = event.target.closest && event.target.closest('.card__heart, #pdp-heart');
    if (!heart) return;
    event.preventDefault();
    heart.setAttribute(
      'aria-pressed',
      heart.getAttribute('aria-pressed') === 'true' ? 'false' : 'true',
    );
  });
})();
