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
      var bio = doc.querySelector('.shop-bio');
      if (bio) {
        var existingBio = header.querySelector('.shop-bio');
        if (existingBio) existingBio.replaceWith(bio);
        else header.insertBefore(bio, header.querySelector('.owner-controls'));
      }
      products.querySelectorAll('.chip').forEach(function (chip) {
        var link = new URL(chip.getAttribute('href'), window.location.origin);
        chip.setAttribute('href', '/app' + link.search);
      });
      target.replaceChildren.apply(target, Array.from(products.childNodes));
      // Initialize the existing favorites implementation after the cards arrive.
      var script = document.createElement('script');
      script.src = '/js/favorites.js';
      document.body.appendChild(script);
    })
    .catch(function () { /* Keep the server-rendered public shop link usable. */ })
    .finally(function () { target.removeAttribute('aria-busy'); });
})();
