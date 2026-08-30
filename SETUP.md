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
