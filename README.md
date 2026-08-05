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
  dock lands sensibly on a laptop and a tall monitor.
- **Hidden means tucked, never gone.** "Hide on this site" collapses the handle
  to a narrow tab flush against the window edge, remembered per origin. Click it
  or drag it off the edge and the handle is back. There is deliberately no way
  to remove the UI outright — a control whose only outcome is "you will never
  see this again, and there is no way back" is one people press by accident once
  and then file a bug about.
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
4. **Exclusions**, which veto a key whose keyword matched anyway.

Anything below the confidence threshold is reported as skipped, never guessed.
Filling the wrong value into a job application is worse than leaving it blank —
the user may not notice before submitting.

Layer 4 is what makes the short keywords usable. Forms really do label a field
just `Name` or `CTC`, but those strings also sit inside `Company name` and
`Expected CTC`, and scoring alone does not separate them — a short keyword in a
short label scores about the same either way. So `fullName` bows out on
`company`, `school`, `reference`…, `currentSalary` bows out on `expected`, and
`desiredSalary` bows out on `current`. The failure being prevented is not a
blank box; it is the applicant's name in the employer field, or the salary they
want in the box asking what they earn today.

### Keys that were never typed

`src/content/fields.ts` resolves three kinds of key, and detection cannot tell
them apart — nor should it. It matches an input to a key and asks for a value.

- **Stored** — typed into the profile editor.
- **Derived** — computed by the API and sent flat. `currentCompany` and
  `currentTitle` come from the role ticked "I currently work here", so the
  extension never has to understand the shape of a `roles` list to answer
  "current employer". Declared in `shared/vault.ts` because that is the synced
  contract; a derived key the extension knew about but the API did not would
  fill nothing, with no error on either side.
- **Composed** — assembled here from stored values. `fullName` is first plus
  last; `currentLocation` is city, state and country. These stay extension-side
  precisely because they are only a joining of values we already hold: sending
  them would grow the payload with data it already contains and force a contract
  re-sync every time a form taught us a new shape.

`currentLocation` deliberately excludes the street address. A form asking
"Location" wants somewhere to place you, not somewhere to post a letter, and
volunteering a home address to a job board is worse than an empty box.

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
