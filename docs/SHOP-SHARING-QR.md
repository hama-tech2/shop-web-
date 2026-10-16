# Seller shop sharing and QR

Scope: focused seller sharing improvement on `codex/shop-sharing-qr`, based on
main `c4b8c261`. No production migration or deployment is part of this change.

## Behavior

- The authenticated owner page replaces its small copy/share overlay with one
  compact sharing area: real public URL, existing Copy handler, QR link and one
  Sorani sentence about TikTok/Instagram bios and sending links to customers.
- Settings gains exactly one QR row; profile, subscription, support/legal,
  logout and bottom navigation retain their existing controls.
- `/app/qr` uses the existing session and owned-shop guard. Guests return to
  login with this destination remembered; sellers without a shop go to
  onboarding. Request-supplied shop IDs/slugs never choose the QR destination.
- QR, sharing and the existing Profile copy button use the canonical
  `https://bazarnow.xyz/@{shop.slug}`, including when viewed on a preview host.
  The URL has no account IDs, tokens, subscription information or login state.
- The page is private, `no-store` and `noindex`. QR generation happens locally
  in the browser, with an unmodified, pinned MIT-licensed `qrcode-generator`
  2.0.4 asset; no third-party QR service, new build system or paid API.
- PNG is black on opaque white, at least 1200 pixels square, integer pixels
  per module, with four white modules on every edge and error correction M.
  The download contains the QR only; shop name, Bazaro identity and scan
  instruction appear around the on-screen preview.
- Copy/native share reuse `shop.js`, including denied/missing clipboard and
  unsupported/rejected share fallbacks. Cancelling native share does nothing.
  A failed generator keeps the selectable URL and Copy/Share available.
- Each request reads the current owned shop; returning through BFCache reloads
  that private page. Sorani guidance explains that changing a URL can break
  previously printed QR codes and requires downloading a new one. No redirects
  or historical-slug storage were introduced.

## Changes

- New renderers: `worker/render/shop-sharing.js`, `worker/render/shop-qr.js`.
- Existing owner/header/Settings/Profile renderers integrate the sharing area,
  single Settings row and canonical Profile copying.
- `worker/routes/account.js` and `worker/index.js` add the guarded read-only
  route. Existing auth/RLS functions and public shop routes are reused.
- `worker/config.js`, `public/styles/account.css`, `public/js/shop-qr.js` and
  the small existing copy feedback timer implement presentation and downloads.
- Vendored source/license/provenance: `public/js/vendor/`.
- `scripts/shop-sharing-test.mjs` independently decodes preview and downloaded
  PNGs with dev-only `jsqr@1.4.0`; package and lockfile pin that dependency.
- Existing Profile regression assertions now permit the explicitly requested
  owner sharing URL. Other public/edit/search username expectations remain.
- The isolated regression runner includes sharing and awaits test subprocesses
  asynchronously, so local server log pipes keep draining during long suites.

## Validation

Run `npm run test:shop-sharing` for the local feature checks, or
`npm run test:permanent-free` for the full regression runner including sharing.
All test traffic is restricted to localhost; auth, shops, products and payment
providers are synthetic. No production writes or real payments are performed.

Final fresh full runner: **16/16 suites passed**, including **39 sharing checks**,
128 Wayl checks, 52 Profile checks and 26 existing permanent-Free browser checks.
Syntax: **117 files, zero failures**. `git diff --check`: passed. Browser checks
cover authentication/ownership, canonical URLs, PNG decoding/quiet zone,
download bytes and filename, 320/390/768px RTL layout, copy/share fallbacks,
different/changed slugs, HTML escaping, public customer access/WhatsApp,
Settings/back navigation, existing Profile copy, and unavailable QR assets.
Native share and clipboard permission outcomes are simulated in the browser;
no physical phone camera, OS share sheet or shop printer is exercised.

Two initial full-run attempts are retained locally: a native Windows Worker
runtime crash caused connection failures, and two historical assertions still
expected the owner's URL to be hidden. The payment suite passed independently;
the updated asynchronous runner and intended owner-link assertions were then
checked together in a fresh full run. Initial failures are not counted as passes.
The native runtime's internal crash cause was not proven; the synchronous
runner's blocked pipe-draining condition is independently confirmed by inspection.

## Data and release boundary

Synthetic mobile screenshots: [owner sharing](images/shop-sharing-mobile.png)
and [QR page](images/shop-qr-mobile.png).

No Supabase migration, new table/bucket, account/product/image/subscription
write, R2 object change, payment setting, Wayl adapter change, merge or manual
Cloudflare deployment. Existing prices, entitlements and permanent-Free model
are unchanged. The requested push may trigger the repository's existing
automatic branch preview build; production must wait for separate approval.
