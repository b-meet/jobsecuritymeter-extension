import { describe, expect, it } from "vitest";
import { pickOption, scoreOption } from "./options";

/** A country list, in the order a real form renders one: alphabetical. */
const COUNTRIES = [
  "Afghanistan (+93)",
  "Anguilla (+1264)",
  "India (+91)",
  "Israel (+972)",
  "United States (+1)",
];

function pick(wanted: string, options: readonly string[]): string | null {
  return pickOption(wanted, options, (option) => [option]);
}

describe("scoreOption", () => {
  it("rates an exact match above everything", () => {
    expect(scoreOption("India", "India")).toBeGreaterThan(scoreOption("India", "India (+91)"));
  });

  it("treats a padded number as the same number", () => {
    // A "Months" dropdown running 00..11 answers "6" perfectly well.
    expect(scoreOption("6", "06")).toBe(scoreOption("6", "6"));
  });

  it("scores nothing for a number that only appears inside another number", () => {
    // The whole reason options.ts exists. "+1" is a substring of "(+91)" and
    // "(+1264)", and a country list is alphabetical, so a substring test hands
    // an American applicant an Afghan or Anguillan dial code.
    expect(scoreOption("+1", "India (+91)")).toBe(0);
    expect(scoreOption("+1", "Anguilla (+1264)")).toBe(0);
    expect(scoreOption("+1", "United States (+1)")).toBeGreaterThan(0);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(scoreOption("  india ", "INDIA")).toBe(scoreOption("india", "india"));
  });

  it("scores nothing for either side being blank", () => {
    expect(scoreOption("", "India")).toBe(0);
    expect(scoreOption("India", "   ")).toBe(0);
  });
});

describe("pickOption", () => {
  it("finds a dial code by its digits, not by substring", () => {
    expect(pick("+91", COUNTRIES)).toBe("India (+91)");
    expect(pick("91", COUNTRIES)).toBe("India (+91)");
    expect(pick("+1", COUNTRIES)).toBe("United States (+1)");
  });

  it("prefers the best option rather than the first one that fits", () => {
    // "India" is last here on purpose: a first-match scan returns the partial,
    // and the form's option order is not ours to rely on.
    expect(pick("India", ["Indiana", "British Indian Ocean Territory", "India"])).toBe("India");
  });

  it("returns null rather than settling for something unrelated", () => {
    expect(pick("+44", COUNTRIES)).toBeNull();
    expect(pick("Narnia", COUNTRIES)).toBeNull();
  });

  it("reads every name an option goes by", () => {
    const options = [
      { text: "IN", label: "India" },
      { text: "US", label: "United States" },
    ];

    const choice = pickOption("India", options, (option) => [option.text, option.label]);
    expect(choice?.text).toBe("IN");
  });
});
