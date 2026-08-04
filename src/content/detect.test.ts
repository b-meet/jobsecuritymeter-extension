import { describe, expect, it } from "vitest";
import { detectFields, type FieldMap } from "./detect";

function map(rules: FieldMap["sites"][number]["rules"], host = "boards.greenhouse.io"): FieldMap {
  return { version: 1, sites: [{ host, rules }] };
}

function form(html: string): HTMLElement {
  document.body.innerHTML = `<form>${html}</form>`;
  return document.body;
}

function keyFor(root: HTMLElement, selector: string): string | undefined {
  const target = root.querySelector(selector);
  return detectFields(root).find((m) => m.element === target)?.key;
}

describe("detectFields", () => {
  it("trusts the autocomplete attribute above everything else", () => {
    // The name says "field_123" and there is no label - autocomplete is the
    // only usable signal, and it is the one site authors write deliberately.
    const root = form(`<input name="field_123" autocomplete="given-name" />`);
    expect(keyFor(root, "input")).toBe("firstName");
  });

  it("handles section-prefixed autocomplete tokens", () => {
    const root = form(`<input autocomplete="shipping address-line1" />`);
    expect(keyFor(root, "input")).toBe("addressLine1");
  });

  it("reads a label bound with for=", () => {
    const root = form(`<label for="e">Email Address</label><input id="e" />`);
    expect(keyFor(root, "#e")).toBe("email");
  });

  it("reads a wrapping label", () => {
    const root = form(`<label>Phone Number<input id="p" /></label>`);
    expect(keyFor(root, "#p")).toBe("phone");
  });

  it("reads aria-label and placeholder", () => {
    const root = form(`
      <input id="a" aria-label="LinkedIn Profile" />
      <input id="b" placeholder="Postal code" />
    `);
    expect(keyFor(root, "#a")).toBe("linkedinUrl");
    expect(keyFor(root, "#b")).toBe("postalCode");
  });

  it("prefers the more specific keyword", () => {
    // "first name" must win over the bare "name" substring.
    const root = form(`<label for="f">First Name</label><input id="f" />`);
    expect(keyFor(root, "#f")).toBe("firstName");
  });

  it("never touches password, hidden or file inputs", () => {
    const root = form(`
      <input type="password" aria-label="Email" />
      <input type="hidden" autocomplete="given-name" />
      <input type="file" aria-label="Phone" />
    `);
    expect(detectFields(root)).toHaveLength(0);
  });

  it("skips disabled and readonly fields", () => {
    const root = form(`
      <input autocomplete="email" disabled />
      <input autocomplete="tel-national" readonly />
    `);
    expect(detectFields(root)).toHaveLength(0);
  });

  it("claims each vault key only once", () => {
    // A confirm-email pair must not produce two fills from one key.
    const root = form(`
      <label for="e1">Email</label><input id="e1" />
      <label for="e2">Confirm Email</label><input id="e2" />
    `);
    const emails = detectFields(root).filter((m) => m.key === "email");
    expect(emails).toHaveLength(1);
    expect(emails[0]!.element).toBe(root.querySelector("#e1"));
  });

  it("leaves unrecognised fields alone rather than guessing", () => {
    const root = form(`<label for="x">Favourite dinosaur</label><input id="x" />`);
    expect(detectFields(root)).toHaveLength(0);
  });

  describe("remote field map", () => {
    const rules = [{ key: "phone", selector: "#weird" }] as const;

    it("applies an override rule the heuristics would have missed", () => {
      // No label, no autocomplete, an opaque id - unmatchable without the rule.
      const root = form(`<input id="weird" />`);

      expect(detectFields(root, null, "boards.greenhouse.io")).toHaveLength(0);
      expect(detectFields(root, map(rules), "boards.greenhouse.io")[0]?.key).toBe("phone");
    });

    it("lets an override beat autocomplete", () => {
      // Overrides exist because the automatic path got the form wrong, so they
      // must outrank it - otherwise they are useless where they matter most.
      const root = form(`<input id="weird" autocomplete="email" />`);
      const found = detectFields(root, map(rules), "boards.greenhouse.io");

      expect(found).toHaveLength(1);
      expect(found[0]!.key).toBe("phone");
    });

    it("matches a host by suffix", () => {
      const root = form(`<input id="weird" />`);
      // One "greenhouse.io" block should cover every subdomain.
      expect(detectFields(root, map(rules, "greenhouse.io"), "job-boards.greenhouse.io")).toHaveLength(1);
    });

    it("ignores rules for a different host", () => {
      const root = form(`<input id="weird" />`);
      expect(detectFields(root, map(rules, "lever.co"), "boards.greenhouse.io")).toHaveLength(0);
    });

    it("does not let a suffix match on a lookalike domain", () => {
      const root = form(`<input id="weird" />`);
      // "notgreenhouse.io" must not match a "greenhouse.io" rule.
      expect(detectFields(root, map(rules, "greenhouse.io"), "notgreenhouse.io")).toHaveLength(0);
    });

    it("survives a malformed selector in the served map", () => {
      // The map is fetched at runtime, so a bad rule must not take down
      // detection for the whole page.
      const root = form(`<label for="e">Email</label><input id="e" />`);
      const broken = map([{ key: "phone", selector: "###" }]);

      expect(detectFields(root, broken, "boards.greenhouse.io")[0]?.key).toBe("email");
    });

    it("carries the control hint through to the caller", () => {
      const root = form(`<input id="weird" />`);
      const combo = map([{ key: "phone", selector: "#weird", control: "combo" as const }]);

      expect(detectFields(root, combo, "boards.greenhouse.io")[0]?.control).toBe("combo");
    });
  });

  it("finds textarea and select elements too", () => {
    const root = form(`
      <label for="c">Cover Letter</label><textarea id="c"></textarea>
      <label for="g">Gender</label><select id="g"><option></option></select>
    `);
    expect(keyFor(root, "#c")).toBe("defaultCoverLetter");
    expect(keyFor(root, "#g")).toBe("gender");
  });
});
