import { describe, expect, it } from "vitest";
import { fillCombo, NOT_A_DROPDOWN } from "./combo";

/**
 * A dropdown built the way the ARIA pattern says to build one.
 *
 * `open` is wired to a click on the trigger, so the test drives the widget
 * through the same door a user would rather than reaching into its internals.
 */
function combobox(options: readonly string[], { searchable = false } = {}): HTMLElement {
  document.body.innerHTML = `
    <div id="root" role="combobox" aria-controls="list" aria-expanded="false" tabindex="0">
      <span class="value">Select</span>
      ${searchable ? `<input class="search" />` : ""}
    </div>
    <div id="list" role="listbox" hidden>
      ${options.map((option) => `<div role="option">${option}</div>`).join("")}
    </div>
  `;

  const root = document.getElementById("root")!;
  const list = document.getElementById("list")!;

  root.addEventListener("click", () => {
    list.removeAttribute("hidden");
    root.setAttribute("aria-expanded", "true");
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    list.setAttribute("hidden", "");
    root.setAttribute("aria-expanded", "false");
  });

  // Filtering, the way a searchable widget does it: rows that no longer match
  // leave the DOM entirely.
  root.querySelector(".search")?.addEventListener("input", (event) => {
    const typed = (event.target as HTMLInputElement).value.toLowerCase();
    for (const row of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      row.hidden = !row.textContent!.toLowerCase().includes(typed);
    }
  });

  for (const row of list.querySelectorAll<HTMLElement>('[role="option"]')) {
    row.addEventListener("click", () => {
      root.querySelector(".value")!.textContent = row.textContent;
      list.setAttribute("hidden", "");
      root.setAttribute("aria-expanded", "false");
    });
  }

  return root;
}

function chosen(root: HTMLElement): string {
  return root.querySelector(".value")!.textContent ?? "";
}

describe("fillCombo", () => {
  it("opens the list and picks the matching option", async () => {
    const root = combobox(["India (+91)", "United States (+1)"]);

    await expect(fillCombo(root, "+91")).resolves.toEqual({ ok: true });
    expect(chosen(root)).toBe("India (+91)");
  });

  it("does not settle for a dial code nested inside another", async () => {
    // "+1" is a substring of "(+91)", and the Indian entry comes first.
    const root = combobox(["India (+91)", "United States (+1)"]);

    await fillCombo(root, "+1");
    expect(chosen(root)).toBe("United States (+1)");
  });

  it("types into a searchable list before picking", async () => {
    const root = combobox(["India (+91)", "Ireland (+353)"], { searchable: true });

    await expect(fillCombo(root, "+91")).resolves.toEqual({ ok: true });
    expect(chosen(root)).toBe("India (+91)");
  });

  it("closes back up and clears the filter when nothing matches", async () => {
    // A dropdown left hanging open, filtered down to nothing, is a worse state
    // than one nobody touched - the user cannot tell it was us.
    const root = combobox(["India (+91)"], { searchable: true });

    await expect(fillCombo(root, "+44")).resolves.toEqual({
      ok: false,
      reason: "no matching option",
    });

    expect(chosen(root)).toBe("Select");
    expect(root.querySelector<HTMLInputElement>(".search")!.value).toBe("");
    expect(document.getElementById("list")!.hasAttribute("hidden")).toBe(true);
  });

  it("never overwrites a choice the user already made", async () => {
    const root = combobox(["India (+91)", "United States (+1)"]);
    root.querySelector(".value")!.textContent = "United States (+1)";

    await expect(fillCombo(root, "+91")).resolves.toEqual({ ok: false, reason: "already set" });
    expect(chosen(root)).toBe("United States (+1)");
  });

  it("treats the usual placeholder wording as unanswered", async () => {
    for (const placeholder of ["Select", "Choose...", "--", "None"]) {
      const root = combobox(["India (+91)"]);
      root.querySelector(".value")!.textContent = placeholder;

      await fillCombo(root, "+91");
      expect(chosen(root), placeholder).toBe("India (+91)");
    }
  });

  it("reports a control that declared itself a combobox and then never opened", async () => {
    // Distinct from "no matching option" on purpose: the caller falls back to
    // writing plain text for this one, and must not for the other.
    document.body.innerHTML = `<div id="root" role="combobox"><span>Select</span></div>`;
    const root = document.getElementById("root")!;

    await expect(fillCombo(root, "+91")).resolves.toEqual({ ok: false, reason: NOT_A_DROPDOWN });
  });

  it("refuses to guess between two open lists", async () => {
    // No aria-controls to follow and two candidates: picking either is a coin
    // flip, and the losing side clicks something in somebody's application.
    document.body.innerHTML = `
      <div id="root" role="combobox"><span>Select</span></div>
      <div role="listbox"><div role="option">India (+91)</div></div>
      <div role="listbox"><div role="option">India (+91)</div></div>
    `;

    const root = document.getElementById("root")!;
    await expect(fillCombo(root, "+91")).resolves.toEqual({ ok: false, reason: NOT_A_DROPDOWN });
  });

  it("finds a list that has no aria link back to its trigger", async () => {
    // Popups are routinely portalled to the end of <body> with nothing tying
    // them to the control that opened them.
    document.body.innerHTML = `
      <div id="root" role="combobox"><span>Select</span></div>
      <div role="listbox"><div role="option">India (+91)</div></div>
    `;

    const root = document.getElementById("root")!;
    const option = document.querySelector<HTMLElement>('[role="option"]')!;
    let clicked = false;
    option.addEventListener("click", () => {
      clicked = true;
    });

    await expect(fillCombo(root, "+91")).resolves.toEqual({ ok: true });
    expect(clicked).toBe(true);
  });

  it("falls back to list items when the rows forgot their role", async () => {
    document.body.innerHTML = `
      <div id="root" role="combobox"><span>Select</span></div>
      <ul role="listbox"><li>India (+91)</li><li>Ireland (+353)</li></ul>
    `;

    const root = document.getElementById("root")!;
    let picked = "";
    for (const row of document.querySelectorAll<HTMLElement>("li")) {
      row.addEventListener("click", () => {
        picked = row.textContent!;
      });
    }

    await expect(fillCombo(root, "+353")).resolves.toEqual({ ok: true });
    expect(picked).toBe("Ireland (+353)");
  });
});
