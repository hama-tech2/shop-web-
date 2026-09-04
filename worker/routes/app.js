/**
 * The protected seller area.
 *
 * Guard order matters: no session -> login (remembering where they were
 * going); session but no shop -> the wizard; otherwise the shell.
 */

import { APP_NAME, APP_UI } from '../config.js';
import { layout } from '../render/layout.js';
import { appShell } from '../render/appshell.js';
import { getOwnShop, resolveSession, setSessionCookies } from '../auth.js';
import { redirect } from './auth.js';

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

  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');

  return new Response(
    layout({
      title: `${APP_UI.title} — ${APP_NAME}`,
      description: APP_NAME,
      body: appShell({ shop, origin: url.origin }),
      scripts: ['/js/app.js'],
    }),
    { headers },
  );
}
