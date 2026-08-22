/**
 * The Chrome Web Store promotional tiles.
 *
 * SEPARATE FROM capture-store-assets.mjs ON PURPOSE. Those captures are
 * photographs of the built extension - they need `dist/`, a real Chromium with
 * the extension loaded, and a seeded session. These two tiles are drawn from
 * the icon and the brand palette alone, so they can be regenerated with nothing
 * but a browser (`npm run assets:promo`), which is what makes it practical to
 * touch them without rebuilding first.
 *
 * WHY THE MARQUEE EXISTS AT ALL. The small tile is required for the listing;
 * the marquee is required to be *considered* for featuring. That matters beyond
 * vanity: a new developer's extension is not trusted by Enhanced Safe Browsing
 * for its first months, and the shortlist of things a publisher can actively do
 * about that - rather than wait - is compliance, a complete listing, and the
 * store's own trust surfaces. A missing asset that disqualifies the item from
 * one of them is the cheapest of those to fix.
 *
 * Both tiles are rendered as HTML and screenshotted, so there is no image
 * dependency, and the palette here is the site's: green #2d5f4f into ink
 * #1d2a25, cream #f5f1e8 for type.
 */

/**
 * Google rejects tiles whose content runs to the edge, and crops them at
 * several sizes. Everything meaningful stays inside this inset.
 */
const SAFE_INSET = { small: 30, marquee: 72 };

/** The shared look: gradient, cream type, and the plate the icon sits on. */
function baseCss(width, height) {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: ${width}px; height: ${height}px; overflow: hidden;
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
      background: #f5f1e8;
      box-shadow: 0 8px 22px rgba(0,0,0,.22);
    }
  `;
}

/**
 * 440x280. Shown in search results and in the category grids, often at well
 * under half this size, so it carries the mark, the name, and one line.
 */
export function smallTile(icon) {
  return `
    <style>
      ${baseCss(440, 280)}
      body {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; text-align: center; padding: 0 ${SAFE_INSET.small}px;
      }
      .plate { width: 76px; height: 76px; border-radius: 20px; }
      .plate img { width: 52px; height: 52px; }
      h1 { font-size: 27px; font-weight: 700; letter-spacing: -0.025em; line-height: 1.15; }
      p { font-size: 14px; font-weight: 500; color: rgba(245,241,232,.74); line-height: 1.45; }
    </style>
    <div class="plate"><img src="data:image/png;base64,${icon}" /></div>
    <h1>Job Autofill</h1>
    <p>Fill any job application from one saved profile.</p>
  `;
}

/**
 * 1400x560. The featured banner, and the widest thing the store will ever draw
 * of this extension.
 *
 * Two columns rather than the small tile's stack: at this aspect ratio a
 * centred lockup leaves two lakes of empty gradient. The right column is a
 * flat drawing of the one moment the product is about - a form field that
 * filled itself, next to one that deliberately did not - which is also the
 * honest summary of the whole design. It is drawn, not photographed, because
 * this is a banner rather than a screenshot; the screenshots on the same
 * listing are the real thing.
 */
export function marqueeTile(icon) {
  return `
    <style>
      ${baseCss(1400, 560)}
      body {
        display: grid; grid-template-columns: 1fr 1fr; align-items: center;
        gap: 64px; padding: 0 ${SAFE_INSET.marquee}px;
      }
      .lockup { display: flex; align-items: center; gap: 20px; }
      .plate { width: 88px; height: 88px; border-radius: 24px; }
      .plate img { width: 60px; height: 60px; }
      .name { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; }
      .by { margin-top: 4px; font-size: 15px; font-weight: 600; color: rgba(245,241,232,.6); }
      h1 {
        margin-top: 34px; font-size: 46px; font-weight: 700;
        letter-spacing: -0.03em; line-height: 1.1; max-width: 15ch;
      }
      p {
        margin-top: 18px; font-size: 18px; font-weight: 500; line-height: 1.5;
        color: rgba(245,241,232,.76); max-width: 34ch;
      }
      .card {
        background: #f7f9fc; border-radius: 22px; padding: 30px;
        box-shadow: 0 26px 60px rgba(0,0,0,.3); color: #1a1a1a;
      }
      .label { font-size: 13px; font-weight: 700; color: #6b7280; }
      .field {
        margin-top: 8px; display: flex; align-items: center; justify-content: space-between;
        gap: 12px; border: 1px solid #d4dae6; border-radius: 12px;
        padding: 15px 16px; font-size: 17px; background: #fff;
      }
      .field + .label { margin-top: 22px; }
      .tick { color: #2d5f4f; font-size: 18px; font-weight: 700; }
      .asks { border-color: #e6c76a; background: #fdfaf3; color: #6b7280; font-size: 15px; }
      .flag { color: #a8791f; font-weight: 700; font-size: 13px; }
    </style>

    <div>
      <div class="lockup">
        <div class="plate"><img src="data:image/png;base64,${icon}" /></div>
        <div>
          <div class="name">Job Autofill</div>
          <div class="by">by Job Security Meter</div>
        </div>
      </div>
      <h1>The same answers, on every application form.</h1>
      <p>
        Fills Greenhouse, Lever, Ashby, Workday and more from one saved profile.
        It never submits anything, and it leaves a field blank rather than guess.
      </p>
    </div>

    <div class="card">
      <div class="label">Most recent employer &amp; title</div>
      <div class="field"><span>Northgate Retail &middot; Data Analyst</span><span class="tick">&check;</span></div>
      <div class="label">Notice period</div>
      <div class="field"><span>One month</span><span class="tick">&check;</span></div>
      <div class="label">Why do you want this role? <span class="flag">&middot; needs your eyes</span></div>
      <div class="field asks"><span>Left for you to write.</span></div>
    </div>
  `;
}

/** Every tile this module knows how to draw, and where each one goes. */
export const TILES = [
  { file: "promo-small-440x280.png", width: 440, height: 280, html: smallTile },
  { file: "promo-marquee-1400x560.png", width: 1400, height: 560, html: marqueeTile },
];

/**
 * Draws one tile into an existing page. Takes the page rather than a browser so
 * the capture script can reuse the context it already has the extension loaded
 * into, and the standalone script can use a plain one.
 */
export async function renderTile(page, tile, icon, outPath) {
  await page.setViewportSize({ width: tile.width, height: tile.height });
  await page.setContent(tile.html(icon));
  // Give the data-URI icon a beat to decode; a screenshot taken too early gets
  // an empty plate, and it is not obvious in the file name that it went wrong.
  await page.waitForTimeout(400);
  await page.screenshot({ path: outPath });
}
