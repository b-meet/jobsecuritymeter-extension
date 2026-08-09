import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ATS_MATCHES, ICONS, ICON_SIZES, WEB_ACCESSIBLE_RESOURCES } from "./manifest-hosts";

describe("web_accessible_resources", () => {
  it("lets the content script load on a site we only inject into", () => {
    // THE BUG THIS PINS. The content script entry is a stub that dynamically
    // imports the real module, and that import is governed by this key. The
    // bundler's own entry is scoped to the ATS list, so on a company careers
    // page executeScript ran the stub, Chrome denied the import, and the script
    // silently never ran - with executeScript reporting success throughout.
    const broad = WEB_ACCESSIBLE_RESOURCES.find((entry) => entry.matches.includes("<all_urls>"));

    expect(broad, "no entry covers sites outside the ATS list").toBeDefined();
    expect(broad!.resources.some((resource) => resource.startsWith("assets/"))).toBe(true);
  });

  it("exposes the built bundle and not the source tree", () => {
    // Listing `src/content/*` here made the bundler treat every file in that
    // directory as an entry point and emit it - test files and all - into the
    // shipped package. The loader chain is entirely under assets/, so it bought
    // nothing for it.
    for (const entry of WEB_ACCESSIBLE_RESOURCES) {
      for (const resource of entry.resources) {
        expect(resource.startsWith("src/"), resource).toBe(false);
      }
    }
  });
});

describe("ATS_MATCHES", () => {
  it("covers the platforms that host the form on a per-company subdomain", () => {
    for (const host of ["keka", "zohorecruit", "darwinbox", "greenhouse", "lever", "workable"]) {
      expect(ATS_MATCHES.some((match) => match.includes(host)), host).toBe(true);
    }
  });

  it("is an allowlist, never a blanket match", () => {
    // Host access is what <all_urls> would grant here, and it is the difference
    // between a routine store review and a deep one.
    expect(ATS_MATCHES).not.toContain("<all_urls>");
    for (const match of ATS_MATCHES) {
      expect(match.startsWith("https://"), match).toBe(true);
      expect(match, match).not.toBe("https://*/*");
    }
  });
});

describe("icons", () => {
  it("declares every size the browser and the store ask for", () => {
    // 16 is the toolbar, 128 is the store listing. Miss either and the
    // extension shows up as a grey jigsaw piece in the one place the whole
    // flow depends on the user finding it.
    for (const size of [16, 32, 48, 128]) {
      expect(ICONS[String(size)], `no icon declared at ${size}px`).toBeTruthy();
    }
  });

  it("points at files that actually exist", () => {
    // The failure this catches is a manifest that references a path nothing
    // ships to. Chrome loads such an extension without complaint and simply
    // draws nothing, so a declaration on its own proves very little.
    for (const size of ICON_SIZES) {
      // Resolved from the project root (vitest's cwd) rather than from
      // import.meta.url, which the transform rewrites.
      const path = resolve(process.cwd(), "public", ICONS[String(size)]!);
      expect(existsSync(path), `${ICONS[String(size)]} is declared but not in public/`).toBe(true);
    }
  });
});
