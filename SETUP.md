# Shop Web — Session 1: database and security

Vanilla HTML/CSS/JS · Cloudflare Workers (static assets) · Supabase Postgres + Auth · Cloudflare R2 · RTL Sorani

No UI in this session.

## What is already done

Migrations in `supabase/migrations/` are **applied** to the Supabase project
`shop web` (`kvwgiobnpwrjwyevadvc`, Frankfurt). 14 tables, RLS on all 14,
39 policies, 0 tables without RLS.

## What you still have to run yourself

Wrangler is not logged in inside the session container, so the R2 bucket was
not created for you. On your own machine:

```bash
bash scripts/setup-r2.sh    # creates ONE bucket: shop-web-images
```

Nothing is deployed, and no existing Cloudflare project is touched.

## Tests

```bash
# RLS — the five attacks, all must be denied
psql "$SUPABASE_DB_URL" -f supabase/tests/security_test.sql

# subscription maths + the 10-image / 1000-product limits
psql "$SUPABASE_DB_URL" -f supabase/tests/rules_test.sql

# same five attacks over real HTTP with real logins
npm install
SUPABASE_SERVICE_ROLE_KEY=... npm run test:security
```

Both `.sql` files also run as-is in the Supabase SQL editor, and both clean up
after themselves.

## Running it

```bash
npm install
npx wrangler dev            # http://localhost:8787
npx wrangler deploy         # needs `wrangler login` on your machine
```

The feed reads Supabase over PostgREST with the **publishable** key only.
RLS is what protects the data, so the anon role already sees exactly the
right rows. The service_role key is not used anywhere in the Worker.

Seed data (4 shops, 8 products) lives in `supabase/seed.sql` and is
already applied. The seed images are bundled in `public/seed/`; `/img/<key>`
serves from R2 and falls back to those files until real uploads exist.
**Remove that fallback once uploads are built.**

## Decisions locked in

| | |
| --- | --- |
| Auth | **Email + password only.** No phone OTP, no SMS — no provider, and every message costs money. |
| Routing | **Multi-page, not an SPA.** `assets.not_found_handling` is `"none"`, so any path with no matching static file falls through to the Worker. `/@slug` is server-rendered there so a link shared to WhatsApp or Facebook carries real OG tags and shows a preview image. |
| Currency | IQD everywhere. There is no currency column. |
| Category | Optional on a product. |
| Shops per seller | One (`shops.owner_id` is unique). |

## R2 key layout

Enforced by CHECK constraints, not by convention:

```
products/<shop_id>/<product_id>/<name>     product_images.r2_key
shops/<shop_id>/<name>                     shops.logo_key, shops.cover_key
```

A key outside its own row's prefix is rejected, and `..` is banned outright.

## Reserved slugs

A shop cannot take a slug the router wants:

`admin api login signup img app www shop store search saved help support
about terms privacy sitemap robots assets static cdn null undefined`

## Keys

| Key | Where it may live |
| --- | --- |
| `SUPABASE_PUBLISHABLE_KEY` | `wrangler.jsonc` vars, browser. Safe — RLS is the real guard. |
| `SUPABASE_SERVICE_ROLE_KEY` | `wrangler secret put` / `.dev.vars` / your shell. **Never** in `public/`, never in a commit. |

## Admins

`admins` has no write policy for any user role, so an admin can only be created
with the service_role key or from the SQL editor:

```sql
insert into public.admins (user_id, role) values ('<auth-user-uuid>', 'superadmin');
```

## Subscriptions

Only an admin can move money or time:

```sql
select public.admin_apply_payment('<shop_id>', 'months_6', 50000, 'fib');  -- amount is IQD
-- 'months_6' or 'year_1'; +2 bonus months applied automatically if still on trial
```

## R2 deletes

Nothing deletes from R2 inline. Deleting a product, an image row, or a shop
enqueues the object keys into `deleted_objects`. The cron below drains that
queue with the `IMAGES` binding. `deleted_objects` has RLS on, no policies,
and no grants — service_role only.

## The admin screen

`/admin` is visible only to a user with a row in `admins`. Anyone else — a
signed-out visitor or an ordinary seller — gets the same 404 as any unknown
path; there is no redirect and no link to it anywhere in the app.

