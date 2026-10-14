# Permanent Free — final local implementation

> Latest release authorization, fresh checks, 401 diagnosis and the current access blocker are recorded in [RELEASE-ACCESS-CHECK.md](RELEASE-ACCESS-CHECK.md). The report below is the earlier local-completion record.

14 October 2026, Asia/Baghdad. Phase 1 safety checks and Phase 2 are complete locally. **Stop for review. No production release is authorized or performed.**

## Identity and scope

- Verified separate repository: https://github.com/hama-tech2/shop-web-.git.
- Checkout: `.local/bazaro-phase1`; branch `phase1/permanent-free-database`; unchanged base/HEAD `357d458fc1bb073918b79574fc8a65fb872d9688`. Changes are unstaged and uncommitted.
- Read `CLAUDE.md`, the previous implementation plan, Phase 1 report and current migrations. The latest owner instruction explicitly authorized finishing both phases locally and superseded the earlier Phase 2 stop.
- Owner confirmed production Supabase ID `kvwgiobnpwrjwyevadvc` in this session. This confirms identity only. A read-only GET of its OpenAPI schema returned **HTTP 401**. Actual hosted columns/functions/RLS/migration history could therefore **not** be compared. No production data rows were fetched.
- Work stayed inside this separate Bazaro checkout. No Kurdish Jobs source or project connection changed. No cloud migration, deployment, push, merge, PR, real payment, live Wayl configuration change, Docker or system installation occurred.

## What is finished

### Database

[The new forward migration](../supabase/migrations/20261013205746_permanent_free_subscription.sql) remains the single unapplied new migration. All **45 historical migration files are byte-for-byte unchanged**. They replayed only into fresh disposable local PostgreSQL engines.

- `subscriptions.expires_at` safely drops NOT NULL. A CHECK still requires a date for non-Free subscriptions. Proper permanent-Free rows alone may have NULL expiry.
- New shops get Free, five stored products, five images per product, no expiry, no new trial ledger entry.
- Existing trial subscriptions are interpreted as effective Free without rewriting their dates, status or historical ledger. The migration performs no account/product/image/subscription/payment backfill.
- Existing paid, historical one-month, complimentary and scheduled entitlements retain their original expiry dates and stored grace periods. New purchases from Free start immediately; historical unpaid trial deadlines no longer postpone them. A separate `paid_starts_at` records new paid starts without replacing original trial/shop dates.
- Paid storage eligibility ends at paid expiry; existing full public visibility continues through the stored paid grace period, including the existing three-day default. After grace, at most five active products are public. All surplus products/images stay stored.
- Selection is whole-shop and deterministic: `sort_order ASC, created_at DESC, id ASC`. Category/search/Home filters operate on that same eligible set. Owner and administrator RLS reads retain all stock.
- Expiry never changes a product's `status` or Home/profile `visibility`. The owner can hide/archive an active candidate in the existing editor to make the next candidate public. Hidden/archived rows still consume storage. Upgrading restores eligible active products; deliberately hidden/archived products stay hidden/archived.
- Independent shop suspension/ban and subscription suspension outrank entitlements. Missing metadata fails closed. Payment activation cannot clear those restrictions.
- Existing paid ceiling of 1,000 products remains. Deletion releases a stored-product slot.

Phase 2 adds owner-only, SECURITY INVOKER RPCs:

- `publish_product`: product and gallery commit together; identical retry of the same draft succeeds even at full quota; conflicting retry does not overwrite data.
- `update_product`: approved editable fields and gallery commit together; image-save failure rolls the edit back.
- `owner_products`: authenticated owner reads every retained product and its derived public eligibility.

The narrow private `app.lock_owned_subscription` helper locks only an owned subscription (or authorized administrator/service call). Storage quota checks and Wayl start/activation use the subscription lock consistently. Image insert checks and gallery saves also lock the parent product, covering direct authenticated database writes. Wayl locks subscription **before** intent to avoid opposite lock ordering. No network/provider call runs inside these database transactions.

Changed existing function families: Free limits/new-shop trigger; subscription tier/schedule/visibility/state; product quota/public eligibility; expiry sweep; paid activation calendar; image enforcement/save; Wayl start/apply locking. Existing function privileges are preserved; new owner RPCs revoke PUBLIC/anon execution. Tests fingerprint the unchanged price, authority and provider boundaries.

