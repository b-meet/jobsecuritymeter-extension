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

  it("refuses to write a list into a text box", () => {
    expect(resolveValue("roles", { roles: [{ company: "Upraqx" }] })).toBeUndefined();
  });
});

describe("FILLABLE_FIELDS", () => {
  it("offers stored, derived and composed keys alike", () => {
    expect(FILLABLE_FIELDS.has("email")).toBe(true);
    expect(FILLABLE_FIELDS.has("currentCompany")).toBe(true);
    expect(FILLABLE_FIELDS.has("fullName")).toBe(true);
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
