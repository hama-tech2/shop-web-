/* Local unpublished work only. IndexedDB preserves prepared image Blobs. */
(function () {
  'use strict';
  var db;
  function open() {
    if (!db) db = new Promise(function (resolve, reject) {
      var request = indexedDB.open('bazaro-product-drafts', 1);
      request.onupgradeneeded = function () { request.result.createObjectStore('drafts'); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return db;
  }
  async function run(owner, value, remove) {
    var connection = await open();
    return new Promise(function (resolve, reject) {
      var transaction = connection.transaction('drafts', value || remove ? 'readwrite' : 'readonly');
      var store = transaction.objectStore('drafts');
      var request = remove ? store.delete(owner) : value ? store.put(value, owner) : store.get(owner);
      transaction.oncomplete = function () { resolve(request.result); };
      transaction.onerror = transaction.onabort = function () { reject(transaction.error || new Error('Draft storage unavailable')); };
    });
  }
  window.ProductDrafts = {
    get: function (owner) { return run(owner); },
    put: function (owner, value) { return run(owner, value); },
    clear: function (owner) { return run(owner, null, true); },
    completed: async function (owner, id) { return ((await run(owner + ':published')) || []).includes(id); },
    complete: async function (owner, id) {
      var ids = (await run(owner + ':published')) || [];
      await run(owner + ':published', ids.filter(function (previous) { return previous !== id; }).concat(id).slice(-20));
    }
  };
  document.addEventListener('DOMContentLoaded', async function () {
    var holder = document.querySelector('[data-draft-owner]');
    if (!holder) return;
    var owner = holder.dataset.draftOwner;
    try {
      var draft = await run(owner);
      // Only the authenticated server can confirm the product was committed.
      var published = holder.dataset.published;
      if (published) await ProductDrafts.complete(owner, published);
      if (draft && published === draft.id) { await run(owner, null, true); draft = null; }
      if (draft) {
        var link = document.createElement('a');
        link.className = 'btn btn--quiet'; link.dataset.resumeDraft = draft.id;
        link.href = '/app/new?plan=free&draft=' + encodeURIComponent(draft.id);
        link.textContent = 'بەردەوامبوون لە بەرهەمە ناتەواوەکە';
        (document.querySelector('.billing-state') || document.querySelector('.owner-controls') || holder).appendChild(link);
      }
    } catch (_) { /* Publishing screen reports storage failures when needed. */ }
    var logout = document.querySelector('form[action="/logout"]');
    if (logout) logout.addEventListener('submit', async function (event) {
      event.preventDefault();
      try { await run(owner, null, true); await run(owner + ':published', null, true); }
      finally { HTMLFormElement.prototype.submit.call(logout); }
    });
  });
})();
