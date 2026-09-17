# Security hardening rollout

This change is intentionally not deployed by the repository task that created it.

## Required configuration before the Worker deploy

1. In Cloudflare Turnstile, create a **Managed** widget restricted to `bazarnow.xyz` (and `www.bazarnow.xyz` only if that host is actually used).
2. Add the widget's public site key to the deployed Worker's `TURNSTILE_SITE_KEY` variable. Because Wrangler configuration can replace dashboard variables, put the reviewed value in the deployment configuration used for the release or set it after the deploy and before enabling traffic. The site key is public by design; the private secret is not.
3. Keep the Turnstile secret out of Wrangler, source control, browser code, and Worker logs.
4. In Supabase Dashboard, open **Authentication -> Bot and Abuse Protection**, enable CAPTCHA, select **Cloudflare Turnstile**, and enter the Turnstile secret there.
5. Review Supabase Auth rate limits for password sign-in, sign-up, and recovery. CAPTCHA complements those limits; it does not replace them.
6. Confirm the existing Worker secrets `SUPABASE_SERVICE_ROLE_KEY`, `VIEW_SALT`, and `WAYL_API_TOKEN` are present without printing their values.

Supabase performs Turnstile's server-side token verification. The Worker sends the token in GoTrue's `gotrue_meta_security.captcha_token` field. If `TURNSTILE_SITE_KEY` is missing, the email signup, password login, and recovery routes refuse to call Supabase Auth.

## Required database review

Review and approve both security migrations:

- `supabase/migrations/20260923090000_upload_rate_limit.sql` adds one service-role-only RPC over the existing rate-event table.
- `supabase/migrations/20260923091000_disable_direct_public_reports.sql` revokes the unused ability for anonymous and ordinary authenticated clients to insert directly into `reports`. The current website has no public report form or Worker report endpoint, so no live UI flow depends on that grant.

Neither migration changes products, payments, prices, subscriptions, authentication tables, or RLS policies.

Apply the approved migrations before deploying this Worker. Uploads fail closed when the RPC is absent or unavailable.

Migration risks:

- If the upload RPC is missing, unavailable, or called with an invalid service credential, authenticated uploads return a rate-limit response. Roll back the Worker and then drop the RPC if this must be reverted.
- Revoking direct `reports` inserts would break an undocumented client that writes straight to Supabase. The current repository has no such UI or Worker route. Restore the grant below if one is discovered.

Rollback:

```sql
drop function if exists public.rate_limit_upload(text);
grant insert on table public.reports to anon, authenticated;
```

## Safe release order

1. Create the Turnstile widget and record its public site key and private secret separately.
2. Add `TURNSTILE_SITE_KEY` to the reviewed Worker deployment configuration, but do not enable Supabase CAPTCHA yet. Do not deploy this commit without that value: email authentication deliberately fails closed when it is absent.
3. Apply the approved upload-rate migration.
4. Deploy the Worker.
5. Immediately enable Cloudflare Turnstile CAPTCHA in Supabase using the private secret.
6. Smoke-test signup, password login, recovery, Google login, five normal product-image uploads, profile logo/banner upload, and a sixth rapid upload sequence.

The short interval between steps 4 and 5 leaves the prior direct-Supabase Auth exposure in place, while reversing those steps would temporarily block email authentication. Schedule them together and verify immediately.
