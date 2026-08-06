import { STORAGE_KEYS } from "@/shared/config";

/**
 * Where the on-page handle lives, and how it gets there.
 *
 * Everything in the top half of this file is pure geometry so it can be tested
 * without a browser. The storage helpers at the bottom are deliberately
 * failure-tolerant: a handle that cannot remember where it was parked is a
 * small annoyance, but one that throws during mount takes the whole overlay
 * down and autofill with it.
 */

export type Edge = "left" | "right";

/**
 * `offset` is a FRACTION of the viewport height, not a pixel value.
 *
 * Storing pixels would put the handle off-screen the moment the user parked it
 * low on a tall monitor and then opened the same board on a laptop.
 */
export type DockPosition = { edge: Edge; offset: number };

export const DEFAULT_DOCK: DockPosition = { edge: "right", offset: 0.4 };

/**
 * How many confident field matches before we put anything on screen.
 *
 * Job boards serve their listing pages and their application forms from the
 * same hosts, and a listing page still has a search box or two. Three matches
 * is the cheapest signal that we are looking at a real application form and not
 * somebody browsing openings.
 */
export const OFFER_THRESHOLD = 3;

/**
 * Keeps the handle clear of the very top and bottom of the viewport, where it
 * would collide with sticky site headers and cookie banners.
 */
const MIN_OFFSET = 0.08;
const MAX_OFFSET = 0.86;

export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return DEFAULT_DOCK.offset;
  return Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, offset));
}

/**
 * Resolve a free-dragged point to the edge it should spring back to.
 *
 * The handle never rests where it was dropped - it always returns to an edge,
 * which is what stops it from ending up over the form itself.
 */
export function snap(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
): DockPosition {
  const edge: Edge = point.x < viewport.width / 2 ? "left" : "right";
  return { edge, offset: clampOffset(point.y / viewport.height) };
}

export type Placement = "fixed" | "anchored";

/**
 * Can this frame pin something to the user's screen?
 *
 * THE CENTRAL LIMITATION OF THIS WHOLE FEATURE. Greenhouse and Lever boards are
 * usually embedded as cross-origin iframes on a company's careers page, and the
 * host page is not in `host_permissions`, so our content script runs ONLY
 * inside the iframe.
 *
 * Those embeds are typically resized to their content height, which means the
 * iframe has no scrollbar of its own - the parent page does the scrolling. In
 * that arrangement `position: fixed` inside the iframe resolves against the
 * iframe's full height, not the visible window, so a "docked" handle would sit
 * halfway down the document and scroll out of view like any other element.
 *
 * There is no fix available from inside the frame: it cannot read the parent's
 * scroll position, and it never will be able to cross-origin. So rather than
 * pretending, we detect the case and anchor to the form instead. The focus chip
 * is what covers the user once they are past that point, because it is
 * positioned against the field they are actually in.
 */
export function placementFor(win: Window = window): Placement {
  // Reading `top` and comparing window references is allowed cross-origin;
  // reading anything *inside* `top` would not be.
  if (win.top === win.self) return "fixed";

  const scrollable = win.document.documentElement.scrollHeight > win.innerHeight + 40;
  return scrollable ? "fixed" : "anchored";
}

/**
 * Frames too small to hold the UI without covering the form.
 *
 * Ad slots, tracking pixels and small widget iframes all match our ATS hosts
 * often enough to matter, and `all_frames` puts the content script in every one
 * of them.
 */
export function frameIsBigEnough(win: Window = window): boolean {
  return win.innerWidth >= 380 && win.innerHeight >= 240;
}

/** Pixel position for a dock, given the frame's current viewport. */
export function toPixels(
  dock: DockPosition,
  viewport: { width: number; height: number },
): { top: number; left: number | null; right: number | null } {
  const MARGIN = 16;
  return {
    top: Math.round(clampOffset(dock.offset) * viewport.height),
    left: dock.edge === "left" ? MARGIN : null,
    right: dock.edge === "right" ? MARGIN : null,
  };
}

/* ---------------------------------------------------------------- storage */

function isDock(value: unknown): value is DockPosition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DockPosition>;
  return (
    (candidate.edge === "left" || candidate.edge === "right") &&
    typeof candidate.offset === "number"
  );
}

export async function loadDock(): Promise<DockPosition> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.dock);
    const value = stored[STORAGE_KEYS.dock];
    if (!isDock(value)) return DEFAULT_DOCK;
    return { edge: value.edge, offset: clampOffset(value.offset) };
  } catch {
    return DEFAULT_DOCK;
  }
}

export async function saveDock(dock: DockPosition): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.dock]: dock });
  } catch {
    // Parking position is not worth surfacing an error for.
  }
}

async function readTucked(): Promise<string[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.tuckedOrigins);
  const value = stored[STORAGE_KEYS.tuckedOrigins];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Has the user tucked the handle away on this origin?
 *
 * NOT THE SAME AS TURNING IT OFF, and that distinction is the whole point. An
 * earlier version treated "not on this site" as permanent, which left people
 * with no way back short of clearing extension storage - the feature was simply
 * gone and looked broken. Tucked means collapsed to a small tab against the
 * window edge: out of the way of the form, still one click from returning.
 *
 * A read that throws resolves to TUCKED rather than open. Being wrong in that
 * direction shows a quiet edge tab on a page where the user wanted one; being
 * wrong the other way pops a card back onto a form they had already cleared.
 */
export async function isTucked(origin: string): Promise<boolean> {
  try {
    return (await readTucked()).includes(origin);
  } catch {
    return true;
  }
}

export async function setTucked(origin: string, tucked: boolean): Promise<void> {
  try {
    const current = await readTucked();
    if (current.includes(origin) === tucked) return;

    const next = tucked ? [...current, origin] : current.filter((entry) => entry !== origin);
    await chrome.storage.local.set({ [STORAGE_KEYS.tuckedOrigins]: next });
  } catch {
    // The in-memory state still holds for this page; only the memory of it
    // across reloads is lost, which is not worth interrupting anyone over.
  }
}