It shows the merchant list (search + filter by status), open payment intents
with a one-click activate, a shop detail page (suspend / reopen, manual expiry
override, admin-only notes, that shop's products), and the reports queue.
Every write lands in `audit_log` through the table triggers.

Admin-only notes live in `shop_notes`, not on `shops`: anon can select every
column of a publicly visible shop, so a note column there would be public.

## The cron

`wrangler.jsonc` sets one trigger, `0 2 * * *` (05:00 in Erbil). Each run:

1. drains `deleted_objects` — up to 200 keys, five attempts each;
2. deletes draft uploads older than 24 hours whose product row never existed
   (`/app/new` mints the product id before the row, so an abandoned form
   leaves objects behind);
3. calls `expire_lapsed_subscriptions()` and prunes `view_dedupe`.

It needs the service_role key, which is the only place in the codebase that
uses it:

```sh
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put VIEW_SALT      # any long random string
```

Run it by hand against the deployed Worker with
`npx wrangler dev --test-scheduled` then `curl "http://localhost:8787/__scheduled"`.

## Search

`/search` has two tabs, products and shops, both backed by RPCs that run as
the caller — so RLS hides a suspended or lapsed shop from search exactly as it
does from the feed.

`app.ku_normalize` is the one definition of "the same word": it unifies
ك→ک, ي/ى→ی, ة/ە→ه, folds Arabic-Indic digits and strips tatweel, ZWNJ and
diacritics. Both the stored text and the query go through it, so they cannot
drift. Collapsing ه and ە loses the h/e distinction, which is deliberate:
people type them interchangeably on Arabic keyboards, and a search that keeps
them apart simply fails to match.

A query gets three chances: the full-text index, a substring match, then
`word_similarity >= 0.35` for a misspelling. It is `word_similarity` rather
than `similarity` because a one-word query against a three-word title scores
far below any useful threshold on the whole string. The threshold is spelled
out rather than using the `<%` operator: its GUC is not settable on Supabase.

Changing `ku_normalize` means rebuilding `products.title_norm` and
`products.search_tsv` — replacing the function does not rewrite values already
stored. Migration 0021 drops and re-adds both columns for exactly that reason.

## Favourites

Signed out, a heart is a product id in `localStorage` under
`shopweb:favorites` — it works on the first tap, with no account. Signed in,
the same tap also writes to `favorites`, and on the next page load the browser
posts whatever it was holding to `merge_favorites`, which skips anything not
publicly visible and anything already there. Only once that succeeds is the
local copy dropped.

`/saved` is server-rendered for a signed-in customer and an empty shell for a
signed-out one — a server cannot read `localStorage`, so the script fills it
from `/api/favorites/cards`. Either way the URL and the empty state are the
same.

```sh
npm i -D playwright-core
npm run test:favorites      # 15 checks, real browser, API stubbed
```

## View counting

`/@slug` and `/@slug/p/<id>` call `record_view()` after the response is sent.
The IP never reaches the database: the Worker sends `sha256(ip|date|VIEW_SALT)`,
and `record_view` refuses a token under 16 characters, counts one token once
per target per day (`view_dedupe`), and ignores anything not publicly visible.
`VIEW_SALT` is optional — without it the salt falls back to `SUPABASE_URL`,
which still works but is guessable.

---

# Supabase Auth — settings you must change yourself

The code cannot set these; they live in the Supabase dashboard. Project is
**shop web** (`kvwgiobnpwrjwyevadvc`).

Replace `SITE` below with your deployed Worker origin, e.g.
`https://shop-web.<your-subdomain>.workers.dev`. Everything else is literal.

## 1. Authentication → URL Configuration

| Field | Value to paste |
| --- | --- |
| Site URL | `SITE` |
| Redirect URLs | `SITE/auth/callback` |
| Redirect URLs (add a second) | `http://localhost:8787/auth/callback` |

The second one is for `wrangler dev`. Supabase rejects any `redirect_to`
that is not on this list, so Google sign-in and the password-reset link
both fail without it.

## 2. Authentication → Sign In / Providers → Email

| Setting | Value |
| --- | --- |
| Enable email provider | **on** |
| Confirm email | **off** — signup stays one step, as decided |
| Minimum password length | **8** — matches the check in the forms |
| Enable email signup | **on** |

## 3. Authentication → Sign In / Providers → Google

Turn the provider **on**, then paste the two values from Google Cloud
Console → APIs & Services → Credentials → OAuth 2.0 Client ID (type:
Web application):

- Client ID
- Client Secret

Then, **in Google Cloud Console**, on that same OAuth client:

| Google field | Value to paste |
| --- | --- |
| Authorized JavaScript origins | `https://kvwgiobnpwrjwyevadvc.supabase.co` |
| Authorized redirect URIs | `https://kvwgiobnpwrjwyevadvc.supabase.co/auth/v1/callback` |

That redirect URI is Supabase's, not ours — Google returns to Supabase,
Supabase returns to `SITE/auth/callback`. Getting this one wrong is the
usual cause of `redirect_uri_mismatch`.

## 4. Email delivery (before real sellers use it)

Password reset goes out over Supabase's built-in SMTP, which is rate
limited to a handful of messages an hour and is meant for testing. Before
launch, set a real sender under **Project Settings → Authentication →
SMTP Settings** (Resend, Brevo, SendGrid — any of them). Until then,
`/forgot` will work for you and then quietly start throttling.

## 5. If auth calls return 401

The Worker sends `SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_…` key) as
the `apikey` header. If your project has not enabled the new API keys for
Auth, swap that var in `wrangler.jsonc` for the legacy `anon` JWT key from
Project Settings → API. Nothing else changes — both are public keys and
RLS is what protects the data either way.

---

# Telegram — the three secrets and the webhook

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
