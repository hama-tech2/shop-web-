# Public product image discovery

Implemented 17 October 2026, Asia/Baghdad, on `codex/product-image-sitemap`, based on main `fb9758a20af532bc7415d94b5eae675316ef2f7c`.

## Change

The existing sitemap listed product pages but omitted their images. It now includes Google's image namespace and direct canonical `/img/` URLs beneath each eligible product entry. The same anonymous PostgREST request includes related image keys, avoiding a request per product. PostgreSQL RLS remains authoritative for both products and images; the existing public-shop cross-check, pagination and URL limit remain.

Images follow seller gallery position, prefer the full-size file and fall back to a valid card key. Repeated URLs are omitted. Missing/invalid keys, path traversal, non-product images and external URLs are excluded; products without images retain their page entries. Existing canonical path encoding and XML escaping are reused. No image captions, brands, stock, reviews or descriptions are invented.

Successful public product pages now emit `max-image-preview:large`. This is a permission for larger search previews, not a display guarantee. The shared layout defaults it off, and missing/private/admin pages do not gain this permission. Existing Product JSON-LD, Open Graph, SSR prices, customer links and the visual UI are preserved.

This change does not modify robots policy, Cloudflare security, R2 objects, SQL/schema, accounts, products, image records, permanent-Free limits, paid/grace entitlements, Wayl prices or payment verification. No merchant feed integration or submission is included.

## Files

- `worker/supabase.js`: add existing image columns to the anonymous sitemap read.
- `worker/routes/seo.js`: image namespace and product-image entries.
- `worker/render/layout.js`, `worker/routes/shop.js`: public-product-only large preview permission.
- `scripts/image-sitemap-test.mjs`: isolated query/render tests and real PostgreSQL RLS cases.
- `scripts/seo-test.mjs`: HTTP/SSR checks for images, preview scope, canonical/offer consistency and no-store behavior.
- `scripts/run-permanent-free-tests.mjs`, `package.json`: include image/SEO checks in the standard regression workflow.

## Fresh verification

`node scripts/run-permanent-free-tests.mjs` completed successfully: **18/18 groups, exit 0**. Groups: database, image-sitemap, plan-state, limits, hardening, SEO, Worker, Wayl, retry, profile, publish, currency, visibility, affected rows, grants, owner, browser and sharing.

- New image sitemap tests: **3/3**. Cover real full/card keys, encoding of Sorani/quotes/ampersands, fallback, duplicate/invalid/missing images, orphan-shop exclusion and 1,001-product pagination without extra image requests.
- The new database-backed sitemap case executes the historical migrations in isolated PGlite, then queries both products and images as `anon`. It verifies six paid products during the stored three-day grace, five after expiry, restoration on upgrading, hidden/archived exclusion, profile-only shop visibility, banned/suspended exclusion, and retention of all eight stored products/images/preferences.
- SEO HTTP regression: **106/106**. Existing SSR Product/Offer IQD/USD values, canonical paths, public shop/WhatsApp and admin gating remain functional.
- Wayl regression: **128/128**; existing owner **33/33**, browser/draft **26/26**, sharing/QR **39/39**.
- JavaScript syntax: **118 files, zero failures**. Whitespace diff check passed.

All write tests used synthetic local data, local R2 and payment stubs. The database shim does not validate real Supabase JWTs or emulate PostgREST. The new renderer test bridges its HTTP reads to actual anonymous PostgreSQL queries; it does not claim to be hosted PostgREST.

Separately, an **anonymous GET-only** compatibility check against the confirmed production Supabase project `kvwgiobnpwrjwyevadvc` successfully executed the exact nested query. It returned **14 public products / 32 related images**. Local rendering produced 27 page locations and 32 image locations. .NET's XML parser confirmed well-formed XML and resolved both namespaces. This did not apply SQL, edit data or deploy the new sitemap.

Evidence remains ignored under `.local/`: `test-summary.json`, individual `*-results.txt`, `syntax-results.json`, `image-sitemap-readonly-results.json` and `image-sitemap-production-readonly.xml`. Earlier audit failures are historical; this implementation's complete combined run passed without that local native-runtime crash.

Current official references were checked: [Google image sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps), [Google preview permission](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [Supabase nested queries](https://supabase.com/docs/guides/database/joins-and-nesting) and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). The Supabase changelog was reviewed. One external types-document download timed out; retrieval from the official npm registry then succeeded (`@cloudflare/workers-types` 5.20261016.1). No dependency was installed or updated, and no application/test failure resulted.

## Release boundary and remaining uncertainty

No merge, production deployment or production mutation was performed. This PR is for owner review. Search indexing, rankings, actual preview selection and merchant-market eligibility remain outside what these tests establish. Known raw R2 URLs retain their existing accessibility; sitemap exclusion does not revoke a previously known image URL or instantly remove indexed results.

No new Google Rich Results Test was run against undeployed changes. After an explicitly approved release, verify the deployed sitemap/representative images and Google inspection. No schema migration is required. No owner commands or manual test execution are needed for this PR.
