#!/usr/bin/env node
/**
 * Builds and zips the extension for a Chrome Web Store upload.
 *
 * The zip is the easy part. The reason this is a script rather than a line in
 * the README is the four things it refuses to package, each of which is a
 * mistake you cannot take back once a reviewer has the file:
 *
 *   1. A DEV BUILD. `externally_connectable` is what decides who may hand this
 *      extension a Supabase session, and a development manifest trusts
 *      http://localhost. Published, that accepts a session from any dev server
 *      on the user's machine - including one a malicious page talks to. Both
 *      manifest.ts and shared/config.ts carry a comment saying this must never
 *      ship; this is the check that makes the comment true.
 *
 *   2. A BUILD WITH NO SUPABASE KEY. `VITE_SUPABASE_PUBLISHABLE_KEY` is read
 *      at build time and defaults to "". An empty key produces an extension
 *      that installs, opens, and fails on the first token refresh - which is
 *      exactly the kind of fault that comes back as a one-star review rather
 *      than a crash report.
 *
 *   3. A BUILD MISSING ITS ICONS. Chrome draws a grey jigsaw piece instead,
 *      and the listing renders the 128 as the product's face.
 *
 *   4. TEST FILES. The bundler has emitted `*.test.ts` into the package before
 *      now (see manifest-hosts.ts on why web_accessible_resources is scoped to
 *      `assets/*`). Shipping test code is not a rejection, but it is source you
 *      did not mean to publish.
 *
 * No dependencies, deliberately - same reasoning as guard-source.mjs. Shells
 * out to `zip`, which is present on macOS and every Linux CI image.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const outDir = join(root, "build");

/** Every file under a directory, as paths relative to it. */
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

function fail(title, detail) {
  console.error(`\n✖ ${title}\n`);
  for (const line of detail) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Build                                                                      */
/* -------------------------------------------------------------------------- */

// A stale dist is its own trap: you fix something, forget to rebuild, and ship
// the version you were trying to replace. Always build.
console.log("Building…\n");
rmSync(dist, { recursive: true, force: true });
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

if (!existsSync(join(dist, "manifest.json"))) {
  fail("The build produced no dist/manifest.json.", ["Nothing was packaged."]);
}

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const files = walk(dist);

/* -------------------------------------------------------------------------- */
/* Refusals                                                                   */
/* -------------------------------------------------------------------------- */

// 1. Dev build. Checked against the whole manifest rather than one key, so a
//    loopback origin appearing in some future key is caught too.
const manifestText = JSON.stringify(manifest);
const loopback = ["localhost", "127.0.0.1"].filter((host) => manifestText.includes(host));

if (loopback.length > 0) {
  fail("This is a DEVELOPMENT build. It must not be uploaded.", [
    `The manifest references ${loopback.join(" and ")}.`,
    "",
    "`externally_connectable` decides who may hand this extension a Supabase",
    "session. Published with localhost trusted, it would accept one from any",
    "dev server running on the user's machine.",
    "",
    "Build with NODE_ENV unset and no --mode development, then package again.",
  ]);
}

// 2. Missing Supabase key. The key is inlined into the bundle at build time, so
//    its absence is only visible by looking at the emitted JS.
const bundles = files.filter((file) => file.endsWith(".js"));
const bundleText = bundles.map((file) => readFileSync(join(dist, file), "utf8")).join("\n");

// Supabase publishable keys come in two shapes: the current `sb_publishable_`
// form and the legacy anon JWT. Matching on the prefix rather than a length
// keeps this working when the key is rotated.
//
// The match is CAPTURED rather than tested, because the follow-up question -
// "is this a real key or a stand-in?" - has to be asked of the key and nothing
// else. Scanning the whole bundle for /placeholder/i fails on this very
// codebase: content/detect.ts reads the `placeholder` attribute when it scores a
// field, so the word is in every build.
const key = bundleText.match(/sb_publishable_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_.-]{30,}/)?.[0];

if (!key) {
  fail("The bundle carries no Supabase publishable key.", [
    "VITE_SUPABASE_PUBLISHABLE_KEY was empty or unset at build time, so the",
    "extension will install and then fail on its first token refresh.",
    "",
    "Set it in .env.local (the same publishable key the website ships) and",
    "package again. The service role key must never appear in this repo.",
  ]);
}

if (/placeholder|example|dummy|changeme|xxxx|test[_-]?key/i.test(key)) {
  fail("The Supabase key in the bundle is a stand-in, not a real key.", [
    `found: ${key}`,
    "",
    "Set the real VITE_SUPABASE_PUBLISHABLE_KEY and package again.",
  ]);
}

// 3. Icons. The manifest declares them; this checks they arrived.
const declaredIcons = [...new Set([...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {})])];
const missingIcons = declaredIcons.filter((icon) => !existsSync(join(dist, icon)));

if (missingIcons.length > 0) {
  fail("The manifest declares icons that are not in the package.", [
    ...missingIcons.map((icon) => `missing: ${icon}`),
    "",
    "Chrome would draw a grey jigsaw piece in the toolbar, and the listing",
    "renders the 128 as the product's face.",
  ]);
}

// 4. Files that have no business in a published package.
const junk = files.filter((file) => /\.(test|spec)\.[jt]s$/.test(file) || file.endsWith(".map"));

if (junk.length > 0) {
  fail("Test files or source maps were emitted into the package.", [
    ...junk.map((file) => `  ${file}`),
    "",
    "See manifest-hosts.ts: web_accessible_resources must stay scoped to",
    "`assets/*`, or the bundler treats every file in src/content as an entry.",
  ]);
}

/* -------------------------------------------------------------------------- */
/* Zip                                                                        */
/* -------------------------------------------------------------------------- */

// Zipped from INSIDE dist, so manifest.json sits at the archive root. A zip
// containing a `dist/` folder is rejected by the dashboard with a message that
// does not say why.
mkdirSync(outDir, { recursive: true });

const zipName = `job-autofill-${manifest.version}.zip`;
const zipPath = join(outDir, zipName);
rmSync(zipPath, { force: true });

// -X drops the extra attributes (uid/gid, extended attrs) that make an archive
// differ between machines for no reason.
execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: dist, stdio: "inherit" });

const kb = (statSync(zipPath).size / 1024).toFixed(0);

console.log(`\n✔ ${relative(root, zipPath)}  (${kb} kB, ${files.length} files)`);
console.log(`
  name     ${manifest.name}
  version  ${manifest.version}
  min      Chrome ${manifest.minimum_chrome_version ?? "(unset)"}

Next: store/SUBMISSION.md has the text to paste into the dashboard.
`);
