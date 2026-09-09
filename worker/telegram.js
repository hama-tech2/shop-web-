/**
 * Telegram: telling the owner a payment arrived, and letting him
 * confirm it from his phone.
 *
 * The whole point is that the button in Telegram and the button on
 * /admin end in the same place — both call admin_activate_intent, the
 * one function that moves a subscription. Nothing here decides anything
 * about a payment; it decides who is allowed to ask.
 *
 * The webhook URL is public. Every request is hostile until two
 * independent checks pass:
 *
 *   1. a secret only Telegram and this Worker know, carried both in the
 *      URL path and in the header Telegram adds from setWebhook's
 *      secret_token. Either one missing or wrong is a 404.
 *   2. from.id is the configured owner. Anybody can find a bot and
 *      press a button; nobody else's press does anything.
 *
 * The token, the chat id and the secret are Worker secrets. They are
 * never written to the repo, never put in a migration, and never
 * logged — the error paths below deliberately log only a method name
 * and a status code.
 */

import { TELEGRAM as T, UI } from './config.js';
import { price } from './render/html.js';

/**
 * Telegram's API. Overridable only so the tests can point it at a stub
 * — no test should ever reach the real thing, and a real payment must
 * not be sendable from a test run.
 */
const apiBase = (env) => env.TELEGRAM_API_BASE || 'https://api.telegram.org';

/** Configured means all three secrets are present. Two is a misconfiguration. */
export function telegramReady(env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_OWNER_CHAT_ID
                 && env.TELEGRAM_WEBHOOK_SECRET);
}

/**
 * Compare two secrets without leaking their length or contents through
 * how long the comparison takes.
 */
export function secretsMatch(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Is this request really from Telegram?
 *
 * The secret is in the path so a request that does not even have it
 * never reaches the body, and in the header so that a URL leaking from
 * a log or a proxy is not on its own enough. Both must match.
 */
export function webhookAuthorised(request, pathSecret, env) {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return false;
  if (!secretsMatch(pathSecret, expected)) return false;
  const header = request.headers.get('x-telegram-bot-api-secret-token');
  return secretsMatch(header, expected);
}

/* ============================================================
   the message
   ============================================================ */

/** Telegram callback_data is capped at 64 bytes; "a:" + a uuid is 38. */
const ACTIVATE = 'a:';
const NOT_FOUND = 'n:';

export function notificationFor(intent) {
  const amount = `${price(Number(intent.amount) || 0)} ${UI.currency}`;
  const text = [
    T.newPayment,
    intent.name ?? intent.shop_name ?? '',
    `${T.plan[intent.plan] ?? intent.plan} — ${amount}`,
    intent.reference ?? '',
  ].filter(Boolean).join('\n');

  return {
    text,
    reply_markup: {
      inline_keyboard: [[
        { text: T.activate, callback_data: `${ACTIVATE}${intent.id}` },
        { text: T.notFound, callback_data: `${NOT_FOUND}${intent.id}` },
      ]],
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a button press means, or null if the update is anything else.
 *
 * Telegram sends plenty of updates that are not button presses — a
 * message, a member joining — and they are not errors, they are simply
 * not ours.
 */
export function parseCallback(update) {
  const q = update?.callback_query;
  if (!q || typeof q.data !== 'string') return null;

  const action = q.data.startsWith(ACTIVATE) ? 'activate'
    : q.data.startsWith(NOT_FOUND) ? 'not_found'
    : null;
  if (!action) return null;

  const intentId = q.data.slice(2);
  if (!UUID.test(intentId)) return null;

  return {
    action,
    intentId,
    callbackId: q.id,
    // from.id is who pressed it. chat.id is only where the message
    // lives, and is not proof of anything on its own.
    fromId: q.from?.id == null ? null : String(q.from.id),
    chatId: q.message?.chat?.id == null ? null : String(q.message.chat.id),
    messageId: q.message?.message_id ?? null,
  };
}

/** Only the configured owner may act. Everyone else is ignored in silence. */
export function isOwner(fromId, env) {
  const owner = String(env.TELEGRAM_OWNER_CHAT_ID ?? '');
  return Boolean(owner) && String(fromId ?? '') === owner;
}

/* ============================================================
   talking to Telegram
   ============================================================ */

/**
 * One API call, best effort.
 *
 * Never throws and never returns anything a caller is tempted to treat
 * as authoritative: Telegram being down must not fail a payment, and a
 * seller who has transferred money is not going to be told otherwise
 * because a notification did not send.
 */
export async function call(env, method, body) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  try {
    const res = await fetch(`${apiBase(env)}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      // The status and the method name, and nothing else: the URL that
      // failed contains the bot token.
      console.log('telegram', method, res.status);
      return null;
    }
    return data.result ?? null;
  } catch {
    console.log('telegram', method, 'unreachable');
    return null;
  }
}

/**
 * Tell the owner a seller says they have paid.
 *
 * Returns the message id so the webhook can edit this exact message
 * later, or null if anything at all went wrong — which is not an error
 * anywhere upstream.
 */
export async function notifyPending(env, intent) {
  if (!telegramReady(env)) return null;
  const { text, reply_markup } = notificationFor(intent);
  const sent = await call(env, 'sendMessage', {
    chat_id: env.TELEGRAM_OWNER_CHAT_ID,
    text,
    reply_markup,
  });
  return sent?.message_id ?? null;
}

/**
 * Replace the message with its outcome and take the buttons away.
 *
 * Removing them is what stops one payment being actioned twice from the
 * same message; the intent's own status is what stops it being actioned
 * twice from two places.
 */
export function editOutcome(env, chatId, messageId, text) {
  return call(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: { inline_keyboard: [] },
  });
}

/** Stop the button's spinner. Telegram shows the text as a toast. */
export function answer(env, callbackId, text) {
  return call(env, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    text: text ?? '',
  });
}
