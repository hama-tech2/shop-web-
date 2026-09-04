/** Public shop and product presentation enhancements. */
(function () {
  'use strict';
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
