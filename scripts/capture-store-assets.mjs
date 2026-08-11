#!/usr/bin/env node
/**
 * Captures the Chrome Web Store screenshots by driving the BUILT extension in a
 * real Chromium.
 *
 * WHY NOT MOCK-UPS. The store requires screenshots of actual functionality, and
 * a hand-drawn panel drifts from the product the moment the UI changes. So this
 * loads `dist/` unpacked, seeds a session, serves a sample application form from
 * an allowlisted ATS host, and photographs whatever the extension actually
 * draws. If a screenshot looks wrong, the extension is wrong.
 *
 * HOW THE PIECES FIT
 *
 *   - The sample form is served by `context.route()` from a real ATS host, which
 *     is what makes the content script auto-inject: `content_scripts.matches`
 *     covers that host, so nothing has to be forced.
 *   - `/api/vault` and `/api/vault/field-map` are intercepted too, so no account
 *     and no network are needed. The vault fixture is a plausible profile.
 *   - The fill is triggered by sending FILL_NOW from the service worker, exactly
 *     as the popup does. It is NOT clicked, because every widget mounts in a
 *     CLOSED shadow root (see content/ui/theme.ts) and Playwright cannot reach
 *     into one - by design, and the design is right.
 *
 * The 1280x800 store frames are composed in HTML from the raw captures rather
 * than with an image library, so this needs no dependency beyond Playwright.
 *
 * Playwright is NOT a dependency of this package - it is a several-hundred-
 * megabyte browser harness, and the extension itself does not need it to build,
 * test, or ship. Install it when you need to regenerate the assets:
 *
 *     npm i --no-save playwright && npx playwright install chromium
 *     npm run assets
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const fixtures = join(root, "store/fixtures");
const outDir = join(root, "store/assets");
const tmp = join(root, "build/.capture");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(`
✖ Playwright is not installed.

  It is deliberately not a dependency of this package - it is a browser harness
  the extension does not need to build, test, or ship. Install it just to
  regenerate the store assets:

      npm i --no-save playwright && npx playwright install chromium
      npm run assets
`);
  process.exit(1);
}

if (!existsSync(join(dist, "manifest.json"))) {
  console.error("✖ No dist/ build found. Run `npm run build` first.");
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A plausible profile.
 *
 * Fictional, and it has to stay that way: these screenshots are published, so a
 * real name, a real email, or a real phone number would be publishing somebody's
 * contact details to the Chrome Web Store.
 *
 * `currentSalary` is set and `desiredSalary` is not, so the "Expected CTC" trap
 * in the sample form has nothing it could even wrongly draw from - the exclusion
 * is what keeps it empty, and that is the point being photographed.
 */
const VAULT = {
  data: {
    firstName: "Priya",
    lastName: "Raman",
    email: "priya.raman@example.com",
    phone: "98765 43210",
    phoneCountryCode: "+91",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    linkedinUrl: "https://linkedin.com/in/example-priya-raman",
    githubUrl: "https://github.com/example-priya",
    roles: [
      { company: "Meridian Systems", title: "Senior Software Engineer", current: true },
      { company: "Halcyon Retail", title: "Software Engineer", current: false },
    ],
    currentCompany: "Meridian Systems",
    currentTitle: "Senior Software Engineer",
    yearsExperience: "7",
    monthsExperience: "4",
    skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "AWS"],
    noticePeriod: "60 days",
    earliestStartDate: "2026-10-01",
    currentSalary: "32,00,000",
    // Both salary keys are set so the pair of CTC boxes demonstrates the thing
    // that actually matters: they get DIFFERENT values, in the right order. With
    // only one set, "Expected CTC" staying empty proves the exclusion works but
    // photographs as a field the extension failed to fill.
    desiredSalary: "45,00,000",
    salaryCurrency: "INR",
    workAuthorized: true,
    requiresSponsorship: false,
    remotePreference: "remote",
    howDidYouHear: "A former colleague",
    summary:
      "Senior engineer with seven years building product surfaces and the APIs behind them.",
    defaultCoverLetter:
      "I have spent the last seven years building product surfaces and the services behind them, most recently leading the checkout rewrite at Meridian Systems. What draws me to this role is the chance to own a surface end to end rather than hand designs across a wall.",
  },
  schemaVersion: 3,
  updatedAt: "2026-08-01T09:00:00.000Z",
  completion: { filled: 24, total: 34 },
};

const SESSION = {
  accessToken: "capture-fixture-access-token",
  refreshToken: "capture-fixture-refresh-token",
  // Far future, so nothing tries to refresh mid-capture and blank the popup.
  expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
  email: "priya.raman@example.com",
};

