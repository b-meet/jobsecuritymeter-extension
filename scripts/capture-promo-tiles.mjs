#!/usr/bin/env node
/**
 * Regenerates the store's promotional tiles, and nothing else.
 *
 *     npm i --no-save playwright && npx playwright install chromium   # first time
 *     npm run assets:promo
 *
 * `npm run assets` also writes these, but it needs a built `dist/` and drives
 * the real extension to photograph it. The tiles are drawn from the icon and
 * the palette alone (see promo-tiles.mjs), so this path needs neither a build
 * nor a session - which is what makes fixing a typo on the banner a one-command
 * job rather than a rebuild.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TILES, renderTile } from "./promo-tiles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "store/assets");
const iconPath = join(root, "public/icons/icon-128.png");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(`
✖ Playwright is not installed.

  It is deliberately not a dependency of this package - it is a browser harness
  the extension does not need to build, test, or ship. Install it just to
  regenerate the tiles:

      npm i --no-save playwright && npx playwright install chromium
      npm run assets:promo
`);
  process.exit(1);
}

if (!existsSync(iconPath)) {
  console.error(`✖ ${iconPath} is missing - the tiles are built around it.`);
  process.exit(1);
}

const icon = readFileSync(iconPath).toString("base64");
/**
 * CHROMIUM_PATH is an escape hatch for a machine that already has a Chromium
 * (a CI image, a sandbox) and no Playwright-managed download. Unset - the
 * normal case - Playwright uses the browser `npx playwright install` fetched.
 */
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

for (const tile of TILES) {
  await renderTile(page, tile, icon, join(outDir, tile.file));
  console.log(`  wrote ${tile.file}`);
}

await browser.close();
console.log("\n✔ store/assets promo tiles regenerated\n");
