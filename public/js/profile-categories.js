/** Embed the existing authenticated category forms without leaving unsaved profile fields. */
(function () {
  'use strict';
  var host = document.getElementById('profile-category-content');
  if (!host) return;
  var status = document.getElementById('category-status');
  var profile = document.getElementById('profile-form');
  var busy = false;
  var failure = 'گۆڕانکارییەکە پاشەکەوت نەکرا. تکایە دووبارە هەوڵ بدەوە.';

  function render(doc) {
    var content = document.createDocumentFragment();
    var list = document.createElement('div');
    list.className = 'profile-category-chips';
    doc.querySelectorAll('.cat-row').forEach(function (source) {
      var entry = document.createElement('details');
      entry.className = 'profile-category';
      var summary = document.createElement('summary');
      summary.textContent = source.querySelector('[name="name"]').value;
      var row = document.createElement('div');
      row.className = 'cat-row';
      row.append.apply(row, Array.from(source.childNodes));
      var rename = row.querySelector('.cat-row__rename');
      var save = document.createElement('button');
      save.type = 'submit';
      save.className = 'category-rename-save';
      save.textContent = 'پاشەکەوتکردن';
      rename.appendChild(save);
      row.querySelectorAll('form').forEach(function (form) { form.removeAttribute('onsubmit'); });
      entry.append(summary, row);
      entry.addEventListener('toggle', function () {
        if (entry.open) list.querySelectorAll('details').forEach(function (other) { if (other !== entry) other.open = false; });
      });
      list.appendChild(entry);
    });
    content.appendChild(list);
    var add = doc.querySelector('.cat-add');
    if (add) content.appendChild(add);
    else {
      var limit = doc.querySelector('.alert--error');
      if (limit) content.appendChild(limit);
    }
    host.replaceChildren(content);
  }

  async function read(response) {
    var url = new URL(response.url);
    if (!response.ok || url.pathname !== '/app/categories') throw new Error(failure);
    var doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (!doc.querySelector('.edit-head__count')) throw new Error(failure);
    if (url.searchParams.has('e')) throw new Error(doc.querySelector('.alert--error')?.textContent || failure);
    return doc;
  }

  async function load() {
    host.setAttribute('aria-busy', 'true');
    try {
      render(await read(await fetch('/app/categories', { credentials: 'same-origin', cache: 'no-store' })));
      status.textContent = '';
      if (location.hash === '#shop-categories') document.getElementById('shop-categories').scrollIntoView();
    } catch (error) {
      status.textContent = failure;
      if (!host.querySelector('.category-retry')) {
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'category-retry';
        retry.textContent = 'دووبارە هەوڵ بدەوە';
        retry.addEventListener('click', load);
        host.prepend(retry);
      }
    } finally { host.removeAttribute('aria-busy'); }
  }

  host.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy) return;
    var form = event.target;
    if (form.action.endsWith('/delete') && !window.confirm('ئەم بەشە بسڕدرێتەوە؟ بەرهەمەکانی ناسڕدرێنەوە.')) return;
    var body = new URLSearchParams(new FormData(form));
    busy = true;
    host.setAttribute('aria-busy', 'true');
    status.textContent = 'پاشەکەوت دەکرێت…';
    var controls = Array.from(host.querySelectorAll('button,input')).filter(function (el) { return !el.disabled; });
    controls.forEach(function (el) { el.disabled = true; });
    try {
      var doc = await read(await fetch(form.action, { method: 'POST', credentials: 'same-origin', body: body }));
      render(doc);
      status.textContent = 'بەشەکان پاشەکەوت کران.';
      var focus = host.querySelector('.cat-add input') || host.querySelector('summary');
      if (focus) focus.focus({ preventScroll: true });
    } catch (error) { status.textContent = error.message || failure; }
    finally {
      controls.forEach(function (el) { el.disabled = false; });
      busy = false;
      host.removeAttribute('aria-busy');
    }
  });
  profile.addEventListener('submit', function (event) {
    if (busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
      status.textContent = 'تکایە چاوەڕێی پاشەکەوتکردنی بەشەکان بکە.';
    }
  }, true);
  load();
})();
