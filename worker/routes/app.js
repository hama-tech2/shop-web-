/**
 * The protected seller area.
 *
 * Guard order matters: no session -> login (remembering where they were
 * going); session but no shop -> the wizard; otherwise the shell.
 */

import { APP_NAME, APP_UI, PLAN_BANNER, PRODUCT, VISITOR } from '../config.js';
import { layout } from '../render/layout.js';
import { appShell, visitorPage } from '../render/appshell.js';
import { asUser, getCategories, toCard } from '../supabase.js';
import { bannerFor, planState } from '../plan-state.js';
import { getOwnShop, resolveSession, sameOrigin, setSessionCookies } from '../auth.js';
import { redirect } from './auth.js';
import { shopPage } from '../render/shop.js';

/**
 * How close the plan is to running out, for the banner.
 *
 * Three cheap reads: the dates, whether a transfer is waiting on the
 * owner, and which banners this shop has already closed. None of them
 * is allowed to break the dashboard — a failure just means no banner.
 */
async function planBanner(env, token, shopId) {
  const [stateRes, intentRes, closedRes] = await Promise.all([
    asUser(env, token, 'rpc/subscription_state', {
      method: 'POST', body: { p_shop: shopId },
    }),
    asUser(env, token, 'payment_intents', {
      search: {
        select: 'id,status', shop_id: `eq.${shopId}`,
        status: 'eq.pending', limit: '1',
      },
    }),
    asUser(env, token, 'plan_banner_dismissals', {
      search: { select: 'kind,dismissed_at', shop_id: `eq.${shopId}`, limit: '10' },
    }),
  ]);

  const state = stateRes.ok ? stateRes.data?.[0] ?? null : null;
  if (!state) return { banner: null, subscription: null };

  const dismissed = {};
  for (const row of (closedRes.ok ? closedRes.data ?? [] : [])) {
    dismissed[row.kind] = row.dismissed_at;
  }

  const pending = intentRes.ok ? Boolean(intentRes.data?.length) : false;
  const plan = planState(state, pending);
  return { banner: bannerFor(plan, PLAN_BANNER, dismissed), subscription: { state, plan } };
}

/**
 * Close a banner for a while.
 *
 * Stored against the shop rather than in the browser, so it follows the
 * seller between their phone and a laptop and cannot be cleared by
 * wiping site data. It records only when it was closed: plan-state.js
 * decides when it comes back, and the red ones never get here at all
 * because they carry no dismiss button.
 */
export async function bannerDismissPost(request, env) {
  if (!sameOrigin(request)) return new Response('bad origin', { status: 403 });

  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);
  if (!user) return redirect('/login?next=/app', headers);

  const shop = await getOwnShop(env, token, user.id);
  if (!shop) return redirect('/onboarding', headers);

  const form = await request.formData();
  const kind = String(form.get('kind') || '');
  // Only the two amber banners can be closed. Anything else is either a
  // banner that must stay up or a value somebody made up.
  if (kind !== 'soon' && kind !== 'urgent') return redirect('/app', headers);

  await asUser(env, token, 'plan_banner_dismissals', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: { shop_id: shop.id, kind, dismissed_at: new Date().toISOString() },
  });

  return redirect('/app', headers);
}

export async function appGet(request, env, url) {
  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers();
  if (refreshed) setSessionCookies(headers, refreshed);

  // The Account tab itself explains who needs an account, rather than
  // dropping a shopper into a login form that implies they do. Anywhere
  // deeper is genuinely seller-only, so that still goes to login with
  // the destination remembered.
  if (!user) {
    if (url.pathname === '/app') {
      headers.set('content-type', 'text/html; charset=utf-8');
      headers.set('cache-control', 'no-store');
      return new Response(
        layout({
          title: `${VISITOR.title} — ${APP_NAME}`,
          description: APP_NAME,
          body: visitorPage(),
          scripts: [],
        }),
        { headers },
      );
    }
    const next = encodeURIComponent(url.pathname + url.search);
    return redirect(`/login?next=${next}`, headers);
  }

  const shop = await getOwnShop(env, token, user.id);
  if (!shop) return redirect('/onboarding', headers);

  const { banner, subscription } = await planBanner(env, token, shop.id);

  // A delete that removed nothing redirects here with ?e=errGone. The
  // key is looked up rather than shown, so the URL cannot put arbitrary
  // text on the seller's screen.
  const errorKey = url.searchParams.get('e');
  const error = errorKey && PRODUCT[errorKey] ? PRODUCT[errorKey] : null;
  let published = null;
  const candidate = url.searchParams.get('published');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate || '')) {
    const saved = await asUser(env, token, 'products', {
      search: { select: 'id', id: 'eq.' + candidate, shop_id: 'eq.' + shop.id, limit: '1' },
    });
    if (saved.ok && saved.data?.[0]?.id === candidate) published = candidate;
  }

  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');

  return new Response(
    layout({
      title: `${APP_UI.title} — ${APP_NAME}`,
      description: APP_NAME,
      body: appShell({ shop, origin: url.origin, banner, subscription, error, published }),
      scripts: ['/js/draft-store.js', '/js/app.js'],
    }),
    { headers },
  );
}


/** Owner-only stock uses the session token and RLS, including retained surplus. */
export async function ownerProductsGet(request, env, url) {
  const { user, token, refreshed } = await resolveSession(request, env);
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  if (refreshed) setSessionCookies(headers, refreshed);
  if (!user) return new Response('Unauthorized', { status: 401, headers });
  const shop = await getOwnShop(env, token, user.id);
  if (!shop) return new Response('Not found', { status: 404, headers });
  const [stock, categories, own] = await Promise.all([
    asUser(env, token, 'rpc/owner_products', { method: 'POST', body: { p_shop: shop.id } }),
    getCategories(env),
    asUser(env, token, 'categories', { search: { select: 'id,name', shop_id: 'eq.' + shop.id, order: 'sort_order.asc,name.asc' } }),
  ]);
  if (!stock.ok) return new Response('Stock unavailable', { status: 503, headers });
  const activeCategory = url.searchParams.get('category') || '';
  let rows = stock.data || [];
  if (activeCategory.startsWith('c')) rows = rows.filter(p => p.category_id === activeCategory.slice(1));
  else if (activeCategory) rows = rows.filter(p => p.platform_category_id === categories.find(c => c.slug === activeCategory)?.id);
  const products = rows.map(row => ({ ...toCard({ ...row, shops: shop }), retained: !row.publicly_eligible, status: row.status }));
  return new Response(shopPage({ shop: { ...shop, products_visible: true }, products, categories,
    shopCategories: own.ok ? own.data : [], activeCategory, origin: url.origin, owner: true }), { headers });
}
