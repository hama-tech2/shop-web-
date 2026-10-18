# WhatsApp product-image preview improvements

18 October 2026. Base main `062bf38f0e7b6d351a1637a21a25c5dccf94e42b` (PR #34 merged). Review only: no merge or production deployment.

## Confirmed findings and limits

Fresh public inspection covered all 14 advertised product URLs, including five clothing products. Every page and original OG image returned HTTP 200. Five source images are PNG (despite `.webp` filenames), nine are WebP. The PNGs range from 764,487 to 3,184,345 bytes. All 14 pages claim 1200×1500, while the real photos have other dimensions, including 736×736 and 1122×1402. Titles and canonical URLs are correct, and OG tags appear early in server-rendered HTML. Serving PNG bytes with the actual `image/png` MIME is correct; the misleading filename alone is not proof of the preview failure.

Original image responses have public one-year immutable caching, valid ETags and tested 304 responses. HTML is no-store. WhatsApp, facebookexternalhit and meta-externalagent user-agent probes returned page/image 200 with no challenge header. Robots allows these public paths. These probes are **not** verification from Meta's actual crawler IPs or a complete WAF audit; no security rules were changed.

Oversized preview sources and inaccurate declared dimensions are confirmed compatibility defects. Their causal contribution to this specific WhatsApp client failure is not proven. WebP support, client privacy settings and cached preview metadata are additional possibilities. [WhatsApp documents an option to disable link previews](https://faq.whatsapp.com/445453537819972/?cms_platform=iphone); Bazaro must respect it. No authoritative WhatsApp-specific cache TTL or universal image-byte threshold was established. The byte budget below is our conservative engineering choice, not a claimed official WhatsApp limit.

## Implemented

- Product OG metadata now references a dedicated **600×600 JPEG**, with matching `og:image:type`, width and height. It is made only from that product's first real full image (card fallback if there is no full key). Contain scaling preserves the whole photo and aspect ratio, white padding handles square previews/transparency, and sources are never upscaled. No AI, stock, seed, shop-banner or brand-image replacement. Missing product photos advertise no OG image.
- `/preview/products/{id}/{cover-version}.jpg` reads the existing R2 object, generates a derivative in memory and caches derived bytes at the edge for one day. It never writes/deletes R2 objects or changes image/database records. The key-derived version changes on cover replacement; encoding changes require bumping the version constant. JPEG output is bounded to 200 KiB; all 14 actual sources produced 35,129–70,663 bytes in the implemented codec's local test.
- Every preview request checks current public-product eligibility through the existing anonymous/RLS data path and current cover version **before** edge-cache access or conditional 304. Hidden/ineligible products and replaced covers return 404. No arbitrary source URL, size or R2 key can be supplied by the visitor. Input limits: existing 4 MiB upload ceiling, maximum 4 million pixels and 4096 per side, checked before decode; native/Wasm image allocations are freed. Invalid sources return uncached 404.
- Responses have JPEG MIME, exact content length, ETag, HEAD/304 and the existing security headers. Clients must revalidate; only internal derived bytes receive the one-day cache lifetime. Cache failures fall back to generation. No custom-domain, binding, plan, secret, WAF or payment configuration change.
- Pinned `@cf-wasm/photon` 0.4.0 plus locked internals perform conversion inside the existing Worker. Existing **Workers Paid** was verified read-only in the signed-in account; no new image service or plan purchase. Conversion adds CPU on cache misses and must remain on the existing paid runtime. Local elapsed times are not production CPU measurements.

The existing product message, seller routing, customer-facing controls, originals, public image URLs, Product JSON-LD/sitemap photos, subscriptions and Wayl remain unchanged.

## Caching and actual WhatsApp verification

Changing the cover changes the OG image URL and avoids reusing an old derivative. This does not force WhatsApp to re-fetch metadata for a previously shared page. HTTP cache headers do not control WhatsApp's private preview caches; no cache-purge API or guaranteed refresh time is claimed. Canonical product links/messages were preserved rather than adding random tracking/cache-busting parameters. Existing sent messages may retain their original preview. After a separately approved release, an authorized client can check a fresh draft and wait for the preview before choosing whether to send; no message was sent here.

Fresh WhatsApp Web inspection showed **Scan to log in**; no Android device is connected. Actual WhatsApp in-chat rendering and client cache behavior are therefore **UNVERIFIED**. No account was paired and no privacy settings were weakened. Preview display remains dependent on the client and is not guaranteed.

## Optional native Share Product Photo

Feasible as a separate, user-triggered action on supporting HTTPS browsers. Fetch the same-origin real JPEG, construct a correctly typed `File`, check `navigator.canShare({files:[file]})`, then use `navigator.share` from a fresh user gesture. The user chooses an app and recipient and confirms sending. Preparing the file must preserve transient activation (prepare first, then offer the share tap). Unsupported devices should retain the existing link action and optionally offer an explicit download; cancellation must not send or silently download.

Native share cannot guarantee WhatsApp is installed, preselect this seller's chat, or guarantee that a caption/link is retained with the photo. `wa.me?text=` provides editable text only and **cannot attach an image file**. This task adds no extra sharing button or UI. Sources: [Web Share specification](https://w3c.github.io/web-share/) and [MDN file-sharing guidance](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).

## Checks

- `node --test scripts/product-preview-test.mjs scripts/whatsapp-test.mjs`: **13/13 PASS** (6 new codec/cache/security tests plus 7 existing message/routing tests). The older OG assertion first failed because it expected the raw original URL; it was updated to independently verify the new cover hash, canonical JPEG URL and exact metadata. Product messages/routing tests were not relaxed.
- `node scripts/run-permanent-free-tests.mjs --only=preview-worker`: **13/13 PASS** in actual local workerd with synthetic uploads/R2, including pixel/geometry checks, originals unchanged, HEAD/304, wrong method and post-cache eligibility/cover rejection.
- Exact implemented codec replay against all **14 downloaded real public photos: 14/14 PASS**, JPEG magic/dimensions/size validated. No originals were uploaded or overwritten. Maximum local elapsed conversion 141 ms; not a production benchmark.
- Final local Worker dry bundle: **PASS**, 1,945.23 KiB total / 707.96 KiB gzip. No upload/deployment. Synthetic configuration only.
- Syntax: **126 files PASS**. Diff whitespace: PASS.
- Complete isolated regression run: **25/25 groups PASS**, exit 0, including 128 Wayl, 106 SEO, 74 owner-profile UI, 65 card-action browser, 58 visibility/contact and 39 sharing/QR checks, plus database/entitlement, publishing, currency, Settings/profile and draft recovery. The subsequent WebP header-hardening change is covered by the focused reruns below. Synthetic authentication/database/provider tests do not prove hosted JWT behavior, actual provider transactions, load performance or real WhatsApp display.
- Final focused reruns after WebP header hardening: **13/13** Node codec/message tests, **13/13** actual local Worker checks, **14/14** real-photo conversions, syntax **126/126**, and dry bundle all **PASS**. Extended WebP canvas/frame mismatches and animation are rejected before decode. No unresolved failing test.

Ignored raw evidence: `.local/preview-audit/results.json`, `converted.json`, `full-regression-summary.json`, `final-worker-results.txt`, source/derived photos; `.local/product-preview-results.txt`, `preview-worker-results.txt`, `preview-build-results.txt`. No seller images or scratch credentials are committed. No catalog/payment data writes; ordinary live page GETs may record view analytics.

Ready for PR review. Production deployment and actual WhatsApp-client verification remain separate; do not merge or deploy in this task.
