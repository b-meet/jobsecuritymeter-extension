# Store assets

Regenerate with:

```bash
npm run build
npm i --no-save playwright && npx playwright install chromium   # first time only
npm run assets
```

The two promo tiles are drawn from the icon and the palette rather than
photographed, so they have a second, much cheaper path that needs no build and
no session:

```bash
npm run assets:promo
```

Both paths render the same markup (`scripts/promo-tiles.mjs`), so they cannot
drift - `npm run assets` writes every file below, `npm run assets:promo` writes
only the two tiles.

| File | Size | Where it goes |
| :--- | :--- | :--- |
| `screenshot-card.png` | 1280×800 | Store listing → Screenshots |
| `screenshot-filled.png` | 1280×800 | Store listing → Screenshots |
| `screenshot-chip.png` | 1280×800 | Store listing → Screenshots |
| `screenshot-popup.png` | 1280×800 | Store listing → Screenshots |
| `promo-small-440x280.png` | 440×280 | Store listing → Small promo tile |
| `promo-marquee-1400x560.png` | 1400×560 | Store listing → Marquee promo tile |
| `fill-report.json` | — | not uploaded; evidence, see below |

## These are photographs, not mock-ups

`scripts/capture-store-assets.mjs` loads the real `dist/` build into a real
Chromium, seeds a session, serves a sample application form from an allowlisted
ATS host so the real content script auto-injects, and photographs whatever the
extension draws. Nothing in these images is illustrated by hand, which is the
only way they stay true as the UI changes — and the store requires screenshots of
actual functionality.

The fill is triggered by sending `FILL_NOW` to the tab, exactly as the popup
does, rather than by clicking the button. Every widget mounts in a **closed**
shadow root, so Playwright cannot reach in to click it — correctly, and that is
the point of a closed root.

Two things are asserted rather than assumed, and the script fails if either is
false: that the popup rendered as connected, and that the chip is actually
painted over the field's right edge. A caption promising a button that is not in
the picture is worse than no screenshot.

## The marquee is not decoration

It is the asset that makes the item *eligible to be considered* for featuring.
That is worth having for a new listing beyond vanity: Enhanced Safe Browsing
does not trust extensions from a developer new to the store for the first
months, and the short list of things a publisher can actively do about it -
rather than wait it out - is stay compliant, keep the listing complete, and be
present on the store's own trust surfaces. Being disqualified from one of them
over a missing 1400×560 PNG is the cheapest possible own goal.

## What to check before uploading

- [ ] **`fill-report.json` shows a real fill.** It is written on every run and is
      the evidence the screenshots are not of a blank form. Currently 17 filled,
      1 skipped.
- [ ] **The traps are still respected.** The sample form deliberately includes
      "Expected CTC" beside "Current CTC", and a "Referring company name" field.
      The report should show `currentSalary` and `desiredSalary` going to their
      own boxes, and nothing at all going into the referring-company field. If a
      run ever fills that one, the exclusion list has regressed and that is a bug
      to fix before shipping, not a screenshot to retake.
- [ ] **No real personal data.** The profile fixture is fictional
      (`priya.raman@example.com`, `linkedin.com/in/example-…`). These images are
      published, so a real name or number would be publishing somebody's contact
      details to the Chrome Web Store.
- [ ] **Captions still match what the picture shows.** They are written in the
      script, not added afterwards.
- [ ] **The tiles say nothing the listing does not.** Both carry the "never
      submits, leaves a field blank rather than guess" line, which is the one
      claim the whole design rests on. If that ever stops being true, these are
      published marketing that says otherwise.

## Known gaps in the captures

**The completeness meter in the popup screenshot depends on your Playwright
version.** The popup asks the service worker for status, which fetches
`/api/vault`. Whether that call can be intercepted is up to the harness: older
Playwright could not route requests made from an extension's service worker, so
the fetch reached the real network and failed, the worker reported "connected,
completion unknown", and the popup hid the meter — correct behaviour for a real
network failure, but a thinner screenshot. On 1.62 the route holds and the meter
is in the frame, which is the version the committed capture was taken with.

Either way the script prints the intercepted-call count, so this is a stated
fact rather than a puzzle: **0 calls means no meter**, and the screenshot is
still honest, just less complete. If you want it and cannot get it, capture that
one frame by hand against a signed-in browser.

**The `<select>` for work authorisation is reported as skipped** — visible as
"1 field left for you" in two of the frames, and in `fill-report.json` as
`unsupported control`. That is the product, not the capture: a yes/no `<select>`
backed by a boolean vault key is not yet filled. It is honest to ship this way,
since the panel says so plainly, but it is the most obvious thing to fix next.

**The sample form is a fictional company.** `store/fixtures/sample-application.html`
copies no ATS vendor's branding, layout, or wording — a screenshot that looked
like Greenhouse's own product would be using their trade dress to sell ours. The
host it is served from is only there to make the content script inject.

If you would rather ship captures from a genuine posting, take them by hand
against a real form while signed in; nothing in the listing depends on these
particular images. The tradeoff is that hand-captures go stale silently and these
do not.
