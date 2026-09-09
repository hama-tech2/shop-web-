/**
 * Shop Web — notifying the owner, and letting him activate from Telegram.
 *
 * The webhook URL is public, so most of this is about what does NOT
 * happen: a callback from anybody but the owner, a wrong secret, a
 * missing header, a second press on a payment already handled.
 *
 * The one thing that must happen is that a press ends in exactly the
 * same place as the button on /admin — the same admin_activate_intent,
 * not a second activation path.
 *
 * No test here reaches the real bot API. TELEGRAM_API_BASE points at
 * the stub, which records every call the Worker makes.
 *
 *   node scripts/stub-supabase.mjs
 *   npx wrangler dev --port 8810 --local
 *   node scripts/telegram-test.mjs
 */

import {
  isOwner, notificationFor, parseCallback, secretsMatch, telegramReady,
  webhookAuthorised,
} from '../worker/telegram.js';

const APP = process.argv[2] || 'http://127.0.0.1:8810';
const STUB = process.argv[3] || 'http://127.0.0.1:8899';

const COOKIE = 'sb-access=TEST';
const INTENT = 'eeeeeeee-1111-4111-8111-111111111111';

/** The values in .dev.vars. Test secrets, not the owner's. */
const SECRET = 'test-webhook-secret-0123456789';
const OWNER = '111222333';

const results = [];
const check = (name, got, want) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const setIntent = (s) => fetch(`${STUB}/__intent/${s}`).then((r) => r.json());
const tgCalls = () => fetch(`${STUB}/__telegram`).then((r) => r.json());
const tgReset = () => fetch(`${STUB}/__telegram/reset`).then((r) => r.json());
const tgDown = (down) => fetch(`${STUB}/__telegram/${down ? 'down' : 'up'}`).then((r) => r.json());
const getWrites = () => fetch(`${STUB}/__writes`).then((r) => r.json());
const resetCalls = () => fetch(`${STUB}/__calls/reset`).then((r) => r.json());

/* ============================================================
   1. the pieces, on their own
   ============================================================ */

check('a matching secret matches', secretsMatch('abc123', 'abc123'), true);
check('a different secret does not', secretsMatch('abc123', 'abc124'), false);
check('a shorter one does not', secretsMatch('abc', 'abc123'), false);
check('an empty secret never matches', secretsMatch('', ''), false);
check('null never matches', secretsMatch(null, 'abc'), false);

const env = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_OWNER_CHAT_ID: OWNER,
  TELEGRAM_WEBHOOK_SECRET: SECRET,
};
check('all three secrets means configured', telegramReady(env), true);
check('two out of three does not',
      telegramReady({ ...env, TELEGRAM_WEBHOOK_SECRET: '' }), false);

const req = (header) => ({ headers: { get: () => header } });
check('right path and right header: authorised',
      webhookAuthorised(req(SECRET), SECRET, env), true);
check('right path, wrong header: no',
      webhookAuthorised(req('nope'), SECRET, env), false);
check('right path, missing header: no',
      webhookAuthorised(req(null), SECRET, env), false);
check('wrong path, right header: no',
      webhookAuthorised(req(SECRET), 'nope', env), false);
check('no secret configured at all: no',
      webhookAuthorised(req(SECRET), SECRET, { ...env, TELEGRAM_WEBHOOK_SECRET: '' }), false);

check('the owner is the owner', isOwner(OWNER, env), true);
check('a number that merely looks like it is not', isOwner('1112223330', env), false);
check('nobody is, when no owner is configured',
      isOwner(OWNER, { ...env, TELEGRAM_OWNER_CHAT_ID: '' }), false);

const press = (data, from) => parseCallback({
  callback_query: {
    id: 'cb1', data, from: { id: from },
    message: { message_id: 42, chat: { id: OWNER } },
  },
});

check('an activate press parses', press(`a:${INTENT}`, OWNER)?.action, 'activate');
check('and carries the intent', press(`a:${INTENT}`, OWNER)?.intentId, INTENT);
check('a not-found press parses', press(`n:${INTENT}`, OWNER)?.action, 'not_found');
check('an unknown action is nothing', press(`x:${INTENT}`, OWNER), null);
check('a callback that is not a uuid is nothing', press('a:hello', OWNER), null);
check('an ordinary message is nothing', parseCallback({ message: { text: 'hi' } }), null);
check('an empty update is nothing', parseCallback({}), null);
check('from.id is read, not chat.id',
      press(`a:${INTENT}`, '999')?.fromId, '999');

