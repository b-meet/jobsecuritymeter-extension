import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The origin trust boundary.
 *
 * isTrustedOrigin decides who may hand this extension a Supabase session, so
 * these tests exist to make a future "just add one more origin" change think
 * twice. The production case in particular must never accept loopback.
 */

async function loadWith(dev: boolean, siteOrigin?: string) {
  vi.resetModules();
  vi.stubEnv("DEV", dev);
  if (siteOrigin) vi.stubEnv("VITE_SITE_ORIGIN", siteOrigin);
  return import("./config");
}

describe("isTrustedOrigin", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("production build", () => {
    it("accepts the real site", async () => {
      const { isTrustedOrigin } = await loadWith(false);
      expect(isTrustedOrigin("https://jobsecuritymeter.com")).toBe(true);
    });

    it("REFUSES localhost", async () => {
      // The whole point of gating the dev allowance. A published extension that
      // accepted this would take a session from any dev server on the machine.
      const { isTrustedOrigin } = await loadWith(false);
      expect(isTrustedOrigin("http://localhost:3000")).toBe(false);
      expect(isTrustedOrigin("http://127.0.0.1:3000")).toBe(false);
    });

    it("refuses a lookalike domain", async () => {
      const { isTrustedOrigin } = await loadWith(false);
      expect(isTrustedOrigin("https://jobsecuritymeter.com.evil.test")).toBe(false);
      expect(isTrustedOrigin("https://notjobsecuritymeter.com")).toBe(false);
    });

    it("refuses plain http on the real host", async () => {
      // Scheme is part of the origin; downgrading it must not pass.
      const { isTrustedOrigin } = await loadWith(false);
      expect(isTrustedOrigin("http://jobsecuritymeter.com")).toBe(false);
    });

    it("refuses a subdomain", async () => {
      const { isTrustedOrigin } = await loadWith(false);
      expect(isTrustedOrigin("https://staging.jobsecuritymeter.com")).toBe(false);
    });
  });

  describe("development build", () => {
    it("accepts loopback on any port", async () => {
      // The Next dev server's port moves around, and match patterns ignore
      // ports anyway.
      const { isTrustedOrigin } = await loadWith(true);
      expect(isTrustedOrigin("http://localhost:3000")).toBe(true);
      expect(isTrustedOrigin("http://localhost:3001")).toBe(true);
      expect(isTrustedOrigin("http://127.0.0.1:8080")).toBe(true);
    });

    it("still accepts production", async () => {
      const { isTrustedOrigin } = await loadWith(true);
      expect(isTrustedOrigin("https://jobsecuritymeter.com")).toBe(true);
    });

    it("does not accept an arbitrary origin", async () => {
      // "dev build" is not "trust anything".
      const { isTrustedOrigin } = await loadWith(true);
      expect(isTrustedOrigin("https://evil.test")).toBe(false);
    });

    it("does not accept a host merely containing localhost", async () => {
      const { isTrustedOrigin } = await loadWith(true);
      expect(isTrustedOrigin("https://localhost.evil.test")).toBe(false);
    });
  });

  it("refuses empty and malformed origins", async () => {
    const { isTrustedOrigin } = await loadWith(true);
    expect(isTrustedOrigin(undefined)).toBe(false);
    expect(isTrustedOrigin("")).toBe(false);
    expect(isTrustedOrigin("not a url")).toBe(false);
  });
});
