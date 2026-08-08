import { detectFields, type FieldMap, type FieldMatch } from "./detect";
import { fillField } from "./fill";
import { type VaultData } from "@/shared/vault";
import { FILLABLE_FIELDS, resolveValue } from "./fields";
import type { ContentMessage, FillReport, Request, Response, SitePage } from "@/shared/messages";
import { frameIsBigEnough, isTucked, setTucked, OFFER_THRESHOLD } from "./ui/dock";
import { mountPanel, type Panel } from "./ui/panel";
import { throttled } from "./ui/raf";
import { mountChip, type Chip } from "./ui/chip";

/**
 * Content script.
 *
 * Holds no token and stores nothing. It receives values for exactly one fill,
 * writes them, and forgets them - see shared/messages for why.
 *
 * Runs in every frame (`all_frames`), because Greenhouse and Lever boards are
 * usually embedded as cross-origin iframes on company career pages, and the
 * form is inside the iframe rather than the top document. That also means a
 * good deal of this file is about deciding whether the frame it woke up in is
 * worth drawing anything in at all.
 */

/* --------------------------------------------------------------- messaging */

function ask<T>(request: Request): Promise<Response<T>> {
  return chrome.runtime
    .sendMessage(request)
    .catch((): Response<T> => ({ ok: false, error: "Extension unavailable." }));
}

/**
 * Fetch the values for one fill.
 *
 * DELIBERATELY NOT CACHED. The rule in shared/messages is that the content
 * script asks for values only when a fill is actually happening; holding the
 * vault in a page-side closure for the lifetime of the tab would quietly turn
 * this script into a second copy of the user's profile, living in the same
 * process as whatever the page is running. A round-trip per click is cheap by
 * comparison, and the worker is the only thing holding a token either way.
 */
async function vaultValues(): Promise<{ data: VaultData } | { error: string }> {
  const result = await ask<{ data: VaultData }>({ type: "GET_VAULT" });
  if (!result.ok) return { error: result.error };
  return { data: result.data.data };
}

function openPage(page: SitePage): void {
  void ask({ type: "OPEN_PAGE", page });
}

/* ------------------------------------------------------------------ filling */

function runFill(data: VaultData, found: readonly FieldMatch[]): FillReport {
  const report: FillReport = { filled: [], skipped: [] };

  for (const match of found) {
    // Goes through the resolver rather than reading `data` directly, so a
    // composed key like `fullName` - which has no slot of its own - is built
    // from the parts the user did save.
    const value = resolveValue(match.key, data);

    if (value === undefined || value === "") {
      // Nothing saved for this field - not worth reporting as a failure, the
      // user simply has not filled that part of their profile.
      continue;
    }

    // Custom dropdowns need a click-open/type/pick sequence that fill.ts does
    // not implement yet. Reported rather than attempted: a half-driven combobox
    // can leave a form in a worse state than an untouched one.
    if (match.control === "combo") {
      report.skipped.push({ label: match.label, reason: "dropdown needs a manual pick" });
      continue;
    }

    const outcome = fillField(match.element, value);
    if (outcome.ok) {
      report.filled.push({ key: match.key, label: FILLABLE_FIELDS.get(match.key)?.label ?? match.key });
    } else {
      report.skipped.push({ label: match.label, reason: outcome.reason });
    }
  }

  return report;
}

/* ---------------------------------------------------------------- lifecycle */

let fieldMap: FieldMap | null = null;
let matches: FieldMatch[] = [];
let panel: Panel | null = null;
let chip: Chip | null = null;
let connected = false;
let tucked = false;

function redetect(): void {
  matches = detectFields(document, fieldMap);
  chip?.setMatches(matches);
}

/** The form the panel pins itself to when it cannot pin to the viewport. */
function anchor(): Element | null {
  const first = matches[0]?.element;
  if (!first) return null;
  return first.closest("form") ?? first.closest("main") ?? first;
}

async function fillWholeForm(): Promise<void> {
  panel?.setState({ kind: "filling" });

  const values = await vaultValues();
  if ("error" in values) {
    panel?.setState({ kind: "error", message: values.error });
    return;
  }

  // Re-detect first: on a React form the elements captured at page load may
  // already have been replaced by a re-render, and writing into a detached node
  // succeeds silently while the user sees nothing happen.
  redetect();

  const report = runFill(values.data, matches);
  panel?.setState({
    kind: "report",
    filled: report.filled.length,
    skipped: report.skipped.length,
  });
}

async function fillOneField(
  element: HTMLInputElement | HTMLTextAreaElement,
  key: string,
): Promise<void> {
  const values = await vaultValues();
  if ("error" in values) {
    chip?.flash(values.error.includes("reconnect") ? "Reconnect" : "Failed");
    return;
  }

  const value = resolveValue(key, values.data);
  if (value === undefined || value === "") {
    // Honest rather than silent: the field was recognised, there is just
    // nothing in the profile to put in it yet.
    chip?.flash("Nothing saved");
    return;
  }

  const outcome = fillField(element, value);
  if (!outcome.ok) chip?.flash("Couldn't fill");
}