const note = notificationFor({
  id: INTENT, name: 'بۆتیکی نافین', plan: 'months_6',
  amount: 55000, reference: 'SW-4821',
});
check('the message names the shop', note.text.includes('بۆتیکی نافین'), true);
check('the plan', note.text.includes('٦ مانگ'), true);
check('the amount', note.text.includes('55,000'), true);
check('the reference code', note.text.includes('SW-4821'), true);
check('two buttons', note.reply_markup.inline_keyboard[0].length, 2);
check('carrying the intent id',
      note.reply_markup.inline_keyboard[0][0].callback_data, `a:${INTENT}`);
check('callback_data fits Telegram\'s 64 bytes',
      note.reply_markup.inline_keyboard[0][0].callback_data.length <= 64, true);

/* ============================================================
   2. the notification, when a seller says they paid
   ============================================================ */

await fetch(`${STUB}/__mode/shop`);
await fetch(`${STUB}/__rows/1`);
await tgDown(false);
await setIntent('open');
await tgReset();

const sent = () => fetch(`${APP}/app/subscription/sent`, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: COOKIE, origin: APP,
             'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ intent: INTENT }),
}).then((r) => ({ status: r.status, location: r.headers.get('location') }));

let r = await sent();
check('the seller is sent back to the instructions', r.location, '/app/subscription/pay');

// The notification goes out of band, so give it a moment to land.
await new Promise((done) => setTimeout(done, 600));
let calls = await tgCalls();
const message = calls.find((c) => c.method === 'sendMessage');
check('the owner was messaged', Boolean(message), true);
check('at his chat id', message?.body.chat_id, OWNER);
check('with the reference code', message?.body.text.includes('SW-4821'), true);
check('and two buttons', message?.body.reply_markup.inline_keyboard[0].length, 2);

// Where it landed is remembered, so the webhook can edit that message.
const stored = (await getWrites()).find(
  (w) => w.table === 'payment_intents' && w.method === 'PATCH');
check('the message id is stored against the intent',
      Number.isFinite(stored?.body.telegram_message_id), true);

/* ---------- Telegram being down must not cost a payment ---------- */

await setIntent('open');
await tgReset();
await resetCalls();
await tgDown(true);

r = await sent();
check('with Telegram unreachable, the seller still succeeds',
      r.location, '/app/subscription/pay');
await new Promise((done) => setTimeout(done, 600));
check('and the intent still moved to pending',
      (await getWrites()).some((w) => w.table === 'rpc/mark_intent_sent'), true);
check('the failed send was attempted, not skipped',
      (await tgCalls()).some((c) => c.method === 'sendMessage'), true);

await tgDown(false);

/* ============================================================
   3. the webhook
   ============================================================ */

const hook = (secret, body, header = secret) => fetch(
  `${APP}/api/telegram/${secret}`,
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(header === null ? {} : { 'x-telegram-bot-api-secret-token': header }),
    },
    body: JSON.stringify(body),
  },
).then(async (res) => ({ status: res.status, text: await res.text() }));

const callback = (data, fromId) => ({
  callback_query: {
    id: 'cb-1', data, from: { id: fromId },
    message: { message_id: 77, chat: { id: OWNER } },
  },
});

/* ---------- the secret ---------- */

await setIntent('pending');
await resetCalls();

let out = await hook('wrong-secret-wrong-secret', callback(`a:${INTENT}`, OWNER));
check('a wrong path secret gets the ordinary 404', out.status, 404);

out = await hook(SECRET, callback(`a:${INTENT}`, OWNER), 'wrong-header-value-here');
check('a wrong header secret gets the ordinary 404', out.status, 404);

out = await hook(SECRET, callback(`a:${INTENT}`, OWNER), null);
check('a missing header gets the ordinary 404', out.status, 404);

check('and none of those reached the database',
      (await getWrites()).some((w) => w.table.startsWith('rpc/admin')), false);

