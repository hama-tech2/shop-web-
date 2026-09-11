/** One delegated share handler, including cards appended after page load. */
(function () {
  'use strict';
  var notice, noticeTimer;
  var busy = new WeakSet();

  function announce(message) {
    if (!notice) {
      notice = document.createElement('p');
      notice.className = 'card-share-status';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      document.body.appendChild(notice);
    }
    clearTimeout(noticeTimer);
    notice.hidden = false;
    notice.textContent = message;
    noticeTimer = setTimeout(function () { notice.hidden = true; }, 2400);
  }

  async function copy(url) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      return true;
    } catch (_) {
      var box = document.createElement('textarea');
      var focused = document.activeElement;
      box.value = url;
      box.className = 'visually-hidden';
      box.readOnly = true;
      document.body.appendChild(box);
      box.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (_) { /* Show an honest failure. */ }
      box.remove();
      if (focused && focused.isConnected) focused.focus({ preventScroll: true });
      return copied;
    }
  }

  document.addEventListener('click', async function (event) {
    var button = event.target.closest && event.target.closest('[data-card-share]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (busy.has(button)) return;
    var url;
    try {
      url = new URL(button.dataset.cardShare, window.location.origin);
      if (url.origin !== window.location.origin || !/^\/@[^/]+\/p\/[^/]+$/.test(url.pathname)) return;
      url.search = ''; url.hash = '';
    } catch (_) { return; }
    busy.add(button);
    button.setAttribute('aria-busy', 'true');
    try {
      if (navigator.share) {
        try {
          await navigator.share({ url: url.href });
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
        }
      }
      announce(await copy(url.href) ? 'لینکی بەرهەم کۆپی کرا' : 'کۆپیکردن سەرکەوتوو نەبوو؛ تکایە دووبارە هەوڵ بدەوە');
    } finally {
      busy.delete(button);
      button.removeAttribute('aria-busy');
    }
  });
})();
