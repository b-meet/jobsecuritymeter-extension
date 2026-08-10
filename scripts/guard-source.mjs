#!/usr/bin/env node
/**
 * Source integrity guard.
 *
 * WHY THIS EXISTS. In July 2026 an obfuscated loader was appended to
 * postcss.config.mjs in the main repo, and later to this repo's
 * check-contract.mjs. Both hid the same way: the payload sat on the end of an
 * existing line behind several hundred spaces, so every diff view showed the
 * line as unchanged and the file as "+4 -1". It survived three weeks of review
 * and ran on every build.
 *
 * Reviewing diffs harder was never going to catch that - the concealment
 * defeats human review by design. A machine counting spaces catches it every
 * time, which is the whole idea here.
 *
 * DEPENDENCY-FREE ON PURPOSE. Node built-ins only. A guard that imports from
 * node_modules can be disabled by the thing it is meant to detect.
 *
 * Runs over `git ls-files`, so it checks exactly what would be committed and
 * pushed, and never wanders into node_modules or build output.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

/** Longest run of spaces we accept inside a line. The attack used 250 and ~1000. */
const MAX_SPACE_RUN = 100;

/** Longest line we accept in hand-written source, to catch a minified payload. */
const MAX_LINE_LENGTH = 3000;

/** Extensions worth checking. Everything else is data or binary. */
const CHECKED = /\.(m?[jt]sx?|cjs|json|ya?ml|sh|mjs)$/;

/**
 * Paths allowed to be exempt from a given rule.
 *
 * Kept deliberately tiny. Every entry is a hole, so each one needs a reason
 * that outlives whoever added it.
 */
const EXEMPT = {
  // Lockfiles are generated, enormous, and legitimately hold long lines.
  longLine: [/package-lock\.json$/, /\.min\.[jc]?js$/, /\.map$/],
  // Nothing is exempt from these two. If a real need appears, it belongs in
  // review, not in a list.
  spaceRun: [],
  obfuscation: [],
};

const RULES = [
  {
    id: "spaceRun",
    test: (line) => new RegExp(` {${MAX_SPACE_RUN},}`).test(line),
    why: `a run of ${MAX_SPACE_RUN}+ spaces - the concealment used to hide an appended payload off the edge of a diff`,
  },
  {
    id: "obfuscation",
    test: (line) => /global\[_\$_|_\$_[0-9a-f]{4}|_\$[A-Za-z]+ToArr/.test(line),
    why: "an obfuscated-loader signature",
  },
  {
    id: "obfuscation",
    test: (line) => /createRequire\(import\.meta\.url\)/.test(line),
    why: "a createRequire shim, which rebuilds CommonJS capability inside an ES module. Legitimate uses exist, but this file is not expected to need one - if it genuinely does, add it to EXEMPT with a reason",
  },
  {
    id: "longLine",
    test: (line) => line.length > MAX_LINE_LENGTH,
    why: `a single line over ${MAX_LINE_LENGTH} characters, long enough to hide a minified payload`,
  },
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter((name) => name && CHECKED.test(name));
}

const findings = [];

for (const file of trackedFiles()) {
  let text;
  try {
    // Skip anything implausibly large for source; reading it costs more than
    // the check is worth and it is almost certainly generated.
    if (statSync(file).size > 8 * 1024 * 1024) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const lines = text.split("\n");

  for (const rule of RULES) {
    if (EXEMPT[rule.id]?.some((pattern) => pattern.test(file))) continue;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!rule.test(line)) continue;

      findings.push({ file, line: i + 1, why: rule.why, length: line.length });
      break; // One report per rule per file is enough to fail the build.
    }
  }
}

if (findings.length === 0) {
  console.log(`Source integrity OK (${trackedFiles().length} tracked files checked).`);
  process.exit(0);
}

console.error("\nSOURCE INTEGRITY CHECK FAILED\n");
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  (line is ${f.length} chars)`);
  console.error(`    ${f.why}\n`);
}
console.error("If a finding is legitimate, exempt it deliberately in");
console.error("scripts/guard-source.mjs and say why in the commit message.\n");
process.exit(1);
