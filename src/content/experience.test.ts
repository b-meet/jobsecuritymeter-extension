import { describe, expect, it } from "vitest";
import { parseExperience } from "./experience";

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
