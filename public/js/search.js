/* Search enhancements use existing public HTML endpoints only. */
(function () {
  'use strict';
  var page = document.querySelector('.page--search');
  if (!page) return;
  var field = document.getElementById('search-query');
  var box = page.querySelector('.srch-box');
  var list = document.getElementById('search-suggestions');
  var clear = box.querySelector('.search__clear');
  var timer, controller, revision = 0, composing = false;
  function closeSuggestions() {
    revision++; clearTimeout(timer);
    if (controller) controller.abort();
    list.hidden = true; list.replaceChildren();
  }
  function localPath(raw, prefix) {
    if (!raw) return null;
    var url = new URL(raw, location.origin);
    return url.origin === location.origin && url.pathname.startsWith(prefix) ? url.pathname + url.search : null;
  }
  function queueSuggestions() {
    closeSuggestions(); clear.hidden = !field.value;
    var query = field.value.trim();
    if (composing || query.length < 2) return;
    var mine = revision;
    timer = setTimeout(async function () {
      controller = new AbortController();
      var request = controller;
      var timeout = setTimeout(function () { request.abort(); }, 8000);
      try {
        var response = await fetch('/api/feed?q=' + encodeURIComponent(query), { signal: request.signal, credentials: 'same-origin' });
        if (!response.ok) return;
        var doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (mine !== revision) return;
        var fragment = document.createDocumentFragment();
        Array.from(doc.querySelectorAll('.card')).slice(0, 6).forEach(function (card) {
          var hit = card.querySelector('.card__hit');
          var href = localPath(hit && hit.getAttribute('href'), '/@');
          if (!href) return;
          var row = document.createElement('li'), link = document.createElement('a');
          link.href = href; link.className = 'srch-suggestion';
          var source = card.querySelector('.card__img[src]');
          var src = localPath(source && source.getAttribute('src'), '/img/');
          if (src) { var img = document.createElement('img'); img.src = src; img.alt = ''; img.width = img.height = 44; link.appendChild(img); }
          var body = document.createElement('span'); body.className = 'srch-suggestion__body';
          ['card__title', 'card__price', 'card__shop-name'].forEach(function (name) {
            var text = card.querySelector('.' + name); if (!text) return;
            var line = document.createElement('span'); line.className = 'srch-suggestion__' + name;
            // Text nodes preserve the server's single currency, never calculate a second price.
            line.textContent = name === 'card__price' ? Array.from(text.children).map(function (part) { return part.textContent; }).join(' ') : text.textContent;
            body.appendChild(line);
          });
          link.appendChild(body); row.appendChild(link); fragment.appendChild(row);
        });
        list.replaceChildren(fragment); list.hidden = !list.children.length;
      } catch (e) { /* The normal search form remains usable offline or on failure. */ }
      finally { clearTimeout(timeout); }
    }, 250);
  }
  field.addEventListener('compositionstart', function () { composing = true; closeSuggestions(); });
  field.addEventListener('compositionend', function () { composing = false; queueSuggestions(); });
  field.addEventListener('input', queueSuggestions);
  box.querySelector('form').addEventListener('submit', closeSuggestions);
  box.addEventListener('focusout', function (e) { if (!box.contains(e.relatedTarget)) closeSuggestions(); });
  box.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSuggestions(); field.focus(); return; }
    if (list.hidden || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    var links = Array.from(list.querySelectorAll('a')), index = links.indexOf(document.activeElement);
    e.preventDefault();
    if (e.key === 'ArrowDown') links[(index + 1) % links.length].focus();
    else if (index <= 0) field.focus(); else links[index - 1].focus();
  });

  // Search has no recent-image payload. Reuse real covers in the shop's public
  // display order, without pretending that order is newest-first. Two requests
  // at a time, and only for shop rows close to the viewport.
  var waiting = [], active = 0;
  async function preview(row) {
    var request = new AbortController();
    var timeout = setTimeout(function () { request.abort(); }, 8000);
    try {
      var response = await fetch(row.getAttribute('href'), { signal: request.signal, credentials: 'same-origin' });
      if (!response.ok) return;
      var doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      var sources = Array.from(doc.querySelectorAll('.shop-products .card')).map(function (card) {
        var img = card.querySelector('.card__img[src]'); return localPath(img && img.getAttribute('src'), '/img/');
      }).filter(Boolean).slice(0, 3);
      var images = await Promise.all(sources.map(function (src) {
        return new Promise(function (resolve) {
          var image = new Image(52, 52), finished = false;
          var imageTimeout = setTimeout(function () { finish(null); }, 8000);
          function finish(value) { if (finished) return; finished = true; clearTimeout(imageTimeout); resolve(value); }
          image.alt = ''; image.decoding = 'async'; image.onload = function () { finish(image); }; image.onerror = function () { finish(null); }; image.src = src;
        });
      }));
      var target = row.querySelector('.srch-shop__previews');
      images.filter(Boolean).forEach(function (image) { target.appendChild(image); });
      target.hidden = !target.children.length;
    } catch (e) { /* A shop row is still a complete, working link without previews. */ }
    finally { clearTimeout(timeout); }
  }
  function drain() {
    while (active < 2 && waiting.length) {
      active++;
      preview(waiting.shift()).finally(function () { active--; drain(); });
    }
  }
  var rows = page.querySelectorAll('.srch-shop[data-preview="true"]');
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) { observer.unobserve(entry.target); waiting.push(entry.target); } }); drain();
    }, { rootMargin: '100px' });
    rows.forEach(function (row) { observer.observe(row); });
  } else { waiting = Array.from(rows); drain(); }
})();
