/** Reuse the public, visibility-filtered grid inside the authenticated profile. */
(function () {
  'use strict';
  var target = document.getElementById('owner-products');
  if (!target) return;
  var T = {};
  try { T = JSON.parse(target.dataset.catUi || '{}'); } catch (e) { T = {}; }

  function load() {
    var url = new URL(target.dataset.shopUrl, window.location.origin);
    var category = new URLSearchParams(window.location.search).get('category');
    if (category) url.searchParams.set('category', category);
    target.setAttribute('aria-busy', 'true');
    return fetch(url.pathname + url.search, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('Shop preview unavailable');
        return response.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var products = doc.querySelector('.page--shop .shop-products');
        if (!products) throw new Error('Shop preview unavailable');
        // The owner route supplies only basic identity fields. Complete the
        // presentation from the public header without changing its SSR guard.
        var header = document.querySelector('.page--owner .shop-head');
        ['.shop-banner__img', '.shop-logo', '.shop-id', '.shop-actions'].forEach(function (selector) {
          var content = doc.querySelector('.shop-head ' + selector);
          var current = header.querySelector(selector);
          if (content && current) current.replaceWith(content);
        });
        var bio = doc.querySelector('.shop-about');
        if (bio) {
          var existingBio = header.querySelector('.shop-about');
          if (existingBio) existingBio.replaceWith(bio);
          else header.insertBefore(bio, header.querySelector('.owner-controls'));
        }
        products.querySelectorAll('.chip').forEach(function (chip) {
          var link = new URL(chip.getAttribute('href'), window.location.origin);
          chip.setAttribute('href', '/app' + link.search);
        });
        target.replaceChildren.apply(target, Array.from(products.childNodes));
        installCategoryEditing(target.querySelector('.chips'));
        var template = document.getElementById('owner-delete-control');
        target.querySelectorAll('[data-fav]').forEach(function (heart) {
          var button = template.content.firstElementChild.cloneNode(true);
          button.dataset.productId = heart.dataset.fav;
          heart.replaceWith(button);
        });
        document.dispatchEvent(new Event('shop:updated'));
      })
      .catch(function () { /* Keep the server-rendered public shop link usable. */ })
      .finally(function () { target.removeAttribute('aria-busy'); });
  }

  /* ---------------------------------------------------------
     categories, edited where they are shown

     The chips on this page are the shop's categories, so this is where
     they are managed: "ڕێکخستن" turns the rail into rename, delete and
     add. No long press, no separate manager page, and nothing that
     navigates away from the profile.
     --------------------------------------------------------- */

  /** Own categories are keyed c<uuid> in the rail's query string. */
  function categoryIdOf(chip) {
    var href = chip.getAttribute('href');
    if (!href) return null;
    var key = new URL(href, window.location.origin).searchParams.get('category');
    return key && /^c[0-9a-f-]{36}$/i.test(key) ? key.slice(1) : null;
  }

  async function call(path, fields) {
    var body = new URLSearchParams();
    Object.keys(fields || {}).forEach(function (key) { body.append(key, fields[key]); });
    var response = await fetch(path, { method: 'POST', credentials: 'same-origin', body: body });
    var data = await response.json().catch(function () { return null; });
    if (!response.ok || !data || data.error) throw new Error((data && data.error) || T.error);
    return data;
  }

  function installCategoryEditing(chips) {
    if (!chips) return;

    var rows = [];
    chips.querySelectorAll('.chip').forEach(function (chip) {
      var id = categoryIdOf(chip);
      if (id) rows.push({ id: id, name: chip.textContent.trim() });
    });

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'chip chip--manage';
    toggle.id = 'category-manage';
    toggle.textContent = T.manage;
    toggle.setAttribute('aria-expanded', 'false');
    chips.appendChild(toggle);

    var editor = document.createElement('div');
    editor.className = 'cat-edit';
    editor.hidden = true;
    chips.insertAdjacentElement('afterend', editor);

    var status = document.createElement('p');
    status.className = 'cat-edit__status';
    status.setAttribute('role', 'status');

    var busy = false;
    var changed = false;

    function say(text) { status.textContent = text || ''; }
    function lock(on) {
      busy = on;
      editor.querySelectorAll('button,input').forEach(function (el) { el.disabled = on; });
      toggle.disabled = on;
    }

    function row(entry) {
      var item = document.createElement('div');
      item.className = 'cat-edit__row';

      var name = document.createElement('input');
      name.className = 'field__input cat-edit__name';
      name.type = 'text';
      name.maxLength = 60;
      name.value = entry.name;
      name.setAttribute('aria-label', T.rename);

      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn btn--quiet cat-edit__save';
      save.textContent = T.save;

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn--ghost cat-edit__remove';
      remove.textContent = T.remove;

      save.addEventListener('click', async function () {
        var value = name.value.replace(/\s+/g, ' ').trim();
        if (!value) { name.value = entry.name; return; }
        if (value === entry.name) return;
        lock(true); say('');
        try {
          entry.name = (await call('/api/categories/' + entry.id, { name: value })).name;
          name.value = entry.name;
          changed = true;
        } catch (error) { say(error.message); name.value = entry.name; }
        finally { lock(false); name.focus(); }
      });
      name.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); save.click(); }
      });

      remove.addEventListener('click', async function () {
        // Deleting a category never deletes a product. products.category_id
        // is ON DELETE SET NULL, so the product keeps its images, price,
        // description and public URL — it just stops being in this section.
        if (!window.confirm(T.confirm)) return;
        lock(true); say('');
        try {
          await call('/api/categories/' + entry.id + '/delete');
          rows = rows.filter(function (other) { return other !== entry; });
          changed = true;
          draw();
        } catch (error) { say(error.message); }
        finally { lock(false); }
      });

      item.append(name, save, remove);
      return item;
    }

    function adder() {
      var item = document.createElement('div');
      item.className = 'cat-edit__row cat-edit__row--add';

      var name = document.createElement('input');
      name.className = 'field__input cat-edit__name';
      name.type = 'text';
      name.maxLength = 60;
      name.placeholder = T.placeholder;
      name.setAttribute('aria-label', T.add);

      var create = document.createElement('button');
      create.type = 'button';
      create.className = 'btn btn--quiet cat-edit__create';
      create.textContent = T.create;

      create.addEventListener('click', async function () {
        var value = name.value.replace(/\s+/g, ' ').trim();
        if (!value) { name.focus(); return; }
        lock(true); say('');
        try {
          var made = await call('/api/categories', { name: value });
          if (!rows.some(function (entry) { return entry.id === made.id; })) {
            rows.push({ id: made.id, name: made.name });
          }
          name.value = '';
          changed = true;
          draw();
        } catch (error) { say(error.message); }
        finally { lock(false); }
      });
      name.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); create.click(); }
      });

      item.append(name, create);
      return item;
    }

    function draw() {
      var list = document.createElement('div');
      list.className = 'cat-edit__list';
      rows.forEach(function (entry) { list.appendChild(row(entry)); });
      list.appendChild(adder());
      editor.replaceChildren(list, status);
      var focus = editor.querySelector('.cat-edit__row--add input');
      if (focus) focus.focus({ preventScroll: true });
    }

    function close() {
      editor.hidden = true;
      toggle.textContent = T.manage;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
      // Redraw from the shop page so the chips, their links and the
      // filtered grid all agree with what was just saved.
      if (changed) load();
    }

    toggle.addEventListener('click', function () {
      if (busy) return;
      if (editor.hidden) {
        say('');
        draw();
        editor.hidden = false;
        toggle.textContent = T.done;
        toggle.setAttribute('aria-expanded', 'true');
      } else close();
    });
  }

  target.addEventListener('click', async function (event) {
    var button = event.target.closest('.owner-delete');
    if (!button || button.disabled) return;
    var card = button.closest('.card');
    var title = card.querySelector('.card__title').textContent;
    if (!window.confirm('دڵنیایت لە سڕینەوەی «' + title + '»؟ ئەم کردارە ناگەڕێتەوە.')) return;
    button.disabled = true;
    try {
      var response = await fetch('/app/products/' + encodeURIComponent(button.dataset.productId) + '/delete', {
        method: 'POST', credentials: 'same-origin', body: new URLSearchParams()
      });
      var result = new URL(response.url);
      // The endpoint answers with a redirect, and where it lands is how
      // it reports the outcome: /app for a delete that removed a row,
      // /app?e=… for one that removed nothing. It used to land on the
      // manager list, which no longer exists.
      if (!response.ok || result.pathname !== '/app' || result.searchParams.has('e')) throw new Error('Delete failed');
      var next = card.nextElementSibling || card.previousElementSibling;
      card.remove();
      if (next) next.querySelector('.card__hit').focus();
      else {
        var empty = document.createElement('p');
        empty.className = 'notice';
        empty.textContent = 'هیچ بەرهەمێک لەم بەشەدا نییە.';
        target.appendChild(empty);
        target.querySelector('.chip').focus();
      }
    } catch (error) {
      window.alert('بەرهەمەکە نەسڕایەوە. تکایە دووبارە هەوڵ بدەوە.');
      button.disabled = false;
    }
  });

  load();
})();
