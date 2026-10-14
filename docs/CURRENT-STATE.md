# Bazaro continuation checkpoint

Updated 14 October 2026, Asia/Baghdad. **The owner now explicitly authorized committing/pushing the completed branch and opening a PR into main. Deployment must wait for the owner's merge and the production verification gates.**

## Current PR publication checkpoint

- Correct Bazaro checkout/branch and GitHub `hama-tech2/shop-web-` verified again. Remote main remains `357d458fc1bb073918b79574fc8a65fb872d9688`; no open PR exists for this branch at the pre-publication check.
- Git Credential Manager's normal browser login succeeded. GitHub API verified authenticated account `hama-tech2` and repository push permission. Commit identity comes from that authenticated GitHub profile and its private noreply address, scoped to this repository; no owner identity was invented and no secret was written to Git.
- Fresh pre-publication full suite: **15/15 suites PASS**, exit 0. Fresh syntax: **112 files, zero failures**. Fresh `git diff --check`: PASS. Existing application implementation was reviewed without rebuilding or redesigning it.
- Publishing the completed branch/PR is authorized independently of production access. Completed implementation commit `de4f6bfdfe5fb85696e6d79fa2e94989528ec700` is pushed to `origin/phase1/permanent-free-database`. [PR #30](https://github.com/hama-tech2/shop-web-/pull/30) is open into `main` and attached to this task. No merge occurred. This follow-up checkpoint is a documentation-only commit on the same PR.
- Staged review covered 41 files. The basic credential-signature/private-path guard found no blocked files; it is not a guarantee. All 45 historical migrations, the Wayl provider adapter, cron implementation and live deployment configuration are unchanged. Ignored scratch/auth/test files were not committed.
- Supabase dashboard is still signed out. Hosted schema/history/ACL/RLS, actual PostgreSQL 17, recoverable backup and isolated PostgreSQL 17 rehearsal remain missing. The local database tests execute PGlite PostgreSQL 18.6 with synthetic authentication, not the hosted system or true independent-session contention.
- Production remains untouched. Do not migrate or deploy before the production gates pass. Apply only `20261013205746_permanent_free_subscription.sql`, with migration history recorded, **before** deploying the matching existing `shop-web` Worker/assets after the owner merges. Keep Wayl live settings and security unchanged; no real payments.
- Single owner action for production access: sign in privately in the retained Supabase project tab. Never send credentials in chat. The agent performs schema, backup and release checks; the owner does not run commands or tests.

The older local-only/no-push instructions below are historical and superseded by the latest explicit PR authorization. Their technical limitations and production safety gates still apply.

## Latest release attempt

Read [RELEASE-ACCESS-CHECK.md](RELEASE-ACCESS-CHECK.md) first. It supersedes the earlier review-only stop below.

- Fresh final full local release suite passed15/15; browser26 and grants42 pass. Syntax112 files and git diff --check pass.
- Test infrastructure now uses fresh short local R2 paths, unique recovery IDs, correct Back/BFCache assertions and browser external-request isolation. Intermediate failed checks and corrections are recorded in the release report.
- Production OpenAPI401 specifically says Secret API key required; ordinary public REST limit=0 returns200. No production rows fetched. CLI read-only version query returned AccessTokenRequiredError; no SQL executed. Supabase dashboard remains signed out.
- Actual PostgreSQL17/schema/history/RLS and a recoverable backup remain unverified. The owner authorized migration/deployment only after those gates pass. Do not infer authorization to bypass them.
- No production migration, Cloudflare deployment, R2 deletion, real payment, commit/push/merge or unrelated project change. All existing production data/entitlements are untouched.
- NEXT: owner signs in privately in the Supabase tab already opened, then selects Signed in. Agent handles all technical checks; never request secrets or manual commands/tests.

## Earlier local completion record (historical)


- Separate repository: https://github.com/hama-tech2/shop-web-.git. Checkout .local/bazaro-phase1; local branch phase1/permanent-free-database; base/HEAD 357d458fc1bb073918b79574fc8a65fb872d9688. Changes unstaged/uncommitted. No production migration/deployment/push/merge/PR/real payment or unrelated project change.
- Read CLAUDE.md, docs/PERMANENT-FREE-FINAL-LOCAL.md and the historical docs/PHASE-1-PERMANENT-FREE.md. The latest user explicitly authorized Phase 2; its earlier stop is superseded. Now stop after local completion.
- One new unapplied forward migration: 20261013205746_permanent_free_subscription.sql. All 45 historical migrations unchanged. New Free subscriptions permit NULL expiry with a CHECK retaining mandatory paid dates. Five stored products/five images, no expiry; old trial records are interpreted as Free without rewriting them.
- Paid expiry/grace/schedules/complimentary and historical month entitlements preserved. Storage becomes Free at paid expiry; full paid public visibility lasts through stored grace (default three days). Afterwards derived whole-shop selection is sort_order ASC, created_at DESC, id ASC among active products, maximum five. No product status/visibility/image backfill or expiry demotion. Upgrade restores eligible active stock, independent restrictions remain.
- Atomic publish_product/update_product owner RPCs; protected owner_products stock includes all retained products. Subscription/product locks cover quota/image writes; Wayl uses subscription-before-intent locks and its existing activated_at idempotency. Existing provider adapter, prices 5000/9000 IQD, secret checks and public plan choices preserved.
- Minimal pricing/Settings subscription copy, retained grid/status management and local owner-scoped IndexedDB drafts. Draft Blobs survive guarded navigation and missing uploads; server-confirmed publication clears the matching draft; Back cannot recreate completed work; logout clears draft metadata. Dynamic HTML/JSON/XML are no-store; images/styles remain unchanged.
- Fresh final full runner: 15/15 suites PASS, exit 0; DB group41, state6, Worker7, browser26, limits19, hardening40, Wayl128, retry33, profile52, publish54, currency129, visibility72, affected15, grants42, owner33. Strengthened post-insert gallery rollback test separately rerun8/8; syntax112 files PASS; git diff --check PASS. See final report for exact failed intermediate checks and corrections.
- Runner: node scripts/run-permanent-free-tests.mjs. Uses fresh PGlite18.6, localhost Supabase/Wayl stubs, local-only Wrangler/R2, isolated Chrome; no production data. Auto-stops its own server processes. Synthetic Auth/role shim is not JWT/PostgREST verification or true multi-session contention.
- Owner explicitly confirmed production Supabase ID kvwgiobnpwrjwyevadvc this session. GET of OpenAPI schema returned401. Identity confirmation does not verify hosted schema/security. No authenticated catalog comparison or production data-row inspection occurred. Do not use Kurdish Jobs credentials or infer a different target.
- DONE: authorized local phases and current tests. UNVERIFIED: actual hosted migration/schema/ACL, Supabase/JWT/PostgREST, PostgreSQL17 independent-session races, live provider/R2/cache behavior and live full-gallery replacement. MISSING: authenticated catalog export and isolated PG17 rehearsal. BLOCKED: production release at those verification gates and the user's separate release approval requirement. No local implementation blocker remains.
- Read-only schema preflight: supabase/operations/permanent-free-readonly-preflight.sql. Catalog metadata only; never apply production migrations as a verification shortcut. At future approved release, coordinate SQL/Worker, verify original entitlements and invalidate old dynamic caches without deleting images.
- Next owner action: send docs/PERMANENT-FREE-FINAL-LOCAL.md to ChatGPT. Do not deploy, push, merge or start another phase automatically.
