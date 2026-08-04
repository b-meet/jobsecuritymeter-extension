import { describe, expect, it, vi } from "vitest";
import { fillField } from "./fill";

function input(attrs: Record<string, string> = {}): HTMLInputElement {
  document.body.innerHTML = "";
  const el = document.createElement("input");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

describe("fillField", () => {
  it("writes a value and fires bubbling input + change", () => {
    // React listens for `input`; other frameworks and plain listeners want
    // `change`. Both must bubble because frameworks delegate from the root.
    const el = input();
    const seen: string[] = [];
    document.body.addEventListener("input", () => seen.push("input"));
    document.body.addEventListener("change", () => seen.push("change"));

    expect(fillField(el, "Meet")).toEqual({ ok: true });
    expect(el.value).toBe("Meet");
    expect(seen).toEqual(["input", "change"]);
  });

  it("bypasses a patched value setter on the instance", () => {
    // This is the whole reason the file exists. React shadows `value` with its
    // own descriptor on the element, so a plain `el.value = x` goes through
    // React's setter and leaves its internal copy stale - the field reverts on
    // the next render. Simulate that here: a patched setter that swallows the
    // write. Going through the prototype's native setter must still land the
    // value, and must not call the patched one.
    const el = input();
    const patched = vi.fn();
    Object.defineProperty(el, "value", {
      configurable: true,
      get: () => "",
      set: patched,
    });

    expect(fillField(el, "Meet")).toEqual({ ok: true });
    expect(patched).not.toHaveBeenCalled();

    // Drop the shadow and read what the native setter actually wrote.
    delete (el as unknown as Record<string, unknown>).value;
    expect(el.value).toBe("Meet");
  });

  it("refuses to overwrite something the user already typed", () => {
    const el = input();
    el.value = "typed by hand";

    expect(fillField(el, "autofilled")).toEqual({ ok: false, reason: "already filled" });
    expect(el.value).toBe("typed by hand");
  });

  it("reports when nothing is saved for the field", () => {
    expect(fillField(input(), "")).toEqual({ ok: false, reason: "nothing saved" });
  });

  describe("booleans", () => {
    it("clicks a checkbox rather than assigning checked", () => {
      const el = input({ type: "checkbox" });
      expect(fillField(el, true)).toEqual({ ok: true });
      expect(el.checked).toBe(true);
    });

    it("leaves a checkbox alone when it already matches", () => {
      const el = input({ type: "checkbox" });
      el.checked = true;
      const click = vi.spyOn(el, "click");

      expect(fillField(el, true)).toEqual({ ok: true });
      expect(click).not.toHaveBeenCalled();
    });

    it("picks the radio whose value matches the answer", () => {
      document.body.innerHTML = `
        <input type="radio" name="auth" value="Yes" />
        <input type="radio" name="auth" value="No" />
      `;
      const [yes, no] = Array.from(document.querySelectorAll("input")) as HTMLInputElement[];

      expect(fillField(yes!, true)).toEqual({ ok: true });
      expect(yes!.checked).toBe(true);
      // The "No" radio is not the one that answers `true`.
      expect(fillField(no!, true).ok).toBe(false);
    });
  });

  describe("select", () => {
    function select(options: string[]): HTMLSelectElement {
      document.body.innerHTML = "";
      const el = document.createElement("select");
      for (const text of options) {
        const option = document.createElement("option");
        option.value = text.toLowerCase().replace(/\s+/g, "_");
        option.text = text;
        el.appendChild(option);
      }
      el.selectedIndex = 0;
      document.body.appendChild(el);
      return el;
    }

    it("matches an option by value", () => {
      const el = select(["", "Remote", "Hybrid"]);
      expect(fillField(el, "remote")).toEqual({ ok: true });
      expect(el.value).toBe("remote");
    });

    it("matches an option by visible text", () => {
      const el = select(["", "Prefer not to say", "Male"]);
      expect(fillField(el, "Prefer not to say")).toEqual({ ok: true });
    });

    it("reports when no option matches instead of picking one", () => {
      const el = select(["", "Yes", "No"]);
      expect(fillField(el, "Maybe")).toEqual({ ok: false, reason: "no matching option" });
      expect(el.selectedIndex).toBe(0);
    });
  });
});