const FORM_URL = "https://boards.greenhouse.io/northwindlabs/jobs/4482910";

/**
 * The same form on a host the manifest does NOT list.
 *
 * Used for the popup frame, and the choice is not cosmetic: on an unlisted host
 * no content script auto-injects, so the page renders with no on-page UI at all.
 * That is exactly the situation the popup exists for - "Fill this page" on a
 * company's own careers page - so the screenshot shows the real state of that
 * page rather than a clean background borrowed from somewhere else.
 */
const CAREERS_URL = "https://careers.northwind-labs.com/senior-product-engineer";

/* -------------------------------------------------------------------------- */
/* Browser                                                                    */
/* -------------------------------------------------------------------------- */

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };

console.log("Launching Chromium with the built extension…");

const context = await chromium.launchPersistentContext(join(tmp, "profile"), {
  /**
   * `headless: false` IS LOAD-BEARING, and not because we want a window.
   *
   * Playwright's headless mode runs `chromium_headless_shell`, a separate binary
   * with no extension support at all - it does not merely ignore
   * `--load-extension`, it has nowhere to load one to, so the service worker
   * never registers and every capture comes back as a bare form. Asking for
   * headful gets the full Chromium, and `--headless=new` then makes that full
   * browser run without a display.
   */
  headless: false,
  args: [
    "--headless=new",
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
    "--no-sandbox",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  ],
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
});

/** The worker registers a moment after launch. */
async function extensionId() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const worker = context.serviceWorkers()[0];
    if (worker) return new URL(worker.url()).host;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The extension's service worker never registered.");
}

const id = await extensionId();
console.log(`  extension id: ${id}`);

/* -------------------------------------------------------------------------- */
/* Interception                                                               */
/* -------------------------------------------------------------------------- */

const formHtml = readFileSync(join(fixtures, "sample-application.html"), "utf8");

// The sample form, served from a host the manifest already covers.
await context.route(`${FORM_URL}*`, (route) =>
  route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: formHtml }),
);

// The same form on an unlisted host - no content script, by design.
await context.route(`${CAREERS_URL}*`, (route) =>
  route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: formHtml }),
);

/**
 * The API.
 *
 * Counted as well as stubbed, because whether these fire at all is the one thing
 * about this script that depends on Playwright internals: these requests come
 * from the extension's SERVICE WORKER, not from a page, and route interception
 * of worker traffic is not guaranteed. The count is reported at the end - if it
 * is zero, the popup's completeness meter will be missing from its screenshot
 * (the worker treats a failed vault fetch as "still connected, completion
 * unknown"), and that is the reason why rather than a mystery.
 */
let apiCalls = 0;

await context.route("https://jobsecuritymeter.com/api/vault*", (route) => {
  apiCalls += 1;
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(VAULT) });
});
await context.route("https://jobsecuritymeter.com/api/vault/field-map*", (route) => {
  apiCalls += 1;
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
});

/**
 * A page inside the extension, kept open for the whole run so we have somewhere
 * to call privileged APIs from.
 *
 * NOT the service worker. Playwright can evaluate in an MV3 worker, but that
 * context has no `chrome.*` bindings - `chrome.storage` comes back undefined.
 * An extension PAGE has the full API surface, so the popup's own document
 * doubles as the console we drive the browser from.
 */
const admin = await context.newPage();
await admin.goto(`chrome-extension://${id}/src/popup/index.html`);

// Seeded rather than performed: the connect handshake needs a real signed-in
// browser on jobsecuritymeter.com, which is not what these screenshots are of.
await admin.evaluate(
  async (session) => chrome.storage.local.set({ "jsm.session": session }),
  SESSION,
);
console.log("  session seeded");

/* -------------------------------------------------------------------------- */
/* Captures                                                                   */
/* -------------------------------------------------------------------------- */

const page = await context.newPage();
await page.goto(FORM_URL, { waitUntil: "domcontentloaded" });

/**
 * Foreground the form before every wait-and-shoot.
 *
 * The dock animates on requestAnimationFrame, and Chrome throttles rAF almost
 * to a stop in a hidden tab. With the admin page in front, the card would be
 * caught mid-reveal - a half-open panel, which looks like a rendering bug rather
 * than a product.
 */
async function foreground() {
  await page.bringToFront();
}

await foreground();

// `run_at: document_idle`, then the card's own reveal animation. There is
// nothing to wait on with a selector: the UI lives in a closed shadow root.
await page.waitForTimeout(3500);

const raw = {};

/**
 * Capture one raw image and keep it as base64 for the composition step.
 *
 * `target` may be a page or a locator. The popup is captured as its BODY
 * element, not as a viewport: a viewport screenshot of a 300px-wide document
 * pads or scrolls to whatever height was guessed, and the scrollbar ends up in
 * the composed frame.
 */
