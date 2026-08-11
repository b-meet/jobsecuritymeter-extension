# Store assets

Regenerate with:

```bash
npm run build
npm i --no-save playwright && npx playwright install chromium   # first time only
npm run assets
```

| File | Size | Where it goes |
| :--- | :--- | :--- |
| `screenshot-card.png` | 1280×800 | Store listing → Screenshots |
| `screenshot-filled.png` | 1280×800 | Store listing → Screenshots |
| `screenshot-chip.png` | 1280×800 | Store listing → Screenshots |
| `screenshot-popup.png` | 1280×800 | Store listing → Screenshots |
| `promo-small-440x280.png` | 440×280 | Store listing → Small promo tile |
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

## Known gaps in the captures

**No completeness meter in the popup screenshot.** The popup asks the service
worker for status, which fetches `/api/vault`; Playwright cannot intercept
requests made from an extension's service worker, so that fetch reaches the real
network and fails. The worker treats a failed vault fetch as "connected,
completion unknown" and the popup hides the meter — which is correct behaviour
for a real network failure. The script reports the intercepted-call count so this
shows up as a stated fact rather than a puzzle. If you want the meter in the
picture, capture that one frame by hand against a signed-in browser.

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
