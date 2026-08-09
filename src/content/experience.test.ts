import { describe, expect, it } from "vitest";
import { combineExperience, formatExperience, parseExperience } from "./experience";

describe("parseExperience", () => {
  it("reads a whole number of years", () => {
    expect(parseExperience("5")).toEqual({ years: 5, months: 0 });
  });

  it("reads a decimal as years and months", () => {
    // "5.5" is five years and six months. Flooring the half away would quietly
    // lose six months of somebody's career on every form that asks in two boxes.
    expect(parseExperience("5.5")).toEqual({ years: 5, months: 6 });
    expect(parseExperience("2.25")).toEqual({ years: 2, months: 3 });
  });

  it("reads a spelled-out pair", () => {
    expect(parseExperience("5 years 6 months")).toEqual({ years: 5, months: 6 });
    expect(parseExperience("3 yrs 2 mos")).toEqual({ years: 3, months: 2 });
  });

  it("does not read the months figure as years", () => {
    // The bug this guards: "6 months" has one number in it, and taking the
    // first number found would report six years and six months.
    expect(parseExperience("6 months")).toEqual({ years: 0, months: 6 });
  });

  it("carries months past a year into the year count", () => {
    // A Months dropdown only ever runs 0-11, so "18 months" has to arrive as a
    // year and a half or it cannot be filled at all.
    expect(parseExperience("18 months")).toEqual({ years: 1, months: 6 });
  });

  it("carries a rounded-up fraction rather than reporting 12 months", () => {
    expect(parseExperience("5.99")).toEqual({ years: 6, months: 0 });
  });

  it("ignores the words around the number", () => {
    expect(parseExperience("about 7 years")).toEqual({ years: 7, months: 0 });
    expect(parseExperience("10+")).toEqual({ years: 10, months: 0 });
  });

  it("gives up on text with no number in it", () => {
    expect(parseExperience("fresher")).toBeNull();
    expect(parseExperience("")).toBeNull();
    expect(parseExperience("   ")).toBeNull();
  });

  it("refuses a number that cannot be a length of service", () => {
    // Somebody typing a year of birth or a salary into the box would otherwise
    // produce "1998 years", and a form that accepts that looks far worse than
    // one left blank.
    expect(parseExperience("1998")).toBeNull();
    expect(parseExperience("1200000")).toBeNull();
  });
});

describe("combineExperience", () => {
  it("takes the months box as the answer to the months question", () => {
    expect(combineExperience("5", "6")).toEqual({ years: 5, months: 6 });
  });

  it("lets an explicit months figure beat one inferred from a decimal", () => {
    // "5.5" infers six months; the user then typed 8 into the box that asks
    // directly. Answering the question beats arithmetic on a number they may
    // not have meant as one.
    expect(combineExperience("5.5", "8")).toEqual({ years: 5, months: 8 });
  });

  it("falls back to the inferred months when the box is empty", () => {
    expect(combineExperience("5.5", "")).toEqual({ years: 5, months: 6 });
    expect(combineExperience("5.5", "   ")).toEqual({ years: 5, months: 6 });
  });

  it("carries an over-long months figure into the years", () => {
    expect(combineExperience("2", "18")).toEqual({ years: 3, months: 6 });
  });

  it("works from the months box alone", () => {
    expect(combineExperience("", "8")).toEqual({ years: 0, months: 8 });
  });

  it("gives up when neither box says anything usable", () => {
    expect(combineExperience("", "")).toBeNull();
    expect(combineExperience("fresher", "")).toBeNull();
  });
});

describe("formatExperience", () => {
  it("writes a whole number of years as a whole number", () => {
    expect(formatExperience({ years: 5, months: 0 })).toBe("5");
  });

  it("writes a part year as a decimal", () => {
    expect(formatExperience({ years: 5, months: 6 })).toBe("5.5");
    expect(formatExperience({ years: 2, months: 3 })).toBe("2.25");
  });

  it("does not leave trailing zeros behind", () => {
    expect(formatExperience({ years: 10, months: 0 })).toBe("10");
    expect(formatExperience({ years: 1, months: 1 })).toBe("1.08");
  });
});
