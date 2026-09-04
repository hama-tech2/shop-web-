/** Reuse the public, visibility-filtered grid inside the authenticated profile. */
(function () {
  'use strict';
  var target = document.getElementById('owner-products');
  if (!target) return;
  var url = new URL(target.dataset.shopUrl, window.location.origin);
  var category = new URLSearchParams(window.location.search).get('category');
  if (category) url.searchParams.set('category', category);
  target.setAttribute('aria-busy', 'true');
  fetch(url.pathname + url.search, { credentials: 'same-origin' })
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
      var chips = target.querySelector('.chips');
      if (chips) {
        var add = document.createElement('a');
        add.className = 'chip';
        add.href = '/app/profile#shop-categories';
        add.textContent = '+ زیادکردنی بەش';
        chips.appendChild(add);
      }
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
      if (!response.ok || result.pathname !== '/app/products' || result.searchParams.has('e')) throw new Error('Delete failed');
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
})();
