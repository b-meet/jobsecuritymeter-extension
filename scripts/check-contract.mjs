#!/usr/bin/env node
/**
 * Guards src/shared/vault.ts against drift.
 *
 * That file is a copy of lib/shared/vault.ts in the private jobsecuritymeter
 * repo, and it is the contract between the API and this extension: rename a key
 * on one side only and autofill silently writes nothing for that field, with no
 * error anywhere.
 *
 * WHAT THIS CATCHES: someone editing the copy in this repo without meaning to.
 * The recorded hash only changes when a human deliberately re-syncs.
 *
 * WHAT IT CANNOT CATCH: the main repo changing first. This repo is public and
 * the main one is private, so CI here cannot read the source of truth. That
 * direction has to be caught by the main repo's own check, or by whoever edits
 * lib/shared/vault.ts remembering to re-sync. Documented as a known gap rather
 * than pretended away.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = join(root, "src/shared/vault.ts");
const record = join(root, ".vault-contract-sha256");

const actual = createHash("sha256").update(readFileSync(contract)).digest("hex");

if (process.argv.includes("--write") || !existsSync(record)) {
  writeFileSync(record, `${actual}\n`);
  console.log(`Recorded contract hash: ${actual}`);
  process.exit(0);
}

const expected = readFileSync(record, "utf8").trim();

if (actual !== expected) {
  console.error(
    [
      "src/shared/vault.ts has changed but the recorded hash has not.",
      "",
      `  expected ${expected}`,
      `  actual   ${actual}`,
      "",
      "If you re-synced it from lib/shared/vault.ts in the main repo on purpose,",
      "run `npm run check:contract -- --write` and commit the updated hash.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log("Vault contract unchanged.");
