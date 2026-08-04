import { describe, expect, it } from "vitest";
import { detectFields } from "./detect";

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

  it("finds textarea and select elements too", () => {
    const root = form(`
      <label for="c">Cover Letter</label><textarea id="c"></textarea>
      <label for="g">Gender</label><select id="g"><option></option></select>
    `);
    expect(keyFor(root, "#c")).toBe("defaultCoverLetter");
    expect(keyFor(root, "#g")).toBe("gender");
  });
});
