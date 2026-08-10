import { pickOption } from "./options";
import { typeInto } from "./fill";

/**
 * Driving a custom dropdown - the ones that are not `<select>` elements.
 *
 * Every serious form library ships one: react-select, downshift, headless UI,
 * and the hand-rolled widget every ATS vendor writes at least once. They exist
 * because a native `<select>` cannot be searched, and a country list with two
 * hundred entries needs to be. Which means the controls MOST likely to be a
 * custom dropdown are exactly the ones we most want to fill: country, dial
 * code, state, notice period.
 *
 * WHAT MAKES THIS SAFE ENOUGH TO ATTEMPT AT ALL. Nothing here is guessed from a
 * vendor's class names. It drives the ARIA combobox pattern, which is a
 * published contract a widget opts into by writing `role="combobox"` and
 * `role="option"` - if a widget declares itself a combobox, these are the
 * interactions it is promising to answer.
 *
 * AND WHAT HAPPENS WHEN IT IS NOT ENOUGH. Every exit that is not a successful
 * pick puts the control back: the typed filter is cleared, Escape is sent, and
 * the field is blurred. A half-driven dropdown - open, filtered to nothing, and
 * abandoned - is a worse state than one nobody touched, and that risk is the
 * reason this was reported as "needs a manual pick" until now.
 */

/** How long to give a widget to render its list before giving up on it. */
const OPEN_TIMEOUT_MS = 400;
/** Filtering is local work, not a fetch, so it needs far less room. */
const FILTER_TIMEOUT_MS = 200;
const POLL_MS = 25;

export type ComboOutcome = { ok: true } | { ok: false; reason: string };

/** Reported when the element never behaved like a dropdown at all. */
export const NOT_A_DROPDOWN = "not a dropdown";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until `read` returns something, or the deadline passes.
 *
 * A dropdown opens on the widget's own schedule - a React state update, a
 * transition, sometimes a portal mounted a frame later - so there is no event
 * to await. Polling briefly is the honest version of "wait for it to appear".
 */
async function waitFor<T>(read: () => T | null, timeout: number): Promise<T | null> {
  const deadline = Date.now() + timeout;

  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await wait(POLL_MS);
  }
}

function isVisible(node: HTMLElement): boolean {
  if (node.hasAttribute("hidden")) return false;
  if (node.getAttribute("aria-hidden") === "true") return false;

  const style = node.ownerDocument.defaultView?.getComputedStyle(node);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;

  return true;
}

/**
 * The list this combobox opens, once it is open.
 *
 * `aria-controls` is the answer when the widget provides one. When it does not,
 * a single open listbox anywhere in the document is accepted - popups are
 * routinely portalled to the end of `<body>` with no link back to their
 * trigger. TWO open listboxes is not a near miss, it is a coin flip, and the
 * losing side of that flip clicks an option in somebody's application form.
 */
function listboxFor(root: HTMLElement): HTMLElement | null {
  const id = root.getAttribute("aria-controls") ?? root.getAttribute("aria-owns");

  if (id) {
    const node = root.ownerDocument.getElementById(id);
    if (node instanceof HTMLElement && isVisible(node)) return node;
  }

  const open = [...root.ownerDocument.querySelectorAll('[role="listbox"]')].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && isVisible(node),
  );

  return open.length === 1 ? open[0]! : null;
}

/**
 * Selectable rows inside an open list.
 *
 * `role="option"` first, because that is the declared contract. The `li`
 * fallback covers the widgets that mark up the list correctly and then forget
 * the role on its children, which is common enough to be worth catching and
 * costs nothing: an `li` inside a listbox is a row by construction.
 */
function optionsIn(listbox: HTMLElement): HTMLElement[] {
  const declared = [...listbox.querySelectorAll('[role="option"]')];
  const rows = declared.length > 0 ? declared : [...listbox.querySelectorAll("li")];

  return rows.filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement &&
      isVisible(node) &&
      node.getAttribute("aria-disabled") !== "true",
  );
}

/** Every string that could name an option. */
function namesOf(option: HTMLElement): string[] {
  return [
    option.textContent ?? "",
    option.getAttribute("aria-label") ?? "",
    option.getAttribute("data-value") ?? "",
  ];
}

