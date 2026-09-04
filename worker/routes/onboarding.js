/**
 * The four-step wizard. Each step is its own URL and its own form POST,
 * so Back works, a refresh is harmless, and nothing depends on JS.
 *
 * Steps 1-3 accumulate into a short-lived cookie because `shops` needs
 * name, slug and whatsapp all at once — the row is created at the end of
 * step 3. Step 4 (the logo) then updates that row and can be skipped.
 */

import { APP_NAME, ONBOARDING as T } from '../config.js';
import { layout } from '../render/layout.js';
import { stepContact, stepLogo, stepName, stepSlug } from '../render/onboarding.js';
import { asUser, slugAvailable } from '../supabase.js';
import {
  clearDraft, getOwnShop, readCookies, readDraft, resolveSession,
  sameOrigin, setDraft, setSessionCookies,
} from '../auth.js';
import { form, redirect } from './auth.js';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function page(body, title, headers) {
  const h = new Headers(headers || undefined);
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(layout({ title, description: APP_NAME, body, scripts: ['/js/app.js'] }), { headers: h });
}

/**
 * Every wizard route needs a signed-in seller. `needsShop` flips the
 * guard for the last step, which acts on the row the third step created.
 */
async function guard(request, env, { needsShop = false } = {}) {
  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);

  if (!user) return { redirect: redirect('/login?next=/onboarding', headers) };

  const shop = await getOwnShop(env, token, user.id);
  if (needsShop && !shop) return { redirect: redirect('/onboarding', headers) };
  if (!needsShop && shop) return { redirect: redirect('/app', headers) };

  return { user, token, shop, headers, draft: readDraft(readCookies(request)) };
}

/* ---------- step 1: shop name ---------- */

export async function nameGet(request, env) {
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;
  return page(stepName({ draft: g.draft }), T.nameTitle, g.headers);
}

export async function namePost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;

  const { name } = await form(request);
  const clean = (name || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 2 || clean.length > 80) {
    return page(stepName({ draft: g.draft, error: T.nameLabel }), T.nameTitle, g.headers);
  }

  setDraft(g.headers, { ...g.draft, name: clean });
  return redirect('/onboarding/slug', g.headers);
}

/* ---------- step 2: the link ---------- */

export async function slugGet(request, env, url) {
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;
  return page(stepSlug({ draft: g.draft, origin: url.origin }), T.slugTitle, g.headers);
}

export async function slugPost(request, env, url) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;

  const { slug } = await form(request);
  const clean = (slug || '').toLowerCase().trim();

  // Re-checked here, not only in the browser: the live check is a
  // convenience, this is the gate.
  const verdict = await slugAvailable(env, clean);
  if (!verdict.available) {
    const message =
      verdict.reason === 'taken' ? T.slugTaken
      : verdict.reason === 'reserved' ? T.slugReserved
      : T.slugFormat;
    return page(
      stepSlug({ draft: { ...g.draft, slug: clean }, error: message, origin: url.origin }),
      T.slugTitle, g.headers,
    );
  }

  setDraft(g.headers, { ...g.draft, slug: clean });
  return redirect('/onboarding/contact', g.headers);
}

/** Live check for the wizard. Small JSON, no caching. */
export async function slugCheck(env, url) {
  const slug = (url.searchParams.get('slug') || '').toLowerCase().trim();
  const verdict = await slugAvailable(env, slug);
  return Response.json(verdict, { headers: { 'cache-control': 'no-store' } });
}

/* ---------- step 3: city + WhatsApp, then create the shop ---------- */

export async function contactGet(request, env) {
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;
  if (!g.draft.name || !g.draft.slug) return redirect('/onboarding', g.headers);
  return page(stepContact({ draft: g.draft }), T.contactTitle, g.headers);
}

export async function contactPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env);
  if (g.redirect) return g.redirect;

  const { city, whatsapp } = await form(request);
  const phone = (whatsapp || '').replace(/[\s-]/g, '');
  const draft = { ...g.draft, city, whatsapp: phone };

  if (!/^\+?[0-9]{7,20}$/.test(phone)) {
    return page(stepContact({ draft, error: T.errWhatsapp }), T.contactTitle, g.headers);
  }
  if (!draft.name || !draft.slug) return redirect('/onboarding', g.headers);

  const res = await asUser(env, g.token, 'shops', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      owner_id: g.user.id,
      name: draft.name,
      slug: draft.slug,
      whatsapp: phone,
      city: city || 'erbil',
    },
  });

  if (!res.ok) {
    const code = res.data?.code;
    const message = code === '23505' ? T.slugTaken : T.errWhatsapp;
    return page(stepContact({ draft, error: message }), T.contactTitle, g.headers);
  }

  clearDraft(g.headers);
  return redirect('/onboarding/logo', g.headers);
}

/* ---------- step 4: logo, skippable ---------- */

export async function logoGet(request, env) {
  const g = await guard(request, env, { needsShop: true });
  if (g.redirect) return g.redirect;
  return page(stepLogo({ shop: g.shop }), T.logoTitle, g.headers);
}

export async function logoPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });
  const g = await guard(request, env, { needsShop: true });
  if (g.redirect) return g.redirect;

  let file;
  try {
    file = (await request.formData()).get('logo');
  } catch {
    return page(stepLogo({ shop: g.shop, error: T.errLogoType }), T.logoTitle, g.headers);
  }

  // Skipping is a normal outcome, not an error.
  if (!file || typeof file === 'string' || file.size === 0) {
    return redirect('/app', g.headers);
  }

  const ext = LOGO_TYPES[file.type];
  if (!ext) return page(stepLogo({ shop: g.shop, error: T.errLogoType }), T.logoTitle, g.headers);
  if (file.size > MAX_LOGO_BYTES) {
    return page(stepLogo({ shop: g.shop, error: T.errLogoSize }), T.logoTitle, g.headers);
  }

  // The key must sit under this shop's prefix or the CHECK rejects it.
  const key = `shops/${g.shop.id}/logo-${crypto.randomUUID()}.${ext}`;
  await env.IMAGES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });

  // Writing the key replaces the old one, which the database trigger
  // queues into deleted_objects. Nothing is deleted from R2 inline.
  const res = await asUser(env, g.token, 'shops', {
    method: 'PATCH',
    search: { id: `eq.${g.shop.id}` },
    body: { logo_key: key },
  });

  if (!res.ok) {
    await env.IMAGES.delete(key).catch(() => {});
    return page(stepLogo({ shop: g.shop, error: T.errLogoType }), T.logoTitle, g.headers);
  }

  return redirect('/app', g.headers);
}