/* ---------- the chat id ---------- */

await resetCalls();
await tgReset();
out = await hook(SECRET, callback(`a:${INTENT}`, '999999999'));
check('a stranger\'s press is answered 200, so Telegram stops retrying',
      out.status, 200);
check('but it activates nothing',
      (await getWrites()).some((w) => w.table.startsWith('rpc/admin')), false);
check('and says nothing back — the bot does not confirm it is live',
      (await tgCalls()).length, 0);

/* ---------- the owner ---------- */

await resetCalls();
await tgReset();
out = await hook(SECRET, callback(`a:${INTENT}`, OWNER));
check('the owner\'s press is accepted', out.status, 200);

let writes = await getWrites();
check('it calls the same function /admin calls',
      writes.some((w) => w.table === 'rpc/admin_activate_intent'), true);
check('and no other activation path exists',
      writes.filter((w) => w.table.startsWith('rpc/admin')).length, 1);
check('with the intent it was given',
      writes.find((w) => w.table === 'rpc/admin_activate_intent')?.body.p_intent, INTENT);

calls = await tgCalls();
const edit = calls.find((c) => c.method === 'editMessageText');
check('the original message is edited in place', Boolean(edit), true);
check('to say it is done', edit?.body.text, 'چالاک کرا ✓');
check('at the message the button was on', edit?.body.message_id, 77);
check('and the buttons are taken away',
      edit?.body.reply_markup.inline_keyboard.length, 0);

/* ---------- pressing it again ---------- */

// The intent is now paid, which is exactly what a second press, or a
// press on something already handled from /admin, runs into.
await resetCalls();
await tgReset();
out = await hook(SECRET, callback(`a:${INTENT}`, OWNER));
check('a replayed press is still answered', out.status, 200);

writes = await getWrites();
check('it reaches the function, which is what refuses it',
      writes.filter((w) => w.table === 'rpc/admin_activate_intent').length, 1);
check('and no payment is recorded a second time',
      writes.some((w) => w.table === 'payments'), false);
check('and the subscription is not moved again',
      writes.some((w) => w.table === 'subscriptions'), false);

const second = (await tgCalls()).find((c) => c.method === 'editMessageText');
check('the owner is told it was already handled', second?.body.text, 'پێشتر کرابوو');

/* ---------- not-found ---------- */

await setIntent('pending');
await resetCalls();
await tgReset();
out = await hook(SECRET, callback(`n:${INTENT}`, OWNER));
check('not-found is accepted', out.status, 200);

writes = await getWrites();
check('and goes through its own function',
      writes.some((w) => w.table === 'rpc/admin_intent_not_found'), true);
check('recording no payment', writes.some((w) => w.table === 'payments'), false);
check('the message says so',
      (await tgCalls()).find((c) => c.method === 'editMessageText')?.body.text, 'نەدۆزرایەوە');

/* ---------- everything else Telegram might send ---------- */

await resetCalls();
out = await hook(SECRET, { message: { text: 'سڵاو', from: { id: OWNER } } });
check('an ordinary message is accepted and ignored', out.status, 200);
check('and touches nothing',
      (await getWrites()).some((w) => w.table.startsWith('rpc/admin')), false);

out = await hook(SECRET, { not: 'json we know' });
check('an update shape we do not know is accepted', out.status, 200);

out = await fetch(`${APP}/api/telegram/${SECRET}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json',
             'x-telegram-bot-api-secret-token': SECRET },
  body: 'not json at all',
}).then((res) => res.status);
check('a body that is not JSON is accepted, not retried for ever', out, 200);

out = await fetch(`${APP}/api/telegram/${SECRET}`).then((res) => res.status);
check('GET on the webhook is a 404', out, 404);

await setIntent('none');

/* ============================================================ */

let failed = 0;
for (const x of results) {
  if (!x.pass) failed += 1;
  console.log(
    `${x.pass ? 'PASS' : 'FAIL'}  ${x.name}` +
    (x.pass ? '' : `\n        got  ${JSON.stringify(x.got)}\n        want ${JSON.stringify(x.want)}`),
  );
}
console.log(failed ? `\n${failed} of ${results.length} FAILED` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
