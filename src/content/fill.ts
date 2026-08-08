import type { FieldElement } from "./detect";

/**
 * Writing values into fields.
 *
 * THIS FILE IS WHY MOST AUTOFILL EXTENSIONS LOOK BROKEN. Greenhouse, Lever and
 * Ashby are all React apps, and React tracks input state internally. Assigning
 * `element.value = x` updates the DOM but not React's copy, so the next render
 * puts the old value straight back and the field appears to clear itself a
 * moment after being filled.
 *
 * The fix is to call the NATIVE value setter - bypassing React's patched
 * property descriptor - and then dispatch the events React is listening for.
 */

function nativeSetter(element: FieldElement): ((value: string) => void) | null {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  const setter = descriptor?.set;
  if (!setter) return null;

  return (value: string) => setter.call(element, value);
}

/**
 * The event sequence a real keystroke produces, as closely as we can manage.
 *
 * `input` drives React's onChange; `change` drives Vue, Angular and plain
 * listeners. Everything bubbles because frameworks delegate from the form root,
 * and everything is `composed` so it crosses a shadow boundary - an ATS built
 * from web components would otherwise see nothing at all.
 *
 * `beforeinput` and the key events are here for the input libraries that gate on
 * them: several masked and autocomplete widgets ignore a bare `input` because a
 * human could not have produced one on its own.
 */
function notify(element: FieldElement): void {
  const key = { bubbles: true, composed: true } as const;

  element.dispatchEvent(new KeyboardEvent("keydown", key));
  element.dispatchEvent(new InputEvent("beforeinput", { ...key, inputType: "insertText" }));
  element.dispatchEvent(new InputEvent("input", { ...key, inputType: "insertText" }));
  element.dispatchEvent(new KeyboardEvent("keyup", key));
  element.dispatchEvent(new Event("change", key));
}

function setText(element: FieldElement, value: string): boolean {
  const set = nativeSetter(element);
  if (!set) return false;

  // Focus first: some forms only run validation on a field that was focused.
  element.focus();
  set(value);
  notify(element);

  /**
   * Re-assert if the framework put its own value back.
   *
   * This is the failure this whole file exists for, and dispatching events is
   * not always enough on its own: a controlled component can re-render from
   * stale state between the setter and the end of this function, leaving the
   * box empty while every event we sent says otherwise. Setting it again after
   * that render, without re-dispatching, is usually what sticks.
   */
  if ("value" in element && element.value !== value) {
    set(value);
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  // Blur last, so anything that commits or formats on blur gets its turn and
  // "required" styling settles.
  element.blur();

  return true;
}

/** Checkboxes and radios need `click`, not a value assignment. */
function setBoolean(element: FieldElement, value: boolean): boolean {
  if (!(element instanceof HTMLInputElement)) return false;

  if (element.type === "checkbox") {
    if (element.checked !== value) element.click();
    return true;
  }

  if (element.type === "radio") {
    const wanted = value ? /^(yes|true|1)$/i : /^(no|false|0)$/i;
    if (wanted.test(element.value)) {
      if (!element.checked) element.click();
      return true;
    }
    return false;
  }

  // A plain text field asking a yes/no question.
  return setText(element, value ? "Yes" : "No");
}

/**
 * Native `<select>`: match an option by value or visible text.
 *
 * Custom dropdowns (react-select, which Greenhouse and Lever both use) are NOT
 * `<select>` elements and cannot be filled this way - they need a click-open,
 * type, click-option sequence per ATS. Those come from the remote field map;
 * until then they are reported as skipped rather than silently missed.
 */
function setSelect(element: HTMLSelectElement, value: string): boolean {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return false;

  for (const option of Array.from(element.options)) {
    const matches =
      option.value.toLowerCase() === wanted ||
      option.text.trim().toLowerCase() === wanted ||
      option.text.trim().toLowerCase().includes(wanted);

    if (matches) {
      const set = nativeSetter(element);
      if (set) set(option.value);
      else element.value = option.value;
      notify(element);
      return true;
    }
  }

  return false;
}

export type FillOutcome = { ok: true } | { ok: false; reason: string };

/** Checkbox and radio `.value` is a static attribute, not something typed in. */
function isToggle(element: FieldElement): boolean {
  return element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio");
}

export function fillField(element: FieldElement, value: string | boolean): FillOutcome {
  try {
    // Booleans are resolved before the guard below: a radio's value is "Yes"
    // out of the box and a checkbox's is "on", so treating either as
    // "already filled" would mean no toggle was ever fillable.
    if (typeof value === "boolean") {
      return setBoolean(element, value) ? { ok: true } : { ok: false, reason: "unsupported control" };
    }

    // Never overwrite something the user already typed. A half-completed
    // application is the most likely state for a form to be in when someone
    // reaches for autofill, and clobbering their work is unforgivable.
    if (element instanceof HTMLSelectElement) {
      if (element.value && element.selectedIndex > 0) return { ok: false, reason: "already set" };
    } else if (element.value && !isToggle(element)) {
      return { ok: false, reason: "already filled" };
    }

    if (!value) return { ok: false, reason: "nothing saved" };

    if (element instanceof HTMLSelectElement) {
      return setSelect(element, value) ? { ok: true } : { ok: false, reason: "no matching option" };
    }

    return setText(element, value) ? { ok: true } : { ok: false, reason: "could not write" };
  } catch (error) {
    console.error("[fill]", error);
    return { ok: false, reason: "failed" };
  }
}
