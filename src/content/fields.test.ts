import { describe, expect, it } from "vitest";
import { FILLABLE_FIELDS, resolveValue } from "./fields";

describe("resolveValue", () => {
  it("passes a stored value straight through", () => {
    expect(resolveValue("email", { email: "meet@example.com" })).toBe("meet@example.com");
  });

  it("keeps booleans, including false", () => {
    // `false` is an answer to "will you require sponsorship", not a blank.
    expect(resolveValue("requiresSponsorship", { requiresSponsorship: false })).toBe(false);
  });

  it("joins a full name from its two halves", () => {
    expect(resolveValue("fullName", { firstName: "Meet", lastName: "Bhalodiya" })).toBe(
      "Meet Bhalodiya",
    );
  });

  it("fills half a name rather than nothing", () => {
    expect(resolveValue("fullName", { firstName: "Meet" })).toBe("Meet");
    expect(resolveValue("fullName", { lastName: "Bhalodiya" })).toBe("Bhalodiya");
  });

  it("gives up on a full name only when both halves are missing", () => {
    expect(resolveValue("fullName", {})).toBeUndefined();
    expect(resolveValue("fullName", { firstName: "  ", lastName: "" })).toBeUndefined();
  });

  it("builds a location from city and state", () => {
    expect(
      resolveValue("currentLocation", { city: "Ahmedabad", state: "Gujarat", country: "India" }),
    ).toBe("Ahmedabad, Gujarat");
  });

  it("leaves the country out of a location", () => {
    // "Ahmedabad, Gujarat" is what these boxes expect. A form that wants the
    // country asks for it separately, and `country` answers that one.
    expect(
      resolveValue("currentLocation", { city: "San Francisco", state: "CA", country: "USA" }),
    ).not.toContain("USA");
  });

  it("skips the parts of a location it does not have", () => {
    expect(resolveValue("currentLocation", { city: "Ahmedabad", country: "India" })).toBe(
      "Ahmedabad",
    );
  });

  it("never puts a street address in a location", () => {
    // A job board asking "Location" wants somewhere to place you. Volunteering
    // a home address is worse than leaving the box empty.
    const value = resolveValue("currentLocation", {
      addressLine1: "12 Example Street",
      city: "Ahmedabad",
    });

    expect(value).toBe("Ahmedabad");
  });

  it("splits years of experience into a years half and a months half", () => {
    expect(resolveValue("experienceYears", { yearsExperience: "5.5" })).toBe("5");
    expect(resolveValue("experienceMonths", { yearsExperience: "5.5" })).toBe("6");
  });

  it("answers a months box with zero rather than leaving it blank", () => {
    // Five years IS zero months, and a Months dropdown sitting on its
    // placeholder is an unanswered question on a form that will not submit.
    expect(resolveValue("experienceMonths", { yearsExperience: "5" })).toBe("0");
  });

  it("leaves both halves alone when the stored value is not a length of time", () => {
    expect(resolveValue("experienceYears", { yearsExperience: "fresher" })).toBeUndefined();
    expect(resolveValue("experienceMonths", {})).toBeUndefined();
  });

  it("refuses to write a list into a text box", () => {
    expect(resolveValue("roles", { roles: [{ company: "Upraqx" }] })).toBeUndefined();
  });
});

describe("FILLABLE_FIELDS", () => {
  it("offers stored, derived, composed and computed keys alike", () => {
    expect(FILLABLE_FIELDS.has("email")).toBe(true);
    expect(FILLABLE_FIELDS.has("currentCompany")).toBe(true);
    expect(FILLABLE_FIELDS.has("fullName")).toBe(true);
    expect(FILLABLE_FIELDS.has("experienceYears")).toBe(true);
  });

  it("leaves list fields out entirely", () => {
    // Nothing sensible can be typed into a single input from a list, and
    // offering them would let the matcher claim a field it cannot fill.
    expect(FILLABLE_FIELDS.has("roles")).toBe(false);
    expect(FILLABLE_FIELDS.has("additionalLinks")).toBe(false);
  });

  it("carries a label for every key, for the fill report", () => {
    for (const [key, field] of FILLABLE_FIELDS) {
      expect(field.label, `${key} has no label`).toBeTruthy();
    }
  });
});

describe("skills", () => {
  it("writes a tag list into a form as one comma-separated string", () => {
    expect(resolveValue("skills", { skills: ["React", "TypeScript", "Node.js"] })).toBe(
      "React, TypeScript, Node.js",
    );
  });

  it("keeps the user's own order", () => {
    // The editor tells them to put what they want seen first, because a form
    // with a length cap keeps the front of this string.
    expect(resolveValue("skills", { skills: ["Zig", "Ada"] })).toBe("Zig, Ada");
  });

  it("offers nothing for an empty or blank list", () => {
    expect(resolveValue("skills", { skills: [] })).toBeUndefined();
    expect(resolveValue("skills", { skills: ["  ", ""] })).toBeUndefined();
    expect(resolveValue("skills", {})).toBeUndefined();
  });

  it("is offered to the matcher, unlike the row lists", () => {
    expect(FILLABLE_FIELDS.has("skills")).toBe(true);
  });
});

describe("the two experience boxes", () => {
  it("fills a split Years/Months pair from both of them", () => {
    const data = { yearsExperience: "5", monthsExperience: "8" };

    expect(resolveValue("experienceYears", data)).toBe("5");
    expect(resolveValue("experienceMonths", data)).toBe("8");
  });

  it("still infers months from a decimal when the months box is empty", () => {
    expect(resolveValue("experienceMonths", { yearsExperience: "5.5" })).toBe("6");
  });

  it("gives a single total-experience box the whole answer", () => {
    // The point of the shadowing entry: "5" alone would lose the eight months
    // the user typed into the box next to it.
    expect(resolveValue("yearsExperience", { yearsExperience: "5", monthsExperience: "6" })).toBe(
      "5.5",
    );
  });

  it("passes the years box through untouched when there is nothing to fold in", () => {
    // "10+" is a perfectly good answer, and normalising it to "10" would be us
    // editing what the user wrote for no reason.
    expect(resolveValue("yearsExperience", { yearsExperience: "10+" })).toBe("10+");
    expect(resolveValue("yearsExperience", { yearsExperience: "5.5" })).toBe("5.5");
  });

  it("offers nothing when neither box has been filled in", () => {
    expect(resolveValue("yearsExperience", {})).toBeUndefined();
    expect(resolveValue("experienceYears", {})).toBeUndefined();
  });
});
