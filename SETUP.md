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
enqueues the object keys into `deleted_objects`. A Worker cron drains that
queue with the `IMAGES` binding (later session). `deleted_objects` has RLS on,
no policies, and no grants — service_role only.
