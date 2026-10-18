# Product-specific WhatsApp contact

18 October 2026. Base: main `9a1ffbfe8547c9c13a494a23464c6454a4652a48` (merged PR #33).

The customer contact links previously deliberately opened an empty composer. One shared helper now builds editable Sorani enquiries with the actual product title, current displayed price/currency and canonical `https://bazarnow.xyz/@slug/p/id`. For You, Search, Favorites (including asynchronously loaded cards), public shop cards, related products and product detail reuse it. Each product keeps its own joined seller's number. The shop header uses a general greeting and its own canonical shop URL.

The helper retains card phone normalization, including Iraqi local numbers and Arabic/Persian digits, and applies it consistently to detail/shop contacts. Missing or invalid numbers hide the contact action. Missing product identity also hides a product contact; missing/invalid price omits the price line rather than inventing zero. Legacy absent currency follows the existing IQD display rule. Encoded text is one query parameter; price direction is isolated for Sorani/USD readability. No customer information is requested or included. The customer may edit the text and must press Send.

Four runtime files change: the new helper and its three renderer callers. No CSS, browser scripts, seller settings, support/payment contact actions, database, image objects, subscription rules, Wayl integration or prices change.

## Verification

- `node --test scripts/whatsapp-test.mjs`: **7/7 PASS**. Multiple products/sellers, price changes, IQD/USD, Sorani and reserved characters, missing/unsafe data, all public render paths, related products, exact canonical origins, real OG image/title selection and ordinary navigation.
- `node scripts/run-permanent-free-tests.mjs`: **23/23 groups PASS**, exit 0. Includes the new tests, **65** shared-card browser checks (320/360/390/430px; intercepted external navigation), **58** visibility/contact checks, **106** SEO, **128** Wayl, **74** owner-profile UI, existing database, publishing, currency, Settings/profile, grants, draft recovery and **39** QR/sharing checks. Synthetic database/auth/provider data and local Worker/R2 only; these do not verify real JWTs, real payments or physical Android execution. No failed assertions in this run.
- Syntax: **122 JavaScript files PASS**. Diff whitespace check passed.
- `node scripts/mobile-card-polish-test.mjs`: **111/111 PASS**, including each card's WhatsApp destination/message at 320/360/390/430px and existing image-preparation/favorites behavior. Synthetic browser fixtures and intercepted uploads only; no real product/image was changed.
- Fresh public HTTP audit: **14/14** advertised product pages returned 200, with actual product name in OG title, exact canonical OG URL and a real product image matching Product JSON-LD; all 14 OG image URLs returned 200 with image content type. Clothing and furniture pages also returned OG metadata to a WhatsApp user-agent probe. This does not establish WhatsApp crawler-IP access or a rendered preview. Existing metadata was already correct, so it was preserved. Public page reads may record ordinary view analytics; no catalog/account/payment mutations were made.
- WhatsApp Web was opened and showed **Scan to log in**; no connected Android device was available. An actual in-chat preview could not be verified. No account was paired, message sent or file attached. Preview display depends on WhatsApp, user settings and caching and is **not guaranteed**.

The URL format follows [WhatsApp's official click-to-chat documentation](https://faq.whatsapp.com/5913398998672934): `https://wa.me/<international-number>?text=<encoded-message>`. The link supplies text, not an image attachment. The product link's existing public OG metadata allows clients to request a preview.

Ready for PR review. Do not merge or deploy in this task.
