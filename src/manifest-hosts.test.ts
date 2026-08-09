import { describe, expect, it } from "vitest";
import { ATS_MATCHES, WEB_ACCESSIBLE_RESOURCES } from "./manifest-hosts";

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
