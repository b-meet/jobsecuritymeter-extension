import { describe, expect, it } from "vitest";
import {
  clampOffset,
  DEFAULT_DOCK,
  frameIsBigEnough,
  OFFER_THRESHOLD,
  placementFor,
  snap,
  toPixels,
} from "./dock";

const VIEWPORT = { width: 1000, height: 800 };

describe("snap", () => {
  it("springs to the left edge from the left half", () => {
    expect(snap({ x: 100, y: 400 }, VIEWPORT).edge).toBe("left");
  });

  it("springs to the right edge from the right half", () => {
    expect(snap({ x: 900, y: 400 }, VIEWPORT).edge).toBe("right");
  });

  it("keeps the vertical position it was dropped at", () => {
    expect(snap({ x: 900, y: 400 }, VIEWPORT).offset).toBeCloseTo(0.5);
  });

  it("pulls a drop near the top back below sticky headers", () => {
    // Dropped 8px from the top, where site headers and cookie banners live.
    const dock = snap({ x: 900, y: 8 }, VIEWPORT);
    expect(dock.offset).toBeGreaterThan(0.01);
    expect(dock.offset).toBeLessThan(0.2);
  });

  it("pulls a drop past the bottom back on screen", () => {
    expect(snap({ x: 900, y: 5000 }, VIEWPORT).offset).toBeLessThan(1);
  });

  it("survives a zero-height viewport rather than producing NaN", () => {
    const dock = snap({ x: 10, y: 10 }, { width: 0, height: 0 });
    expect(Number.isFinite(dock.offset)).toBe(true);
  });
});

describe("clampOffset", () => {
  it("falls back to the default for a corrupted stored value", () => {
    expect(clampOffset(Number.NaN)).toBe(DEFAULT_DOCK.offset);
    expect(clampOffset(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DOCK.offset);
  });
});

describe("toPixels", () => {
  it("sets only the edge it is docked to, so the other stays auto", () => {
    const right = toPixels({ edge: "right", offset: 0.5 }, VIEWPORT);
    expect(right.right).not.toBeNull();
    expect(right.left).toBeNull();

    const left = toPixels({ edge: "left", offset: 0.5 }, VIEWPORT);
    expect(left.left).not.toBeNull();
    expect(left.right).toBeNull();
  });

  it("resolves the stored fraction against the CURRENT viewport", () => {
    // The whole reason offsets are stored as fractions: the same dock has to
    // land somewhere sensible on a laptop and on a tall monitor.
    const laptop = toPixels({ edge: "right", offset: 0.5 }, { width: 1440, height: 800 });
    const monitor = toPixels({ edge: "right", offset: 0.5 }, { width: 2560, height: 1440 });

    expect(laptop.top).toBe(400);
    expect(monitor.top).toBe(720);
  });
});

describe("placementFor", () => {
  function fakeWindow(options: {
    top?: "self" | "other";
    scrollHeight: number;
    innerHeight: number;
    innerWidth?: number;
  }): Window {
    const win = {
      innerHeight: options.innerHeight,
      innerWidth: options.innerWidth ?? 1200,
      document: { documentElement: { scrollHeight: options.scrollHeight } },
    } as unknown as Window;

    Object.defineProperty(win, "self", { value: win });
    Object.defineProperty(win, "top", {
      value: options.top === "other" ? ({} as Window) : win,
    });
    return win;
  }

  it("pins to the viewport in the top frame", () => {
    expect(placementFor(fakeWindow({ scrollHeight: 3000, innerHeight: 800 }))).toBe("fixed");
  });

  it("pins to the viewport in an iframe that scrolls itself", () => {
    const win = fakeWindow({ top: "other", scrollHeight: 3000, innerHeight: 800 });
    expect(placementFor(win)).toBe("fixed");
  });

  it("anchors to the form in an iframe the parent scrolls", () => {
    // A content-sized embed: no scrollbar of its own, so nothing inside it can
    // stay fixed to the user's screen. This is the common Greenhouse case.
    const win = fakeWindow({ top: "other", scrollHeight: 2400, innerHeight: 2400 });
    expect(placementFor(win)).toBe("anchored");
  });
});

describe("frameIsBigEnough", () => {
  function sized(width: number, height: number): Window {
    return { innerWidth: width, innerHeight: height } as unknown as Window;
  }

  it("rejects tracking pixels and small widget frames", () => {
    expect(frameIsBigEnough(sized(1, 1))).toBe(false);
    expect(frameIsBigEnough(sized(300, 250))).toBe(false);
  });

  it("accepts a frame big enough to hold a form", () => {
    expect(frameIsBigEnough(sized(900, 700))).toBe(true);
  });
});

describe("OFFER_THRESHOLD", () => {
  it("is above one, so a listing page's search box cannot trigger the panel", () => {
    expect(OFFER_THRESHOLD).toBeGreaterThan(1);
  });
});
