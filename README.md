# Job Autofill

Browser extension for [Job Security Meter](https://jobsecuritymeter.com). Fills
job applications from a profile saved to your account, across the major
applicant tracking systems.

Phase 1 covers generalised fields only — the block every ATS asks for, not
job-specific questions.

## Getting started

```bash
npm install
npm run dev      # watch build into dist/
npm run build    # typecheck + production build
npm test         # vitest
```

Then load `dist/` as an unpacked extension at `chrome://extensions` with
Developer mode on.

`VITE_SUPABASE_PUBLISHABLE_KEY` must be set at build time (`.env.local`). It is
the same publishable key the website already ships in its client bundle — the
service role key must never appear in this repository.

## How it fits together

```
jobsecuritymeter.com                    this extension
─────────────────────                   ──────────────
/extension/connect  ──── session ────▶  background/  (owns the token,
  (cookie auth)          handshake        makes every network call)
                                              │
/api/vault          ◀─── Bearer ──────────────┤
  (profile CRUD)                              │ values, one fill at a time
                                              ▼
/api/vault/field-map ─── selectors ────▶ content/   (detect + fill, no token)
```

### Auth

The extension never signs anyone in. `/extension/connect` on the website is
already cookie-authenticated, so it hands over the Supabase session it can see
via `chrome.runtime.sendMessage`, gated by `externally_connectable` and an exact
origin check. Token refresh is then supabase-js's problem, not ours — we write
no rotation, expiry, or revocation logic.

### Why the content script holds nothing

A content script shares a DOM with whatever the page is running. It gets values
for exactly one fill and stores none of them; the access token never crosses
that boundary at all. All network calls happen in the service worker, which also
means requests carry the extension's own origin and satisfy the API's
`EXTENSION_ORIGINS` allowlist — a content script's `fetch` would carry
`greenhouse.io` instead.

### Field matching

Three layers, most reliable first:

1. **`autocomplete` attribute** — a standardised token the site author wrote
   deliberately. Trusted outright.
2. **Remote field map** (`/api/vault/field-map`) — per-ATS selector overrides,
   ETag-cached. This is the difference between fixing a broken Greenhouse
   selector in a deploy and in a Chrome Web Store review.
3. **Keyword scoring** over labels, `aria-label`, placeholder, name and id.

Anything below the confidence threshold is reported as skipped, never guessed.
Filling the wrong value into a job application is worse than leaving it blank —
the user may not notice before submitting.

### Fill mechanics

`src/content/fill.ts` exists because Greenhouse, Lever and Ashby are React apps.
Assigning `element.value` goes through React's patched descriptor and leaves its
internal copy stale, so the field reverts on the next render. We call the
prototype's native setter and dispatch bubbling `input` + `change` instead.

Custom dropdowns (react-select) are not `<select>` elements and need a
click-open/type/pick sequence per ATS. Those come from the field map; until then
they are reported as skipped.

## Known gaps

- **Workday** is matched but not properly supported. Custom web components and a
  multi-step wizard make it a different problem from the others.
- **Resume file upload.** The website stores extracted text, never the PDF
  binary, so there is nothing to attach yet. Needs Supabase Storage plus a
  retention story.
- **`src/shared/vault.ts` is a copy** of `lib/shared/vault.ts` in the main repo,
  and it is the contract between them: rename a key on one side only and
  autofill silently writes nothing for that field, with no error anywhere.

  `npm run check:contract` catches the copy being edited in this repo without a
  deliberate re-sync. It cannot catch the main repo changing first — this repo
  is public, the main one is private, so CI here cannot read the source of
  truth. That direction currently relies on whoever edits `lib/shared/vault.ts`
  remembering to re-sync. Publishing the contract as a package would close it
  properly.

## Security notes

The refresh token lives in `chrome.storage.local`, which is readable by anyone
with filesystem access to the browser profile. That is an accepted risk for a
vault of contact details and is exactly why `shared/vault.ts` refuses anything
more sensitive than the voluntary EEO block. Government identifiers must not be
added without app-level encryption first.

Host permissions are a curated ATS list rather than `<all_urls>` — broad
permissions send a store submission into much deeper review and ask users to
trust us with every site they visit.
