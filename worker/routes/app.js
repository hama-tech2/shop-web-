/**
 * The protected seller area.
 *
 * Guard order matters: no session -> login (remembering where they were
 * going); session but no shop -> the wizard; otherwise the shell.
 */

import { APP_NAME, APP_UI, PLAN_BANNER } from '../config.js';
import { layout } from '../render/layout.js';
import { appShell } from '../render/appshell.js';
import { asUser } from '../supabase.js';
import { bannerFor, planState } from '../plan-state.js';
import { getOwnShop, resolveSession, sameOrigin, setSessionCookies } from '../auth.js';
import { redirect } from './auth.js';

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

  if (!user) {
    const next = encodeURIComponent(url.pathname + url.search);
    return redirect(`/login?next=${next}`, headers);
  }

  const shop = await getOwnShop(env, token, user.id);
  if (!shop) return redirect('/onboarding', headers);

  const { banner, subscription } = await planBanner(env, token, shop.id);

  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');

  return new Response(
    layout({
      title: `${APP_UI.title} — ${APP_NAME}`,
      description: APP_NAME,
      body: appShell({ shop, origin: url.origin, banner, subscription }),
      scripts: ['/js/app.js'],
    }),
    { headers },
  );
}
