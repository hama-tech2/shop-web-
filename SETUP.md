# Setup — the three Telegram secrets and the webhook

For the owner, on Windows, in **cmd** (not PowerShell), from the folder
that holds `wrangler.jsonc`.

**Never paste the bot token into a chat — not to Claude, not to anyone.**
Every step below either prompts for it without showing it, or reads it
from a variable that is cleared at the end. Nobody but you sees it.

If a step's output does not look like what it says here, stop and fix
that step before going on.

---

## 1. Store the bot token

```
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

It asks for the value. Paste the token, press Enter.
The token is not shown as you type and is not saved in cmd history.

You should see: `✨ Success! Uploaded secret TELEGRAM_BOT_TOKEN`

---

## 2. Find your chat id

First, in Telegram, open **@bazar_admin_7x4k_bot** and send it any
message — `hello` is fine. It has to have heard from you at least once.

Then, in cmd:

```
set /p TG=Paste the bot token then press Enter: 
```

Type the token at the prompt and press Enter. `set /p` reads it without
putting it in your command history.

```
curl "https://api.telegram.org/bot%TG%/getUpdates"
```

You should see a block of JSON. Find `"from":{"id":123456789,` — that
number is your chat id. Write it down.

If you see `{"ok":true,"result":[]}` the bot has not heard from you:
send it a message in Telegram and run the curl line again.

---

## 3. Store your chat id

```
npx wrangler secret put TELEGRAM_OWNER_CHAT_ID
```

Paste the number from step 2, press Enter.

You should see: `✨ Success! Uploaded secret TELEGRAM_OWNER_CHAT_ID`

---

## 4. Make a webhook secret

```
powershell -Command "[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')"
```

You should see one long line of 64 letters and numbers. Copy it.

---

## 5. Store the webhook secret

```
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Paste the 64-character string from step 4, press Enter.

You should see: `✨ Success! Uploaded secret TELEGRAM_WEBHOOK_SECRET`

---

## 6. Deploy

The webhook route has to exist before Telegram is pointed at it.

```
npx wrangler deploy
```

You should see `Uploaded shop-web` and a line ending in
`.workers.dev`. **Copy that URL** — the next step needs it.

---

## 7. Point Telegram at the webhook

```
set /p WH=Paste the webhook secret then press Enter: 
```

Paste the 64-character string from step 4 again, press Enter.

Then, replacing `shop-web.YOURNAME.workers.dev` with the URL from step 6:

```
curl "https://api.telegram.org/bot%TG%/setWebhook?url=https://shop-web.YOURNAME.workers.dev/api/telegram/%WH%&secret_token=%WH%"
```

You should see:
`{"ok":true,"result":true,"description":"Webhook was set"}`

---

## 8. Check it

```
curl "https://api.telegram.org/bot%TG%/getWebhookInfo"
```

You should see your URL, `"pending_update_count":0`, and no
`"last_error_message"`.

**This output contains the webhook secret in the URL. Do not screenshot
it or send it to anybody.**

---

## 9. Clear the variables

```
set TG=
set WH=
```

Both are now empty. Closing the cmd window does the same thing.

---

## 10. Try it end to end

1. On a seller account, go to the plans screen, choose a plan, and tap
   **پارەکەم نارد**.
2. Telegram should show: **پارەدانی نوێ**, the shop name, the plan and
   amount, the `SW-####` code, and two buttons.
3. Tap **چالاک بکە**. The message should become **چالاک کرا ✓** and the
   buttons should disappear.
4. The seller's shop should be active immediately — the same as if you
   had used the button on `/admin`.

If the message never arrives, run step 8 again and read
`last_error_message`.

---

## What each secret is for

| Secret | What it does |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Lets the Worker send you messages. |
| `TELEGRAM_OWNER_CHAT_ID` | The only person whose button presses do anything. |
| `TELEGRAM_WEBHOOK_SECRET` | Proves a request really came from Telegram. |

All three are Worker secrets. They are not in the repository, not in any
migration, and are never written to the logs.

To change one, run `npx wrangler secret put <NAME>` again. If you change
`TELEGRAM_WEBHOOK_SECRET`, redo step 7 — Telegram keeps calling the old
URL until you tell it otherwise.
