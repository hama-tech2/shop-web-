/**
 * /saved — the hearts.
 *
 * Two audiences on one page. A signed-in customer's favourites come
 * from the database and are rendered on the server. A signed-out one's
 * live in localStorage, which a server can never read, so the page
 * ships an empty shell that /js/favorites.js fills from the browser.
 * Either way the markup, the empty state and the URL are the same.
 */

import { APP_NAME, SAVED as T } from '../config.js';
import { esc } from './html.js';
import { cardsFragment } from './feed.js';
import { bottomNav } from './appshell.js';

const empty = () =>
  `<div class="empty" id="saved-empty">` +
  `<p class="empty__title">${esc(T.emptyTitle)}</p>` +
  `<p>${esc(T.emptyBody)}</p>` +
  `<p><a class="btn btn--quiet saved__browse" href="/">${esc(T.browse)}</a></p>` +
  `</div>`;

export function savedPage({ products, signedIn }) {
  // Every card here is saved by definition, so the hearts arrive filled
  // rather than blinking on once the script has caught up.
  const grid = products.length
    ? `<div class="grid" id="grid">${cardsFragment(products, 0, { saved: true })}</div>`
    : '';

  return (
    `<div class="page page--saved" data-signed-in="${signedIn ? '1' : '0'}">` +
    `<header class="header"><div class="header__top">` +
    `<h1 class="header__name">${esc(T.title)}</h1>` +
    `</div></header>` +

    // Signed out, the list is only on this device. Say so rather than
    // letting someone lose it by clearing their browser.
    (signedIn
      ? ''
      : `<p class="saved__note" id="saved-note" hidden>${esc(T.signedOutNote)} ` +
        `<a href="/login?next=/saved">${esc(T.signIn)}</a></p>`) +

    `<div id="saved-list">${grid}</div>` +
    // Hidden when the server already rendered rows; the script shows it
    // again if the browser turns out to have nothing stored either.
    (products.length ? '' : empty()) +
    `</div>` +
    bottomNav('saved')
  );
}

export const savedTitle = () => `${T.title} — ${APP_NAME}`;
