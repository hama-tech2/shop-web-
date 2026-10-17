# Offline owner-profile visual fixture

Used only by `scripts/owner-profile-ui-test.mjs`; nothing here is imported or served by the production Worker.

`catalog.json` and the three image files are an anonymous public catalog snapshot from `bazarnow.xyz/@tosla-home`, 17 October 2026. Product names, uploaded images and prices are retained exactly. The image files contain their original response bytes and their response MIME types are recorded in the JSON; their test filenames do not change production R2 keys. No private seller session, email, payment/subscription record or credential was fetched.

The local fixture assigns one existing product photo as a test banner because the public snapshot had no saved banner. Six category names, draft contents and category API mutations are synthetic test state. They are never written to Supabase/R2 or claimed to be production categories or unfinished work. Empty images, long names/slugs, all social links and empty stock are additional synthetic stress cases.

The existing Noto Kufi Arabic and Vazirmatn fonts were fetched from the exact Google Fonts families/weights already used by `worker/render/layout.js`. Local copies make typography/geometry checks deterministic without external browser requests. Their original SIL Open Font License texts are in `fonts/`. Google Fonts CSS is retained with URLs rewritten to the test-only local server; no production font or dependency configuration changed.

Before screenshots use renderers and assets from unchanged main `cbc00b2f5bc6167a64fc7d8a9ae4a9b39b3cbb90`, exported to an ignored local archive. After screenshots use the feature branch, with the same public catalog, test categories and fonts. Full-content capture viewports are extended vertically so fixed navigation appears at the bottom of each image; layout/touch/navigation assertions independently run at 844px height and widths 320, 360, 390, 430 and 1280.