### Worker and necessary UI

- Worker constants and presentation now match permanent Free, five products/five images. Paid prices remain **5,000 IQD / six months** and **9,000 IQD / year**. Historical month entitlements can display; a new monthly checkout is not offered.
- Products 1–5 can choose Free in the existing plan flow. The sixth receives a clear limit and Premium path. A quota race returns the filled form and draft rather than discarding it.
- Publish/edit routes use the atomic RPCs. A failed gallery cannot create a half-made product or report a partially saved edit as success.
- The existing owner grid now obtains stock through protected `/app/owner-products`, using the seller token/RLS, rather than borrowing the anonymous grid. Retained products stay manageable; small status labels and the existing editor's status selector explain the public selection.
- Pricing and Settings subscription card show permanent Free. Shop identity/profile, account settings, support/legal, logout, bottom navigation, social/contact/location/WhatsApp and the current CSS/design remain in place. No stylesheet or unrelated screen redesign occurred.
- Dynamic HTML/JSON/XML responses use `no-store` so quota/expiry/status changes do not reuse stale lists. Immutable image caching remains unchanged.
- Unfinished work is stored locally in IndexedDB, scoped to the owner shop, including prepared image Blobs. Upgrade/Back navigation awaits persistence. Missing draft uploads recover from local Blobs. Successful publication clears the matching draft only after a server-confirmed owned-product lookup. Completed markers prevent browser Back from recreating the draft; logout clears owner draft data.
- Existing Wayl adapter/HMAC/provider validation, return pages, amounts and live settings are retained. Signed duplicate events are re-verified even if an earlier verification failed; database `activated_at` still grants once. Event-recording failure requests a retry.

Main integration files: `worker/routes/{products,app,account,payment}.js`, `worker/{config,plan-state,index,auth,supabase}.js`, `worker/render/{subscription,settings,product-form,appshell,shop}.js`, `public/js/{product,draft-store}.js`.

## Fresh tests and evidence

Run `node scripts/run-permanent-free-tests.mjs` (or `npm run test:permanent-free`). The versioned runner creates a localhost-only configuration, starts fresh synthetic Supabase/Wayl servers plus a local Worker/R2 binding, runs suites sequentially with baseline resets, and stops its own server processes. It refuses occupied test ports. Chrome must exist at the configured `CHROME` path; no browser/tool installation is performed.

The final full run returned exit code **0**, with **15/15 suites passing**, zero final failing tests:

| Suite | Final result | Evidence type |
| --- | ---: | --- |
| Permanent-Free DB/RLS/forward-migration regression | 41/41 | Executed embedded PostgreSQL |
| Plan-state | 6/6 | Pure presentation tests |
| Worker Free/customer routes | 7/7 | Real local Worker, synthetic HTTP backend |
| Browser Free/draft/Settings/RTL | 26/26 | Isolated headless Chrome, local Worker/R2 |
| Plan limits/prices | 19/19 | Current migration/Worker contract checks |
| Security hardening | 40/40 | Static and mocked checks |
| Wayl | 128/128 | Synthetic provider and callbacks |
| Checkout retry | 33/33 | Synthetic provider |
| Profile | 52/52 | Local Worker/stub |
| Publishing | 54/54 | Local Worker/stub |
| Currency | 129/129 | Local Worker/stub and formatting |
| Visibility | 72/72 | Local Worker/stub and rendering |
| Affected rows | 15/15 | Local Worker/stub |
| Complimentary/admin grants | 42/42 | Local Worker/stub and Chrome |
| Owner controls | 33/33 | Local Worker/stub and Chrome |

The atomic DB suite was rerun after strengthening its publication test: duplicate gallery keys fail **after** product insertion, and the product rolls back. **8/8 passed** (included in the 41-test DB group). Full syntax checking passed for **112 JS/MJS files**; `git diff --check` passed. Runtime logs/summary are ignored scratch under `.local/`.

Executed DB coverage includes fifth/sixth product and image boundaries, hidden/archive storage counting, deletion, owner edits, anonymous/other-owner RLS, permanent visibility, grace boundaries including a non-default stored grace, expired surplus preservation, selection changes, re-upgrade restoration, historical one-month and complimentary dates, suspended/banned shops, missing metadata, paid 1,000 ceiling, forward rollback, complete original-row snapshots, authoritative prices, duplicate callbacks and different-intent anti-stacking.

