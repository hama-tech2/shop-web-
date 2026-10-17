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
      if (draft && !(await ProductDrafts.completed(owner, draft.id))) {
        var link = document.createElement('a');
        link.className = 'btn btn--quiet'; link.dataset.resumeDraft = draft.id;
        link.href = '/app/new?plan=free&draft=' + encodeURIComponent(draft.id);
        link.textContent = 'بەردەوامبوون لە بەرهەمە ناتەواوەکە';
        var slot = document.getElementById('owner-draft-slot');
        if (slot) {
          link.className = 'owner-draft';
          var text = document.createElement('span'); text.className = 'owner-draft__body';
          var heading = document.createElement('strong'); heading.textContent = 'بەرهەمێکی ناتەواوت هەیە';
          var subtitle = document.createElement('span'); subtitle.textContent = (draft.fields && draft.fields.title) || link.textContent;
          text.append(heading, subtitle); link.replaceChildren(text);
          var arrow = document.createElement('span'); arrow.textContent = '‹'; arrow.setAttribute('aria-hidden', 'true'); link.append(arrow);
          var item = (draft.items || [])[0];
          var blob = item && (item.cardBlob || item.backupCard || item.fullBlob || item.source);
          var source = blob instanceof Blob ? URL.createObjectURL(blob) : item && typeof item.card === 'string' && /^products\//.test(item.card) && !item.card.includes('..')
            ? '/img/' + item.card.split('/').map(encodeURIComponent).join('/') : null;
          if (source) {
            var image = document.createElement('img'); image.alt = ''; image.width = 52; image.height = 52;
            image.src = source;
            image.addEventListener('load', function () { if (source.startsWith('blob:')) URL.revokeObjectURL(source); }, { once: true });
            image.addEventListener('error', function () { if (source.startsWith('blob:')) URL.revokeObjectURL(source); image.remove(); }, { once: true });
            link.prepend(image);
          }
          slot.appendChild(link);
        } else (document.querySelector('.billing-state') || document.querySelector('.owner-controls') || holder).appendChild(link);
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
