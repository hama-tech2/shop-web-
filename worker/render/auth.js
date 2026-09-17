import { APP_NAME, APP_NAME_LATIN, APP_TAGLINE, AUTH, BRAND, VISITOR } from '../config.js';
import { esc } from './html.js';
import { alert, button, divider, field, googleMark } from './forms.js';
import { iconBack } from './icons.js';

const shell = (inner) => `<div class="auth">${inner}</div>`;

const brand = () => `<p class="auth__brand">${esc(APP_NAME)}</p>`;

const withNext = (path, next) =>
  next ? `${path}?next=${encodeURIComponent(next)}` : path;

const googleButton = (next) =>
  `<a class="btn btn--quiet" href="${esc(withNext('/auth/google', next))}">` +
  `${googleMark()}<span>${esc(AUTH.google)}</span></a>`;

/** Carried through the whole flow so a deep link survives a login. */
const nextInput = (next) =>
  next ? `<input type="hidden" name="next" value="${esc(next)}">` : '';

const turnstile = (siteKey) => siteKey
  ? `<div class="auth__turnstile"><div class="cf-turnstile" data-sitekey="${esc(siteKey)}"` +
    ` data-theme="light" data-size="flexible"></div></div>` +
    `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
  : '';

export function signupPage({ error, email = '', next, turnstileSiteKey }) {
  return shell(
    brand() +
      `<h1 class="auth__title">${esc(AUTH.signupTitle)}</h1>` +
      `<p class="auth__sub">${esc(AUTH.signupSub)}</p>` +
      alert(error) +
      // Google first. It is one tap on a phone, it is how most sellers
      // here already sign in, and burying it under a divider made the
      // slow path look like the intended one.
      googleButton(next) +
      divider(AUTH.or) +
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
      turnstile(turnstileSiteKey) +
      button(AUTH.signupBtn) +
      `</form>` +
      `<p class="auth__foot">${esc(AUTH.haveAccount)} ` +
      `<a href="${esc(withNext('/login', next))}">${esc(AUTH.goLogin)}</a></p>`,
  );
}

export function loginPage({ error, notice, email = '', next, turnstileSiteKey } = {}) {
  return (
    `<main class="auth login" aria-labelledby="login-title">` +
      `<a class="login__back" href="/">${iconBack(18)}<span>${esc(VISITOR.back)}</span></a>` +
      `<header class="login__brand">` +
      `<div class="login__wordmark" dir="ltr"><img src="${esc(BRAND.icon192)}" width="72" height="72" alt="">` +
      `<span>${esc(APP_NAME_LATIN)}</span></div>` +
      `<p>${esc(APP_TAGLINE)}</p></header>` +
      `<h1 class="login__title" id="login-title">${esc(VISITOR.noAccountNeeded)}</h1>` +
      `<p class="login__sub">${esc(VISITOR.sellerBody)}</p>` +
      (error ? `<div role="alert">${alert(error)}</div>` : '') +
      (notice ? `<div role="status">${alert(notice, 'ok')}</div>` : '') +
      `<a class="btn btn--quiet login__google" href="${esc(withNext('/auth/google', next))}">` +
      `${googleMark()}<span>${esc(VISITOR.google).replace('Google', '<bdi dir="ltr">Google</bdi>')}</span></a>` +
      divider(AUTH.or) +
      `<form method="post" action="/login">` +
      nextInput(next) +
      field({
        name: 'email', label: AUTH.email, type: 'email', value: email,
        autocomplete: 'email', inputmode: 'email', placeholder: 'example@gmail.com',
        extra: ' autocapitalize="none" spellcheck="false"',
      }) +
      `<div class="login__password">` +
      field({
        name: 'password', label: AUTH.password, type: 'password',
        autocomplete: 'current-password',
      }) +
      `<button class="login__reveal" type="button" aria-label="${esc(VISITOR.showPassword)}"` +
      ` aria-controls="f-password" aria-pressed="false" hidden>` +
      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">` +
      `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>` +
      `<path class="login__eye-slash" d="m3 3 18 18"/></svg></button></div>` +
      `<a class="login__forgot" href="/forgot">${esc(VISITOR.forgot)}</a>` +
      turnstile(turnstileSiteKey) +
      button(AUTH.loginBtn) +
      `</form>` +
      `</main><script src="/js/login.js" defer></script>`
  );
}

export function forgotPage({ error, sent, email = '', turnstileSiteKey }) {
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
      turnstile(turnstileSiteKey) +
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
