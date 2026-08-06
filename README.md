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

### Getting noticed

Nobody remembers a toolbar icon. The content script detects the form on load and
puts up its own UI, so the extension arrives on the page rather than waiting to
be summoned.

Two surfaces, because one of them cannot always work (see below):

- **The handle and its card.** A draggable circle parked on an edge of the
  window. It opens itself once, the first time we see at least
  `OFFER_THRESHOLD` confident matches on a page — enough to be sure it is a real
  application form and not a listing page with a search box. After that it stays
  as a handle wherever the user parked it; the edge and height persist in
  `chrome.storage.local`, stored as a FRACTION of viewport height so the same
  dock lands sensibly on a laptop and a tall monitor. "Not on this site" mutes
  the origin for good.
- **The focus chip.** A small "Fill" button inside the right edge of a field the
  user has just focused, when we recognise it and it is still empty. Fills that
  one field.

The chip sits *inside* the field rather than below it because Chrome's own
autofill dropdown is browser UI painted above the page — no `z-index` competes
with it, so a chip underneath would be hidden behind Chrome's suggestions on
exactly the fields (name, email, address) where we both have something to say.

Neither surface ever fills anything on its own. Every path ends at a button the
user presses, for the same reason detection refuses to guess: a wrong value the
user does not notice before submitting is worse than a blank.

### Why an iframe changes the answer

`boards.greenhouse.io` and `jobs.lever.co` are usually embedded as cross-origin
iframes on a company's careers page. That host page is not in
`host_permissions`, so the content script runs **only inside the iframe** — and
those embeds are typically resized to their content height, meaning the iframe
has no scrollbar of its own and the parent page does the scrolling.

In that arrangement `position: fixed` inside the iframe resolves against the
iframe's full height rather than the visible window, so a "docked" handle would
sit halfway down the document and scroll away like any other element. Nothing
inside the frame can fix it: it cannot read the parent's scroll position, and
cross-origin it never will.

So `placementFor()` detects the case and the handle anchors to the top-right of
the form instead of the viewport — visible when the user reaches the form, which
is the moment that matters. The chip covers everything after that, because it
positions against a field inside the same document. This is the main reason the
feature is not just the docked panel.

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

### Source integrity

`npm run guard` (`scripts/guard-source.mjs`) fails the build on the markers of a
smuggled payload: a run of 100+ spaces inside a line, an obfuscated-loader
signature, a `createRequire(import.meta.url)` shim in an ES module, or a single
line over 3000 characters.

It exists because in July 2026 exactly that was appended to `postcss.config.mjs`
in the main repo and later to this repo's `check-contract.mjs`. Both hid the
same way — the payload sat at the end of an existing line behind several hundred
spaces, so the diff showed the line as unchanged and the file as `+4 −1`. It
survived three weeks of review and ran on every build.

The lesson was not "review diffs harder". That concealment is designed to defeat
human review, and it does. Counting spaces is something a machine does perfectly
and a person cannot do at all, so the check belongs in CI — where it runs
**before `npm ci`**, since "has anything been smuggled in?" is worth answering
before executing a single install script.

No dependencies, by design: a guard that imports from `node_modules` can be
switched off by the thing it is meant to catch.



The refresh token lives in `chrome.storage.local`, which is readable by anyone
with filesystem access to the browser profile. That is an accepted risk for a
vault of contact details and is exactly why `shared/vault.ts` refuses anything
more sensitive than the voluntary EEO block. Government identifiers must not be
added without app-level encryption first.

Host permissions are a curated ATS list rather than `<all_urls>` — broad
permissions send a store submission into much deeper review and ask users to
trust us with every site they visit.
