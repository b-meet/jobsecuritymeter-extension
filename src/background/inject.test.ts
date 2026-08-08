import { describe, expect, it } from "vitest";
import { patternFor } from "./inject";

describe("patternFor", () => {
  it("covers the whole origin, not just the page", () => {
    // A careers page is rarely a single URL - the form usually lives a couple
    // of paths deeper, and a per-URL grant would miss it.
    expect(patternFor("https://careers.acme.com/jobs/1234/apply")).toBe("https://careers.acme.com/*");
  });

  it("keeps the scheme, so an https grant does not cover http", () => {
    expect(patternFor("http://careers.acme.com/apply")).toBe("http://careers.acme.com/*");
  });

  it("does not widen to a parent domain", () => {
    // Granting acme.com because the user applied at careers.acme.com would hand
    // us their logged-in app on the same domain.
    expect(patternFor("https://careers.acme.com/x")).not.toBe("https://acme.com/*");
  });

  it("refuses schemes no job application uses", () => {
    for (const url of [
      "file:///Users/me/form.html",
      "chrome://extensions",
      "chrome-extension://abc/popup.html",
      "data:text/html,<form>",
      "about:blank",
    ]) {
      expect(patternFor(url), url).toBeNull();
    }
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(patternFor("")).toBeNull();
    expect(patternFor("not a url")).toBeNull();
  });
});
