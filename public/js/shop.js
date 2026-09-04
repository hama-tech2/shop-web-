/** Public shop and product presentation enhancements. */
(function () {
  'use strict';
  function enhanceBio() {
    var bio = document.querySelector('.shop-bio');
    if (!bio || bio.dataset.enhanced) return;
    bio.dataset.enhanced = 'true';
    var toggle = bio.parentElement.querySelector('.shop-bio-toggle');
    bio.classList.add('shop-bio--compact');
    function measure() {
      if (toggle.getAttribute('aria-expanded') === 'false') toggle.hidden = bio.scrollHeight <= bio.clientHeight + 1;
    }
    toggle.addEventListener('click', function () {
      var expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'کەمتر' : 'زیاتر';
      bio.classList.toggle('shop-bio--compact', !expanded);
    });
    if (window.ResizeObserver) new ResizeObserver(measure).observe(bio);
    measure();
  }
  enhanceBio();
  document.addEventListener('shop:updated', enhanceBio);
  var rail = document.getElementById('pdp-carousel');
  var dots = document.getElementById('pdp-dots');
  if (rail && dots) {
    var marks = dots.querySelectorAll('.dot');
    var ticking = false;
    rail.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var index = Math.round(Math.abs(rail.scrollLeft) / rail.clientWidth);
        for (var k = 0; k < marks.length; k++) marks[k].classList.toggle('is-active', k === index);
        ticking = false;
      });
    }, { passive: true });
  }

  var status = document.querySelector('.share-status');
  function copied(button) {
    if (status) status.textContent = button.dataset.copied;
    button.classList.add('is-done');
    setTimeout(function () {
      button.classList.remove('is-done');
      if (status) status.textContent = '';
    }, 2000);
  }
  function fallbackCopy(button) {
    var box = document.createElement('textarea');
    var focused = document.activeElement;
    box.value = button.dataset.url;
    box.className = 'visually-hidden';
    document.body.appendChild(box);
    box.select();
    try {
      if (document.execCommand('copy')) copied(button);
      else if (status) status.textContent = 'کۆپیکردن سەرکەوتوو نەبوو';
    } catch (e) {
      if (status) status.textContent = 'کۆپیکردن سەرکەوتوو نەبوو';
    }
    box.remove();
    if (focused) focused.focus();
  }
  function copyUrl(button) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(button.dataset.url).then(function () { copied(button); }, function () { fallbackCopy(button); });
    } else fallbackCopy(button);
  }
  var copy = document.getElementById('shop-copy');
  if (copy) copy.addEventListener('click', function () { copyUrl(copy); });
  var share = document.getElementById('share-btn');
  if (share) share.addEventListener('click', function () {
    if (navigator.share) {
      navigator.share({ title: share.dataset.title || document.title, url: share.dataset.url }).catch(function (error) {
        if (error.name !== 'AbortError') copyUrl(share);
      });
    } else copyUrl(share);
  });
})();
