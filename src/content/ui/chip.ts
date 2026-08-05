import { BASE_CSS, BOLT_SVG, COLORS, TOP_LAYER } from "./theme";
import { throttled } from "./raf";
import type { FieldMatch } from "../detect";

/**
 * The in-field prompt, in the spirit of the browser's own autofill.
 *
 * Appears inside the right edge of a field the user has just focused, when we
 * know what that field wants and it is still empty. One click fills that field
 * alone.
 *
 * WHY IT SITS INSIDE THE FIELD RATHER THAN BELOW IT. Chrome's native autofill
 * dropdown is browser UI, painted above the page entirely - no `z-index` we can
 * set competes with it. A chip rendered under the field would spend its life
 * hidden behind Chrome's own suggestions on exactly the fields (name, email,
 * address) where both of us have something to offer. Inside the field's right
 * edge is the one place neither the page's own adornments nor the browser's
 * dropdown reliably occupy.
 *
 * IT IS ALSO THE ONLY SURFACE THAT WORKS IN AN EMBEDDED BOARD. A frame that
 * cannot pin anything to the viewport (see dock.ts) can still position against
 * a field inside itself.
 */

export type Chip = {
  /** Swap in the current detection results; clears the chip if it no longer applies. */
  setMatches(matches: readonly FieldMatch[]): void;
  /** Briefly replace the label - used for "nothing saved for this one". */
  flash(message: string): void;
  destroy(): void;
};

/** Below this the chip would cover more of the field than it is worth. */
const MIN_FIELD_WIDTH = 140;
const MIN_FIELD_HEIGHT = 26;
const CHIP_HEIGHT = 22;
const INSET = 6;

const CSS = `
  ${BASE_CSS}

  .chip {
    position: fixed;
    display: none;
    align-items: center;
    gap: 4px;
    height: ${CHIP_HEIGHT}px;
    padding: 0 8px 0 6px;
    border-radius: 999px;
    background: ${COLORS.green};
    color: #fff;
    font: 700 11px/1 system-ui, -apple-system, sans-serif;
    box-shadow: 0 2px 8px rgba(0,0,0,.2);
    pointer-events: auto;
    white-space: nowrap;
    cursor: pointer;
  }
  .chip[data-visible="true"] { display: inline-flex; }
  .chip:hover { background: ${COLORS.greenDeep}; }
  .chip:focus-visible { outline: 2px solid ${COLORS.amber}; outline-offset: 2px; }
  .chip svg { width: 12px; height: 12px; display: block; }
  .chip[data-flashing="true"] { background: ${COLORS.greenDeep}; }
`;

/** Only these accept a typed value, which is what the chip offers to save. */
function isTextEntry(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  // Checkboxes, radios and selects are handled by the panel's whole-form fill;
  // there is no useful single-field affordance for them.
  return !["checkbox", "radio", "range", "color"].includes(element.type);
}

export function mountChip(
  onFill: (element: HTMLInputElement | HTMLTextAreaElement, key: string) => void,
): Chip {
  const host = document.createElement("div");
  host.style.cssText = `position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:${TOP_LAYER};`;
  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>${CSS}</style>
    <button class="chip" type="button" tabindex="-1">
      ${BOLT_SVG}<span class="label">Fill</span>
    </button>
  `;

  (document.body ?? document.documentElement).appendChild(host);

  const chip = shadow.querySelector(".chip") as HTMLButtonElement;
  const label = shadow.querySelector(".label") as HTMLElement;

  let byElement = new Map<Element, FieldMatch>();
  let active: { element: HTMLInputElement | HTMLTextAreaElement; key: string } | null = null;
  let flashTimer: number | undefined;
  let destroyed = false;

  function hide(): void {
    active = null;
    chip.dataset.visible = "false";
  }

  function place(): void {
    if (!active) return;

    const rect = active.element.getBoundingClientRect();

    // Gone off-screen, collapsed, or hidden by an SPA re-render. Anything that
    // leaves the chip floating over unrelated content is worse than no chip.
    const offscreen =
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth;

    if (offscreen || rect.width < MIN_FIELD_WIDTH || rect.height < MIN_FIELD_HEIGHT) {
      chip.dataset.visible = "false";
      return;
    }

    chip.dataset.visible = "true";
    const width = chip.getBoundingClientRect().width || 56;

    // Textareas pin to the top of the box; a single-line field centres.
    const top =
      active.element instanceof HTMLTextAreaElement
        ? rect.top + INSET
        : rect.top + (rect.height - CHIP_HEIGHT) / 2;

    chip.style.left = `${Math.round(rect.right - width - INSET)}px`;
    chip.style.top = `${Math.round(top)}px`;
  }

  const reposition = throttled(place);

  function onFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !isTextEntry(target)) {
      hide();
      return;
    }

    const match = byElement.get(target);
    // A field the user has already answered gets left alone - overwriting what
    // somebody typed is the one thing worse than not filling at all.
    if (!match || target.value.trim() !== "") {
      hide();
      return;
    }

    active = { element: target, key: match.key };
    label.textContent = "Fill";
    chip.dataset.flashing = "false";
    place();
  }

  function onFocusOut(): void {
    // Deferred: clicking the chip blurs the field for an instant, and tearing
    // the chip down inside that gap would cancel the click before it lands.
    setTimeout(() => {
      if (destroyed) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused === active?.element) return;
      hide();
    }, 0);
  }

  function onInput(event: Event): void {
    if (!active || event.target !== active.element) return;
    // The user started typing this one themselves - the offer is moot.
    if (active.element.value.trim() !== "") hide();
  }

  // `mousedown` rather than `click`, and prevented: the default would move
  // focus off the field, and a field that loses focus mid-fill can trip an
  // ATS's own "required" validation before we have written anything.
  chip.addEventListener("mousedown", (event) => event.preventDefault());

  chip.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!active) return;
    onFill(active.element, active.key);
  });

  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("input", onInput, true);
  window.addEventListener("scroll", reposition, { passive: true, capture: true });
  window.addEventListener("resize", reposition, { passive: true });

  return {
    setMatches(matches: readonly FieldMatch[]): void {
      byElement = new Map(matches.map((match) => [match.element, match]));
      if (active && !byElement.has(active.element)) hide();
    },

    flash(message: string): void {
      if (!active) return;
      label.textContent = message;
      chip.dataset.flashing = "true";
      place();

      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        if (destroyed) return;
        label.textContent = "Fill";
        chip.dataset.flashing = "false";
        place();
      }, 2200);
    },

    destroy(): void {
      destroyed = true;
      window.clearTimeout(flashTimer);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      host.remove();
    },
  };
}
