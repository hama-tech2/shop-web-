# Permanent Free release attempt — access gate

14 October 2026, Asia/Baghdad. The owner authorized this specific production release **only after** production compatibility, data protection and automated checks pass. That authorization supersedes the earlier local-only review stop, but its safety conditions are not yet satisfied.

## Verified

- Correct separate repository: `hama-tech2/shop-web-`, branch `phase1/permanent-free-database`, base/HEAD `357d458fc1bb073918b79574fc8a65fb872d9688`.
- Reviewed the existing uncommitted implementation, `CLAUDE.md`, Phase 1/final-local reports and the forward migration. All work in this attempt stayed in the Bazaro checkout.
- Fresh final `node scripts/run-permanent-free-tests.mjs`: **15/15 suites pass, exit 0**. Counts remain DB41, state6, limits19, hardening40, Worker7, Wayl128, retry33, profile52, publish54, currency129, visibility72, affected15, grants42, owner33 and browser26.
- Fresh syntax check: **112 files, zero failures**. `git diff --check` passes.
- Exact production identity remains owner-confirmed `kvwgiobnpwrjwyevadvc`. No alternative project or unrelated credentials were used.

## Local corrections in this attempt

Only test infrastructure changed; production application code/migration were not altered:

1. The local R2 state had been reused across runs while the recovery fixture reused a fixed draft UUID. The initial repeated release run failed recovery after that draft already had test uploads. The runner now uses fresh, short, unique local persistence paths; the recovery fixture uses a fresh UUID. Existing scratch files/objects were not deleted.
2. The first fresh R2 path was too long for this Windows native runtime: R2 initialization returned internal errors/HTTP 500, and no R2 object SQLite database was created in that directory. The older successful SQLite paths measured 250–254 characters; shortening the fresh persistence path resolved the failures. This is a local native-path limitation, not evidence of a production R2 failure.
3. Browser Back can reload the existing plan-choice gate under `no-store` instead of restoring a form from BFCache. The test now accepts either valid path while continuing to require the completed draft to stay cleared. It still requires Save to be disabled when the old form is restored.
4. An admin-grant browser run timed out waiting for page load despite the server grant checks succeeding. Existing grant and owner browser suites now block external requests, as the main draft suite already did, to keep hosted font loading outside isolated tests. The subsequent full run passes all grant and owner checks.
5. Added local failure diagnostics and an optional single-suite runner selector for focused troubleshooting.

The failures above were retained in development evidence and corrected before the final passing run. Tests exercised synthetic local records and local R2 only.

## Production access findings — still blocked

- A GET of the production OpenAPI endpoint returns **401, “Secret API key required.”**
- An ordinary REST GET using the same public key and `limit=0` returns **200**. No data rows were fetched. The previous 401 therefore does not demonstrate an invalid public key; it demonstrates that the schema endpoint needs privileged authorization.
- Official Supabase CLI `db query --linked --project-ref kvwgiobnpwrjwyevadvc --workdir .`, with a read-only server-version query, returns **AccessTokenRequiredError**. No SQL reached the database, no project link was changed, and no migration was applied.
- No Supabase MCP/database connection is exposed in this session. Relevant environment credentials are absent; no existing CLI login was available.
- Opened the exact production project in the in-app browser. It redirected to the Supabase sign-in page. No credentials were entered or requested in chat. The tab is retained for private sign-in.

**UNVERIFIED:** actual PostgreSQL 17 version, production migration history/schema/functions/ACL/RLS, current entitlement snapshots and a recoverable backup. These must be verified through authenticated access before any release. The existing catalog-only preflight is ready for the agent to execute; the owner is not asked to run it.

## External state

- Live website: **not updated**.
- Database migration: **not applied**.
- Production accounts/shops/products/images/payments/expiry dates/grace periods/R2 objects: **untouched by this attempt**.
- Wayl live configuration and payment verification: unchanged. No real payment initiation.
- Git changes remain local, unstaged and uncommitted. No push, merge or implementation PR. Commit/push and Cloudflare deployment are deferred with the gated release.
- Local test servers stopped by their runner. No project creation or security-control bypass.

## Continuation

After private sign-in, the agent should verify authenticated access to the exact project, inspect the schema and backup, and complete the PostgreSQL 17 compatibility/integration checks. Only then may it apply the existing new forward migration and deploy the matching existing Worker/assets under the owner's conditional release authorization. Do not ask the owner to run commands/tests or paste secrets.

**Single owner action:** Sign in privately in the opened Supabase tab and select “Signed in” in the pending question.
