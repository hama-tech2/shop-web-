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
import { getOwnShop, resolveSession, setSessionCookies } from '../auth.js';
import { redirect } from './auth.js';

/**
 * How close the plan is to running out, for the banner.
 *
 * Two cheap reads rather than one: subscription_state knows the dates,
 * and a live payment_intent is what turns "10 days left" into "waiting
 * to be confirmed" for a seller who has already transferred. Neither is
 * allowed to break the dashboard, so a failure just means no banner.
 */
async function planBanner(env, token, shopId) {
  const [stateRes, intentRes] = await Promise.all([
    asUser(env, token, 'rpc/subscription_state', {
      method: 'POST', body: { p_shop: shopId },
    }),
    asUser(env, token, 'payment_intents', {
      search: {
        select: 'id,status', shop_id: `eq.${shopId}`,
        status: 'eq.pending', limit: '1',
      },
    }),
  ]);

  const state = stateRes.ok ? stateRes.data?.[0] ?? null : null;
  if (!state) return null;

  const pending = intentRes.ok ? Boolean(intentRes.data?.length) : false;
  const plan = planState(state, pending);
  const kind = bannerFor(plan, PLAN_BANNER.soonDays);
  return kind ? { kind, days: plan.days } : null;
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

  const banner = await planBanner(env, token, shop.id);

  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');

  return new Response(
    layout({
      title: `${APP_UI.title} — ${APP_NAME}`,
      description: APP_NAME,
      body: appShell({ shop, origin: url.origin, banner }),
      scripts: ['/js/app.js'],
    }),
    { headers },
  );
}