function ensurePanel(): void {
  if (panel) return;

  panel = mountPanel({
    onFill: () => void fillWholeForm(),
    onConnect: () => openPage("connect"),
    onEditProfile: () => openPage("account"),
    onTuckedChange: (next) => {
      tucked = next;
      void setTucked(location.origin, next);

      if (next) {
        chip?.destroy();
        chip = null;
      } else if (matches.length > 0) {
        ensureChip();
      }
    },
    anchor,
  });

  // Mounted already collapsed when this origin was tucked away on a previous
  // visit. The panel is never destroyed for it - being retrievable is the whole
  // point, and a destroyed panel has no edge tab to pull back out.
  if (tucked) panel.setTucked(true);
}

/**
 * The chip follows the handle: hidden on an origin the user tucked away.
 *
 * Leaving in-field prompts on a page where the handle was hidden would ignore
 * the instruction in the more intrusive of the two places.
 */
function ensureChip(): void {
  if (chip || tucked) return;
  chip = mountChip((element, key) => void fillOneField(element, key));
  chip.setMatches(matches);
}

/**
 * Decide what, if anything, to show for the current state of the page.
 *
 * Runs after every re-detect, so an SPA that swaps a listing page for an
 * application form gets the panel on arrival without a reload.
 */
function reconcile(): void {
  // Keep whatever is already mounted rather than flickering it away during a
  // transient re-render that momentarily empties the form.
  if (matches.length === 0) return;

  ensureChip();

  if (matches.length < OFFER_THRESHOLD) return;

  ensurePanel();
  panel?.setState({ kind: "ready", count: matches.length, connected });
  // The one unprompted appearance: opens itself the first time we are confident
  // this really is an application form, and never again on this page.
  panel?.openOnce();
}

/* ------------------------------------------------------- popup-driven fills */

function listenForFills(): void {
  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    if (message?.type !== "FILL_NOW") return false;

    redetect();
    const report = runFill(message.data, matches);

    // `chrome.tabs.sendMessage` from the popup reaches EVERY frame in the tab,
    // so a career page with an embedded board runs this in both the wrapper and
    // the board. Only a frame that had something to fill should say anything -
    // otherwise an unrelated frame stacks a "nothing matched" card on top of
    // the successful fill the user was actually watching.
    if (matches.length > 0) {
      ensurePanel();
      panel?.setState({
        kind: "report",
        filled: report.filled.length,
        skipped: report.skipped.length,
      });
      panel?.openOnce();
    }

    sendResponse(report);
    return false;
  });
}

/* ---------------------------------------------------------------- bootstrap */

async function start(): Promise<void> {
  // Ad slots, tracking pixels and small widget iframes all sit on these hosts
  // often enough to matter, and `all_frames` puts us inside every one of them.
  if (!frameIsBigEnough()) return;

  // Not an early return. A tucked origin still mounts - collapsed to its edge
  // tab, because a panel that never mounts leaves nothing to pull back out.
  tucked = await isTucked(location.origin);

  const [map, isConnected] = await Promise.all([
    ask<FieldMap | null>({ type: "GET_FIELD_MAP" }),
    ask<boolean>({ type: "GET_CONNECTED" }),
  ]);

  // Neither failure is fatal: detection falls back to its bundled heuristics,
  // and an unknown connection state just means the panel offers to connect.
  fieldMap = map.ok ? map.data : null;
  connected = isConnected.ok ? isConnected.data : false;

  redetect();
  reconcile();

  // ATS forms are React apps that mount their fields after first paint and swap
  // them wholesale between wizard steps, so a single pass at load would miss
  // most of them. Throttled to one pass per frame - these forms mutate
  // constantly while the user types.
  const observer = new MutationObserver(
    throttled(() => {
      const before = matches.length;
      redetect();
      if (matches.length !== before) reconcile();
      else panel?.reposition();
    }),
  );

  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Marker proving this frame already has a copy running.
 *
 * `chrome.scripting.executeScript` does not check whether the script is already
 * there, and the popup's "Fill this page" injects unconditionally when its
 * first message finds no listener. On a page we DO cover statically - or on a
 * second press - that would mount a second handle, register a second message
 * listener, and report every fill twice.
 *
 * Set on `window`, which is per-frame, so each frame of a page decides for
 * itself. Content scripts run in an isolated world, so the page cannot see or
 * forge this.
 */
const LOADED = "__jsmAutofillLoaded";
type Marked = typeof globalThis & { [LOADED]?: true };

if (!(globalThis as Marked)[LOADED]) {
  (globalThis as Marked)[LOADED] = true;
  listenForFills();
  void start();
}