Executed browser coverage includes five image Blobs, upgrade round trip, quota race recovery, missing-upload recovery/re-upload, matching-draft clear, browser Back after commit, owner scoping, forged publication query protection, logout cleanup, Settings navigation, mobile RTL/tap targets and no JS errors.

### Failures encountered and corrected

- Initial migration assembly had malformed dollar quoting; isolated replay/rollback/backfill tests failed. Corrected locally; all final SQL suites pass. No migration was applied remotely.
- Two initial Worker subtests failed because the new subscription wrapper omitted the `esc` import. Corrected; pricing and paid/grace/scheduled route tests pass.
- Existing visibility (4), currency (14) and publish (9) assertions initially failed because they expected separate table writes, the old redirect or public caching. Updated them to assert the new atomic RPC fields, draft-confirmation redirect and `no-store`; current semantic coverage passes. Intermediate residual assertions and a currency switching request also failed during development; the isolated fresh runner now passes all 72/129/54 respectively.
- Initial draft-browser checks used an asynchronous predicate unsuitable for polling; corrected the test's polling. The expanded recovery fixture initially used a data-URL fetch rejected by the unchanged CSP; corrected the synthetic fixture to construct its Blob directly. Both are test-fixture corrections; no CSP relaxation occurred.
- The first grant run lacked the Windows Chrome path. One full run then failed `confirmed grant redirects with success`, with Worker diagnostic `Network connection lost`. Increasing the synthetic server's keep-alive timeout eliminated that failure in subsequent fresh runs. This supports a local pooled-connection explanation but does not prove its precise cause; production grant code was not changed.
- Initial Wrangler startup hit sandbox filesystem/build restrictions. Running the isolated server with local log paths and authorized execution permissions succeeded. A nonfatal Request.cf certificate warning remains a local tooling observation; TLS validation was never disabled.
- Production OpenAPI schema check **failed with HTTP 401**. This remains unresolved, not a passed schema comparison.

Legacy free-plan/two-month test entry points now delegate to current Worker coverage. The obsolete trial-calendar assertions are historical Git evidence, not current business rules. Old standalone SQL scripts were not applied to a hosted database.

## Remaining release blockers and limits

**Local implementation: DONE. Production release: NOT READY.**

1. **Hosted schema/history/ACL comparison is missing.** Identity is confirmed, authenticated schema access is not available here. Use [the catalog-only read-only preflight](../supabase/operations/permanent-free-readonly-preflight.sql); reconcile every difference before applying the forward migration. Do not share credentials in chat.
2. PGlite is PostgreSQL **18.6**, while the repository targets PostgreSQL **17**. Its Auth/role/extension setup is synthetic. Actual Supabase JWTs, PostgREST RPC serialization/permissions, extension placement and independent multi-session contention need a disposable PostgreSQL 17/Supabase rehearsal. The local Worker backend is a stub, not PostgREST over the test DB.
3. Live Wayl/R2/Cloudflare integration was intentionally not exercised. Existing public media URLs/immutable image behavior remain unchanged. The existing full-gallery cover-replacement upload limit is unchanged; title/category/status/visibility edits and local publication were tested, but a five-image live cover-replacement rehearsal was not performed.
4. At a separately approved release, deploy SQL and Worker together, verify actual existing entitlements/grants/expiry/grace before and after, and invalidate old dynamic HTML/feed/sitemap caches without deleting image objects. Hosted cache rules and existing cached responses were not inspected or altered. Worker headers alone cannot prove an independently configured CDN rule honors them.
5. Single owner draft is maintained per shop in the browser. Storage availability/eviction and simultaneous browser tabs are outside a durable server draft service; the application reports persistence failure before its guarded navigation. Clearing browser data removes local unfinished Blobs. No server draft feature was added.

Recommendation: obtain the authenticated catalog preflight, then rehearse the unchanged forward migration plus Worker against isolated PostgreSQL 17/Supabase before seeking a production release approval. Keep the current branch local until review.

**NEXT ACTION:** Send this report to ChatGPT for technical review.
