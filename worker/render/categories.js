import { CATEGORIES_UI as T, MAX_CATEGORIES } from '../config.js';
import { esc } from './html.js';
import { alert } from './forms.js';
import { bottomNav } from './appshell.js';
import { iconArrowDown, iconArrowUp, iconBack, iconPlus, iconTrash } from './icons.js';

/**
 * Create, rename, delete and reorder.
 *
 * Each row is its own little form posting to its own action, so the
 * whole screen works with JavaScript off — no drag handles, just up and
 * down buttons, which are also easier on a phone.
 */
export function categoriesPage({ categories, error, notice }) {
  const rows = categories
    .map((c, i) => rowHtml(c, i, categories.length))
    .join('');

  return (
    `<div class="shell">` +

    `<div class="edit-head">` +
    `<a class="icon-btn" href="/app" aria-label="${esc(T.title)}">${iconBack()}</a>` +
    `<h1 class="edit-head__title">${esc(T.title)}</h1>` +
    `<span class="edit-head__count">${esc(T.counter(categories.length, MAX_CATEGORIES))}</span>` +
    `</div>` +

    `<p class="field__hint cat-intro">${esc(T.intro)}</p>` +

    alert(error) +
    alert(notice, 'ok') +

    (categories.length < MAX_CATEGORIES
      ? `<form class="cat-add" method="post" action="/app/categories/add">` +
        `<input class="field__input" name="name" type="text" required maxlength="60"` +
        ` placeholder="${esc(T.placeholder)}" aria-label="${esc(T.nameLabel)}">` +
        `<button class="btn btn--primary cat-add__btn" type="submit"` +
        ` aria-label="${esc(T.add)}">${iconPlus()}</button>` +
        `</form>`
      : `<p class="alert alert--error">${esc(T.errLimit)}</p>`) +

    (categories.length
      ? `<ul class="cat-list">${rows}</ul>`
      : `<div class="empty"><p class="empty__title">${esc(T.emptyTitle)}</p>` +
        `<p>${esc(T.emptyBody)}</p></div>`) +

    `</div>` +
    bottomNav('account')
  );
}

function rowHtml(category, index, total) {
  const action = `/app/categories/${esc(category.id)}`;

  const move = (dir, icon, label, disabled) =>
    `<button class="cat-row__btn" type="submit" form="move-${esc(category.id)}-${dir}"` +
    `${disabled ? ' disabled' : ''} aria-label="${esc(label)}">${icon}</button>`;

  return (
    `<li class="cat-row">` +

    // rename: the input IS the form
    `<form class="cat-row__rename" method="post" action="${action}">` +
    `<input class="field__input" name="name" type="text" required maxlength="60"` +
    ` value="${esc(category.name)}" aria-label="${esc(T.rename)}">` +
    `</form>` +

    `<div class="cat-row__tools">` +
    move('up', iconArrowUp(), T.up, index === 0) +
    move('down', iconArrowDown(), T.down, index === total - 1) +
    `<button class="cat-row__btn cat-row__btn--danger" type="submit"` +
    ` form="del-${esc(category.id)}" aria-label="${esc(T.remove)}">${iconTrash()}</button>` +
    `</div>` +

    // the buttons above live outside their forms so the row stays one flex line
    `<form id="move-${esc(category.id)}-up" method="post" action="${action}/move" hidden>` +
    `<input type="hidden" name="dir" value="up"></form>` +
    `<form id="move-${esc(category.id)}-down" method="post" action="${action}/move" hidden>` +
    `<input type="hidden" name="dir" value="down"></form>` +
    `<form id="del-${esc(category.id)}" method="post" action="${action}/delete" hidden` +
    ` onsubmit="return confirm('${esc(T.removeConfirm)}')"></form>` +

    `</li>`
  );
}
