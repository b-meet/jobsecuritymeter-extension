import { describe, expect, it, vi } from "vitest";

/**
 * A content script outlives its extension.
 *
 * Reloading or updating the extension does NOT unload the scripts already
 * injected into open tabs. They stay resident holding a dead `chrome.runtime`,
 * and every call from then on throws "Extension context invalidated" - which is
 * what a developer sees after every rebuild, and what a user sees for a moment
 * after the extension auto-updates under them.
 */
describe("chrome.runtime.sendMessage when the extension has been reloaded", () => {
  it("throws SYNCHRONOUSLY, so .catch() alone never sees it", async () => {
    // This is the whole reason ask() needs a try/catch as well as a .catch().
    // Pinning the platform behaviour here so the try/catch cannot be tidied
    // away by someone who reads it as redundant.
    const sendMessage = vi.fn((): Promise<unknown> => {
      throw new Error("Extension context invalidated.");
    });

    // The shape ask() used to have: only a rejection handler.
    const catchOnly = () => sendMessage().catch(() => ({ ok: false }));
    expect(catchOnly).toThrow("Extension context invalidated");

    // The shape it has now.
    const guarded = async () => {
      try {
        return await sendMessage();
      } catch {
        return { ok: false, error: "Job Autofill was reloaded - refresh the page." };
      }
    };
    await expect(guarded()).resolves.toEqual({
      ok: false,
      error: "Job Autofill was reloaded - refresh the page.",
    });
  });

  it("is recognised from its message", async () => {
    const { isContextInvalidated } = await import("./context");

    expect(isContextInvalidated(new Error("Extension context invalidated."))).toBe(true);
    expect(isContextInvalidated(new Error("Failed to fetch"))).toBe(false);
    expect(isContextInvalidated("not an error")).toBe(false);
    expect(isContextInvalidated(undefined)).toBe(false);
  });
});
