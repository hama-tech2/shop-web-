# TODO

Deferred work, with the reason it was deferred. Each item names the
session that should pick it up.

## UI session

### Stop loading every stylesheet on every page

`worker/render/layout.js` links all 8 stylesheets on every response, so
`/@slug` pulls `admin.css` and `account.css` — neither of which that
page uses.

Why it matters: `/@slug` is the page every customer opens from a TikTok
or Instagram link. It is the product. Two unused render-blocking
stylesheets are a real cost on Iraqi mobile networks, where the first
paint is the difference between a sale and a closed tab. `admin.css`
also hands anyone who views source the admin screen's class vocabulary
— not a security hole, since `/admin` is gated server-side and 404s,
but it is surface nobody needs to see.

Fix: give `layout()` a per-page stylesheet list, the way it already
takes a per-page `scripts` list.

Found in the session-9 step-3 cache/ownership audit. Deliberately not
fixed there: it is a UI change, and that session was correctness only.

### og:image declares the wrong size when it falls back to the logo

`worker/routes/shop.js` picks the share image as
`cover_key || logo_key || first product image`, then declares its size
as 1200x450 for a banner and 800x1000 for anything else:

    ogImageWidth:  isBanner ? 1200 : 800,
    ogImageHeight: isBanner ? 450  : 1000,

A logo is 400x400 square (`PROFILE_VARIANTS.logo`), so a shop with no
banner but a logo tells WhatsApp and Facebook to expect a 4:5 portrait
and hands them a square. The first-product fallback is correct — those
really are 800x1000.

Measured: `/@slug` with banner declares 1200x450 (right), with logo
only declares 800x1000 (wrong), with product only declares 800x1000
(right).

Fix: derive the declared size from which key was chosen, not from a
banner/not-banner guess.

Found in the session-9 step-6 link-preview check. Not fixed there:
that session was fenced off from image aspect ratios.