/**
 * The text box a searchable dropdown filters on, if it has one.
 *
 * A two-hundred entry country list is usually virtualised: until it is
 * filtered, the option the user needs is not in the DOM to be clicked, so
 * finding this is often the difference between working and not.
 */
function searchInputFor(root: HTMLElement, listbox: HTMLElement): HTMLInputElement | null {
  if (root instanceof HTMLInputElement) return root;

  const inside = root.querySelector("input") ?? listbox.querySelector("input");
  return inside instanceof HTMLInputElement ? inside : null;
}

/**
 * Placeholder text a dropdown shows while nothing has been chosen.
 *
 * Two patterns rather than one alternation: `\b` cannot close a match that ends
 * in punctuation, so "--" would slip past a single regex and read as an answer.
 */
const UNSET_WORDS = /^(select|choose|please select|none|not specified|n\/a)\b/i;
const UNSET_MARKS = /^[-–—]+$/;

function looksUnset(text: string): boolean {
  return UNSET_WORDS.test(text) || UNSET_MARKS.test(text);
}

/**
 * Has the user already answered this one?
 *
 * Same rule as every other control: what somebody typed is never overwritten.
 * The text test reads the trigger's own label, which is where these widgets put
 * the current selection, and treats the usual placeholder wording as blank.
 */
function alreadyAnswered(root: HTMLElement): boolean {
  if (root instanceof HTMLInputElement) return root.value.trim() !== "";

  const text = (root.textContent ?? "").replace(/\s+/g, " ").trim();
  return text !== "" && !looksUnset(text);
}

const KEY_EVENT = { bubbles: true, composed: true } as const;

function press(element: HTMLElement, key: string): void {
  element.dispatchEvent(new KeyboardEvent("keydown", { ...KEY_EVENT, key }));
  element.dispatchEvent(new KeyboardEvent("keyup", { ...KEY_EVENT, key }));
}

/** Some widgets open on the mouse pair rather than on a synthesised click. */
function mouseOpen(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent("mousedown", { ...KEY_EVENT, button: 0 }));
  element.dispatchEvent(new MouseEvent("mouseup", { ...KEY_EVENT, button: 0 }));
  element.click();
}

/** Put the control back exactly as it was found. */
function abandon(root: HTMLElement, search: HTMLInputElement | null): void {
  // Order matters: clear the filter BEFORE closing, or a widget that commits
  // its search text on close keeps a half-typed country name.
  if (search && search.value !== "") typeInto(search, "");
  press(root, "Escape");
  root.blur();
}

/**
 * Choose `value` in a custom dropdown.
 *
 * Async because there is no synchronous way to know a list has rendered. The
 * whole fill path is async for this reason - see runFill in content/index.ts.
 */
export async function fillCombo(root: HTMLElement, value: string): Promise<ComboOutcome> {
  const wanted = value.trim();
  if (!wanted) return { ok: false, reason: "nothing saved" };
  if (alreadyAnswered(root)) return { ok: false, reason: "already set" };

  try {
    root.focus();
    root.click();

    let listbox = await waitFor(() => listboxFor(root), OPEN_TIMEOUT_MS);

    if (!listbox) {
      mouseOpen(root);
      listbox = await waitFor(() => listboxFor(root), OPEN_TIMEOUT_MS);
    }

    if (!listbox) {
      abandon(root, null);
      // Deliberately distinct from "no matching option": the caller treats this
      // as "then it was never a dropdown" and falls back to writing text, which
      // would be actively wrong for a dropdown that simply lacks the value.
      return { ok: false, reason: NOT_A_DROPDOWN };
    }

    const search = searchInputFor(root, listbox);
    if (search) {
      typeInto(search, wanted);
      await waitFor(() => (optionsIn(listbox!).length > 0 ? true : null), FILTER_TIMEOUT_MS);
    }

    const choice = pickOption(wanted, optionsIn(listbox), namesOf);

    if (!choice) {
      abandon(root, search);
      return { ok: false, reason: "no matching option" };
    }

    choice.click();
    return { ok: true };
  } catch (error) {
    console.error("[combo]", error);
    abandon(root, null);
    return { ok: false, reason: "failed" };
  }
}