async function shoot(name, target = page) {
  const path = join(tmp, `${name}.png`);
  await target.screenshot({ path });
  raw[name] = readFileSync(path).toString("base64");
  console.log(`  captured ${name}`);
}

await shoot("card");

/**
 * The fill, triggered exactly as the popup triggers it.
 *
 * Sent to the tab rather than clicked, because the button is inside a closed
 * shadow root. The values that land, and the fields deliberately left alone,
 * are the real thing either way.
 */
const report = await admin.evaluate(async ({ data, host }) => {
  // Addressed by URL rather than by "the active tab": the page we are calling
  // from is a tab too, and it is the one in focus while this runs. `url` is
  // populated here because the manifest holds a host permission for it.
  const tabs = await chrome.tabs.query({});
  const target = tabs.find((tab) => (tab.url ?? "").includes(host));
  if (!target) throw new Error(`No tab found for ${host}`);
  return chrome.tabs.sendMessage(target.id, { type: "FILL_NOW", data });
}, { data: VAULT.data, host: "boards.greenhouse.io" });

if (!report) throw new Error("The content script did not answer FILL_NOW.");

console.log(
  `  fill: ${report.filled.length} filled, ${report.skipped.length} skipped`,
);

await foreground();

// Back to the top of the form before shooting. Filling moves focus down the
// page, so the natural resting place is the bottom - which photographs as a
// screen full of the fields that were deliberately left alone.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1200);
await shoot("filled");

/**
 * The focus chip.
 *
 * THE BLUR IN THE MIDDLE IS REQUIRED. The chip mounts on `focusin` and only
 * when the field is empty, and `locator.fill()` focuses the field itself - so
 * clearing the value and then calling `.focus()` on the same field fires no new
 * focusin at all, and the capture comes back with a focused field and no chip.
 * Focus has to leave and return.
 */
await page.locator("#emp").fill("");
await page.locator("#ln").focus();
await page.locator("#emp").focus();
await page.waitForTimeout(900);

/**
 * Assert the chip is actually painted, because a caption promising a button that
 * is not in the picture is the one failure worth failing the build over.
 *
 * Probed with elementFromPoint rather than a selector: every widget lives in a
 * CLOSED shadow root, so there is nothing to query - but a closed root still
 * reports its HOST at a hit-test, so "something other than the input is on top
 * of the input's right edge" is exactly the chip and nothing else.
 */
const chipPainted = await page.evaluate(() => {
  const field = document.querySelector("#emp");
  const rect = field.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.right - 20, rect.top + rect.height / 2);
  return hit !== null && hit !== field;
});

if (!chipPainted) {
  throw new Error("The focus chip did not appear - refusing to caption a screenshot that does not show it.");
}
console.log("  chip: painted over the field's right edge");

await shoot("chip");

/**
 * The popup, rendered as a page at its real width.
 *
 * A fresh page rather than the admin one, which has been evaluated in and whose
 * own render happened before the session existed. This one loads with the
 * session already in place, so it takes the connected path: it messages the
 * worker for status, which fetches the vault - the same round trip the toolbar
 * makes, and proof that the chain works end to end.
 */
const popup = await context.newPage();
await popup.setViewportSize({ width: 320, height: 400 });
await popup.goto(`chrome-extension://${id}/src/popup/index.html`);
await popup.waitForTimeout(2500);

const popupText = await popup.locator("body").innerText();
if (!popupText.includes(SESSION.email)) {
  throw new Error(`The popup did not render as connected. It says: ${popupText.replace(/\n/g, " / ")}`);
}
console.log(`  popup: ${popupText.replace(/\n/g, " / ")}`);

await shoot("popup", popup.locator("body"));
await popup.close();

// The unlisted careers page, with no on-page UI - the background the popup
// frame is composed over.
const careers = await context.newPage();
await careers.goto(CAREERS_URL, { waitUntil: "domcontentloaded" });
await careers.bringToFront();
await careers.waitForTimeout(1500);
await shoot("careers", careers);
await careers.close();

await admin.close();

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

