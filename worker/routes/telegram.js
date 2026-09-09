/**
 * The Telegram webhook.
 *
 * A public URL that anybody can POST to, so it answers 404 to
 * everything it cannot prove came from Telegram, and does nothing at
 * all for anybody who is not the owner.
 *
 * It never decides whether a payment is real. It calls the same
 * admin_activate_intent the /admin button calls, and that function's
 * own status check is what makes a second press a no-op — including a
 * press on a payment already handled from /admin.
 */

import { TELEGRAM as T } from '../config.js';
import {
  answer, editOutcome, isOwner, parseCallback, telegramReady, webhookAuthorised,
} from '../telegram.js';

/**
 * PostgREST as the service key.
 *
 * There is no user session in a webhook — nobody is signed in when
 * Telegram POSTs — so this is the one request path besides the cron
 * that uses the service key. app.is_service_role() is what lets it
 * reach the admin functions, and those still do all the deciding.
 */
async function rpc(env, fn, body) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { ok: false, code: null };

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, code: data?.code ?? null };
  } catch {
    return { ok: false, code: null };
  }
}

/** Telegram retries anything that is not a 200, so almost everything is one. */
const ok = () => new Response('ok', { status: 200 });

/**
 * A 404 that looks like every other unknown path.
 *
 * Somebody probing for the webhook learns nothing from it: not that the
 * path shape is right, not that the secret was close.
 */
const miss = (request, env) => env.ASSETS.fetch(request);

export async function webhookPost(request, env, pathSecret) {
  // Not configured at all: the route may as well not exist.
  if (!telegramReady(env)) return miss(request, env);

  // The secret, in the path and in Telegram's own header. Both.
  if (!webhookAuthorised(request, pathSecret, env)) return miss(request, env);

  let update;
  try {
    update = await request.json();
  } catch {
    return ok();
  }

  const press = parseCallback(update);
  // Not a button press we know about. Telegram sends plenty of updates
  // that are not ours, and none of them is an error.
  if (!press) return ok();

  // Anybody can find the bot and press a button. Only one person's
  // press does anything, and the rest are ignored without a reply —
  // no error toast, nothing that confirms the bot is even live.
  if (!isOwner(press.fromId, env)) return ok();

  const fn = press.action === 'activate' ? 'admin_activate_intent' : 'admin_intent_not_found';
  const note = press.action === 'activate' ? 'telegram' : 'transfer not found — telegram';
  const res = await rpc(env, fn, { p_intent: press.intentId, p_note: note });

  // 22023 is the function refusing an intent that is not in a state it
  // can act on — already paid, or already put back. That is what a
  // second press looks like, and what a press on something /admin has
  // already dealt with looks like. Say so rather than acting again.
  const outcome = res.ok
    ? (press.action === 'activate' ? T.activated : T.markedNotFound)
    : res.code === '22023'
      ? T.alreadyHandled
      : T.failed;

  // Take the buttons away with the edit. The intent's status is the
  // real guard; this is so the owner can see which ones are done.
  if (press.chatId && press.messageId) {
    await editOutcome(env, press.chatId, press.messageId, outcome);
  }
  await answer(env, press.callbackId, outcome);

  return ok();
}
