# ADR 0004 — Customer phone photo handoff via QR + token

Date: 2026-07-26
Status: Accepted

## Context

Reference photos are a routine part of an intake conversation — the
customer wants to show an heirloom, a Pinterest save, or their current
ring. Every image path in the intake app is a plain `<input type="file">`
(`rp-file` for the gallery, `ul-file` for the sketch underlay, the
approval attachments), which can only reach photos already on the device
running the app. When the photo is on the *customer's* phone, the paths
were:

1. Customer AirDrops or texts it to Kyle's device, it lands in Photos,
   then ＋ Add → Photo Library. Two hops, and it clutters the studio
   camera roll with other people's photos.
2. ＋ Add → Take Photo, pointed at the customer's screen. One hop, but
   glare and moiré make it useless for anything shown back in an estimate.

Neither works for an Android customer without exchanging numbers first.

## Decision

A QR handoff, assembled almost entirely from parts already in the repo:

- **`/phone-upload?token=…`** (`phone-upload.html`) — a standalone
  customer-facing page. No login, no app install, and deliberately none of
  the studio app's scripts (no `js/api-auth.js`, no service worker) since
  it runs on a stranger's phone. It downscales to 1280px / q0.82 before
  sending — the same constants as the gallery's `_rpResizeFile` — so the
  studio receives gallery-sized bytes over a shop-floor connection.
- **`/api/phone-upload`** (`functions/api/phone-upload.js`) — session
  record in the existing `STS_DESIGNS` KV (`upload:{token}`, 6h TTL),
  bytes in the existing `STS_IMAGES` R2 bucket
  (`uploads/{token}/{idx}.jpg`).
- **`js/intake-phone.js`** — the studio half. Mints the session, renders
  the QR with the `js/qrcode-lib.js` already used by the print pages,
  polls every 2.5s while the dialog is open, and pulls each new slot into
  `_refPhotos` exactly once. Reached from a "📱 From their phone" button
  on the bottom sheet's Photos tab.

Nothing downstream changed: pulled photos land in the same `_refPhotos`
array a manual ＋ Add fills, so the save path and the Notion
reference-photo sync never learn the feature exists.

## Auth model

The unguessable token IS the capability, exactly as with the customer
approval page (ADR 0003's PUBLIC set, `functions/api/_middleware.js`).
`phone-upload` is the fourth entry in that set, because the customer's
phone cannot send `X-STS-Key`.

Minting a session is the one privileged action — without a check, anyone
could open sessions and write into the R2 bucket — so **`create`
re-checks `APP_SHARED_KEY` inside the handler**. It follows the
middleware's fail-open rule: an unset `APP_SHARED_KEY` cannot lock the
studio out of its own app.

Blast radius of a leaked token: up to 6 downscaled JPEGs written into one
session prefix, for at most 6 hours. It cannot read the order, the
customer record, or any other session.

## Notes on two smaller choices

- **Slots are assigned from the R2 listing, not a counter in KV.** Two
  uploads finishing together would otherwise both claim the same index off
  a stale read. R2 is the single source of truth for how many photos have
  landed; the KV record is only the liveness proof.
- **The session is deleted when the dialog closes.** The photos now live
  on the order, so a second copy in R2 is pure liability. A failed cleanup
  is harmless — the KV TTL ages the session out either way.

## Alternative rejected

**Inbound MMS.** `functions/api/sms-note.js` is already a live, public
Twilio webhook, so a customer could text a photo to the shop number. But
there is no order binding (you would match on phone number and hope),
pulling Twilio media needs credentials the Worker does not have, and it
requires asking for the customer's number. More plumbing than the QR for
a worse experience.

## Tests

`tests/intake-phone.js` covers both ends — session mint, QR contents,
poll-and-pull, the pull-exactly-once guard, teardown on close, and the
customer page's dead-link/upload/downscale/done path. `/api/phone-upload`
is answered by an in-memory stand-in mirroring the real contract, since
`tests/lib/server.js` serves static files only.
