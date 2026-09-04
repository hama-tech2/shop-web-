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
