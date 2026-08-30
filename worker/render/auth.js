import { APP_NAME, AUTH } from '../config.js';
import { esc } from './html.js';
import { alert, button, divider, field, googleMark } from './forms.js';

const shell = (inner) => `<div class="auth">${inner}</div>`;

const brand = () => `<p class="auth__brand">${esc(APP_NAME)}</p>`;

const googleButton = (next) =>
  `<a class="btn btn--quiet" href="/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}">` +
  `${googleMark()}<span>${esc(AUTH.google)}</span></a>`;

/** Carried through the whole flow so a deep link survives a login. */
const nextInput = (next) =>
  next ? `<input type="hidden" name="next" value="${esc(next)}">` : '';

export function signupPage({ error, email = '', next }) {
  return shell(
    brand() +
      `<h1 class="auth__title">${esc(AUTH.signupTitle)}</h1>` +
      `<p class="auth__sub">${esc(AUTH.signupSub)}</p>` +
      alert(error) +
      `<form method="post" action="/signup">` +
      nextInput(next) +
      field({
        name: 'email', label: AUTH.email, type: 'email', value: email,
        autocomplete: 'email', inputmode: 'email',
      }) +
      field({
        name: 'password', label: AUTH.password, type: 'password',
        autocomplete: 'new-password', hint: AUTH.passwordHint,
      }) +
      button(AUTH.signupBtn) +
      `</form>` +
      divider(AUTH.or) +
      googleButton(next) +
      `<p class="auth__foot">${esc(AUTH.haveAccount)} <a href="/login">${esc(AUTH.goLogin)}</a></p>`,
  );
}

export function loginPage({ error, notice, email = '', next }) {
  return shell(
    brand() +
      `<h1 class="auth__title">${esc(AUTH.loginTitle)}</h1>` +
      `<p class="auth__sub">${esc(AUTH.loginSub)}</p>` +
      alert(error) +
      alert(notice, 'ok') +
      `<form method="post" action="/login">` +
      nextInput(next) +
      field({
        name: 'email', label: AUTH.email, type: 'email', value: email,
        autocomplete: 'email', inputmode: 'email',
      }) +
      field({
        name: 'password', label: AUTH.password, type: 'password',
        autocomplete: 'current-password',
      }) +
      button(AUTH.loginBtn) +
      `</form>` +
      `<p class="auth__foot"><a href="/forgot">${esc(AUTH.forgot)}</a></p>` +
      divider(AUTH.or) +
      googleButton(next) +
      `<p class="auth__foot">${esc(AUTH.noAccount)} <a href="/signup">${esc(AUTH.goSignup)}</a></p>`,
  );
}

export function forgotPage({ error, sent, email = '' }) {
  return shell(
    brand() +
      `<h1 class="auth__title">${esc(AUTH.forgotTitle)}</h1>` +
      `<p class="auth__sub">${esc(AUTH.forgotSub)}</p>` +
      alert(error) +
      (sent ? alert(AUTH.forgotSent, 'ok') : '') +
      `<form method="post" action="/forgot">` +
      field({
        name: 'email', label: AUTH.email, type: 'email', value: email,
        autocomplete: 'email', inputmode: 'email',
      }) +
      button(AUTH.forgotBtn) +
      `</form>` +
      `<p class="auth__foot"><a href="/login">${esc(AUTH.goLogin)}</a></p>`,
  );
}

export function resetPage({ error, done }) {
  return shell(
    brand() +
      `<h1 class="auth__title">${esc(AUTH.resetTitle)}</h1>` +
      alert(error) +
      (done ? alert(AUTH.resetDone, 'ok') : '') +
      (done
        ? button(AUTH.goLogin, { kind: 'primary', href: '/login' })
        : `<form method="post" action="/reset">` +
          field({
            name: 'password', label: AUTH.passwordNew, type: 'password',
            autocomplete: 'new-password', hint: AUTH.passwordHint,
          }) +
          button(AUTH.resetBtn) +
          `</form>`),
  );
}
