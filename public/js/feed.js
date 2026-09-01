/**
 * Shop Web — feed behaviour.
 *
 * Everything above this line is already on screen without JavaScript.
 * This file only adds: auto-slide on multi-image cards, append-in-place
 * load more, the language sheet, and the heart toggle.
 *
 * Budget notes, because this runs on cheap Android phones:
 *   - ONE IntersectionObserver for every card, not one each
 *   - ONE interval for every visible card, created only while at least
 *     one is visible and cleared the moment none are
 *   - a tick toggles two classes; it never reads layout, so nothing
 *     forces a reflow
 *   - images beyond the first are given a src only when their card is
 *     fully on screen, so scrolling past a card costs no decode
 */
(function () {
  'use strict';

  var page = document.querySelector('.page');
  var SLIDE_MS = (page && Number(page.dataset.slideMs)) || 4000;

  var reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------
     auto-slide
     --------------------------------------------------------- */

  var visible = new Set();
  var timer = null;
  var observer = null;

  function hydrate(media) {
    if (media.dataset.hydrated) return;
    media.dataset.hydrated = '1';
    var imgs = media.querySelectorAll('.card__img[data-src]');
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].src = imgs[i].dataset.src;
      imgs[i].removeAttribute('data-src');
    }
  }

  function advance(media) {
    var imgs = media.querySelectorAll('.card__img');
    var dots = media.querySelectorAll('.dot');
    if (imgs.length < 2) return;

    var current = Number(media.dataset.index || 0);
    var next = (current + 1) % imgs.length;

    imgs[current].classList.remove('is-active');
    imgs[next].classList.add('is-active');
    if (dots.length) {
      dots[current].classList.remove('is-active');
      dots[next].classList.add('is-active');
    }
    media.dataset.index = String(next);
  }

  function tick() {
    visible.forEach(advance);
  }

  function sync() {
    var shouldRun = visible.size > 0 && !document.hidden;
    if (shouldRun && !timer) timer = setInterval(tick, SLIDE_MS);
    else if (!shouldRun && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function observe(root) {
    if (!observer) return;
    var list = root.querySelectorAll('.card__media[data-multi]');
    for (var i = 0; i < list.length; i++) observer.observe(list[i]);
  }

  if (!reduceMotion && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          // "fully visible" — the card must be entirely on screen
          if (e.isIntersecting && e.intersectionRatio >= 0.99) {
            hydrate(e.target);
            visible.add(e.target);
          } else {
            visible.delete(e.target);
          }
        }
        sync();
      },
      { threshold: [0, 0.99, 1] },
    );

    observe(document);
    document.addEventListener('visibilitychange', sync);
  }

  /* ---------------------------------------------------------
     load more — append in place, keep the URL honest
     --------------------------------------------------------- */

  document.addEventListener('click', function (event) {
    var btn = event.target.closest && event.target.closest('#load-more');
    if (!btn || btn.dataset.busy) return;

    event.preventDefault();
    btn.dataset.busy = '1';
    var label = btn.textContent;
    btn.textContent = btn.dataset.loadingLabel || '…';

    var params = new URLSearchParams(window.location.search);
    params.set('offset', btn.dataset.offset);

    fetch('/api/feed?' + params.toString(), { headers: { accept: 'text/html' } })
      .then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res.text().then(function (markup) {
          var grid = document.getElementById('grid');
          if (grid && markup.trim()) {
            var holder = document.createElement('div');
            holder.innerHTML = markup;
            while (holder.firstChild) grid.appendChild(holder.firstChild);
            observe(grid);
          }

          if (res.headers.get('x-has-more') === '1') {
            btn.dataset.offset = res.headers.get('x-next-offset');
            params.set('offset', btn.dataset.offset);
            btn.setAttribute('href', '/?' + params.toString());
            btn.textContent = label;
            delete btn.dataset.busy;
          } else {
            var wrap = btn.closest('.load-more-wrap');
            if (wrap) wrap.remove();
          }
        });
      })
      .catch(function () {
        // fall back to the plain link the button already is
        window.location.href = btn.getAttribute('href');
      });
  });

  /* ---------------------------------------------------------
     language sheet
     --------------------------------------------------------- */

  var langBtn = document.getElementById('lang-btn');
  var sheet = document.getElementById('lang-sheet');
  var scrim = document.getElementById('sheet-scrim');

  function openSheet(open) {
    if (!sheet || !scrim) return;
    if (open) {
      sheet.hidden = false;
      scrim.hidden = false;
      // next frame, so the transform transition actually runs
      requestAnimationFrame(function () {
        sheet.dataset.open = 'true';
        scrim.dataset.open = 'true';
      });
    } else {
      delete sheet.dataset.open;
      delete scrim.dataset.open;
      setTimeout(function () {
        sheet.hidden = true;
        scrim.hidden = true;
      }, 320);
    }
  }

  if (langBtn) langBtn.addEventListener('click', function () { openSheet(true); });
  if (scrim) scrim.addEventListener('click', function () { openSheet(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') openSheet(false);
  });
  if (sheet) {
    sheet.addEventListener('click', function (e) {
      var opt = e.target.closest && e.target.closest('.lang');
      // Only Kurdish is wired up; the others are placeholders and disabled.
      if (opt && !opt.disabled) openSheet(false);
    });
  }

  /* Hearts live in /js/favorites.js — it owns both the toggle and the
     storage, so there is exactly one place that decides what is saved. */
})();