const CAPTION_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px;
    display: flex; flex-direction: column; overflow: hidden;
    font: 600 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #f5f1e8; color: #181512;
  }
  .cap {
    flex: 0 0 auto; padding: 20px 34px 18px;
    display: flex; align-items: baseline; gap: 12px;
  }
  .cap b { font-size: 21px; font-weight: 700; letter-spacing: -0.02em; }
  .cap span { font-size: 15px; font-weight: 500; color: #6b655d; }
  .stage { flex: 1 1 auto; position: relative; overflow: hidden; }
  .stage img {
    position: absolute; top: 0; left: 0;
    width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px;
  }
  .popup {
    position: absolute; top: 16px; right: 26px;
    width: 300px; border-radius: 12px; overflow: hidden;
    box-shadow: 0 18px 44px rgba(24,21,18,.32), 0 0 0 1px rgba(24,21,18,.10);
  }
  .popup img { position: static; width: 300px; height: auto; }
`;

/**
 * One 1280x800 store frame: a caption strip over the real capture.
 *
 * The capture is 1280x800 itself and the strip takes ~70px, so the bottom of
 * the form is cropped. That is the right crop - the extension's UI is at the
 * top and right of the viewport, which is what the frame is about.
 */
async function compose({ name, background, overlay, title, subtitle }) {
  const frame = await context.newPage();
  await frame.setViewportSize(VIEWPORT);
  await frame.setContent(`
    <style>${CAPTION_CSS}</style>
    <div class="cap"><b>${title}</b><span>${subtitle}</span></div>
    <div class="stage">
      <img src="data:image/png;base64,${raw[background]}" />
      ${overlay ? `<div class="popup"><img src="data:image/png;base64,${raw[overlay]}" /></div>` : ""}
    </div>
  `);
  await frame.waitForTimeout(400);
  const out = join(outDir, `screenshot-${name}.png`);
  await frame.screenshot({ path: out });
  await frame.close();
  console.log(`  wrote ${name}`);
  return out;
}

console.log("\nComposing store frames…");

await compose({
  name: "card",
  background: "card",
  title: "It finds the form for you",
  subtitle: "No toolbar hunting — the card opens itself on a real application form.",
});
await compose({
  name: "filled",
  background: "filled",
  title: "One press fills the form",
  subtitle: `${report.filled.length} fields filled from your saved profile.`,
});
await compose({
  name: "chip",
  background: "chip",
  title: "Or fill one field at a time",
  subtitle: "A Fill button appears inside any field it recognises.",
});
// Background and overlay differ here: the popup drawn over the unlisted careers
// page it is there to serve.
await compose({
  name: "popup",
  background: "careers",
  overlay: "popup",
  title: "Works on company careers pages too",
  subtitle: "“Fill this page” runs anywhere, with no standing access.",
});

/* -------------------------------------------------------------------------- */
/* Promo tile                                                                 */
/* -------------------------------------------------------------------------- */

const icon = readFileSync(join(root, "public/icons/icon-128.png")).toString("base64");

const tile = await context.newPage();
await tile.setViewportSize({ width: 440, height: 280 });
await tile.setContent(`
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 440px; height: 280px; overflow: hidden;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 14px; text-align: center; padding: 0 30px;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      background: linear-gradient(160deg, #2d5f4f 0%, #1d2a25 100%);
      color: #f5f1e8;
    }
    /*
      The icon is a white bolt on a GREEN rounded square, and the tile behind it
      is also green - so on its own it reads as a smudge. The cream plate is what
      separates the mark from its background.
    */
    .plate {
      display: grid; place-items: center;
      width: 76px; height: 76px; border-radius: 20px;
      background: #f5f1e8;
      box-shadow: 0 8px 22px rgba(0,0,0,.22);
    }
    .plate img { width: 52px; height: 52px; }
    h1 { font-size: 27px; font-weight: 700; letter-spacing: -0.025em; line-height: 1.15; }
    p { font-size: 14px; font-weight: 500; color: rgba(245,241,232,.74); line-height: 1.45; }
  </style>
  <div class="plate"><img src="data:image/png;base64,${icon}" /></div>
  <h1>Job Autofill</h1>
  <p>Fill any job application from one saved profile.</p>
`);
await tile.waitForTimeout(400);
await tile.screenshot({ path: join(outDir, "promo-small-440x280.png") });
await tile.close();
console.log("  wrote promo-small-440x280.png");

/* -------------------------------------------------------------------------- */

writeFileSync(
  join(outDir, "fill-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

await context.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`
✔ store/assets/ regenerated

  ${report.filled.length} fields filled, ${report.skipped.length} skipped, ${apiCalls} API call(s) intercepted.

  The fill report is saved beside them as fill-report.json - check it, because
  it is the evidence the screenshots are of a working fill and not a blank form.
${
  apiCalls === 0
    ? `
  NOTE: no API call was intercepted, so the vault fetch in the service worker
  went to the real network and failed. Everything above is unaffected - the fill
  is driven by the fixture directly - but the popup's completeness meter will be
  absent from its screenshot, because the worker reports completion as unknown
  when that fetch fails.
`
    : ""
}`);
