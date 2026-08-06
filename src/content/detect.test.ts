import { describe, expect, it } from "vitest";
import { detectFields, type FieldMap } from "./detect";

function map(rules: FieldMap["sites"][number]["rules"], host = "boards.greenhouse.io"): FieldMap {
  return { version: 1, sites: [{ host, rules }] };
}

function form(html: string): HTMLElement {
  document.body.innerHTML = `<form>${html}</form>`;
  return document.body;
}

function keyFor(root: HTMLElement, selector: string): string | undefined {
  const target = root.querySelector(selector);
  return detectFields(root).find((m) => m.element === target)?.key;
}

describe("detectFields", () => {
  it("trusts the autocomplete attribute above everything else", () => {
    // The name says "field_123" and there is no label - autocomplete is the
    // only usable signal, and it is the one site authors write deliberately.
    const root = form(`<input name="field_123" autocomplete="given-name" />`);
    expect(keyFor(root, "input")).toBe("firstName");
  });

  it("handles section-prefixed autocomplete tokens", () => {
    const root = form(`<input autocomplete="shipping address-line1" />`);
    expect(keyFor(root, "input")).toBe("addressLine1");
  });

  it("reads a label bound with for=", () => {
    const root = form(`<label for="e">Email Address</label><input id="e" />`);
    expect(keyFor(root, "#e")).toBe("email");
  });

  it("reads a wrapping label", () => {
    const root = form(`<label>Phone Number<input id="p" /></label>`);
    expect(keyFor(root, "#p")).toBe("phone");
  });

  it("reads aria-label and placeholder", () => {
    const root = form(`
      <input id="a" aria-label="LinkedIn Profile" />
      <input id="b" placeholder="Postal code" />
    `);
    expect(keyFor(root, "#a")).toBe("linkedinUrl");
    expect(keyFor(root, "#b")).toBe("postalCode");
  });

  it("prefers the more specific keyword", () => {
    // "first name" must win over the bare "name" substring.
    const root = form(`<label for="f">First Name</label><input id="f" />`);
    expect(keyFor(root, "#f")).toBe("firstName");
  });

  it("never touches password, hidden or file inputs", () => {
    const root = form(`
      <input type="password" aria-label="Email" />
      <input type="hidden" autocomplete="given-name" />
      <input type="file" aria-label="Phone" />
    `);
    expect(detectFields(root)).toHaveLength(0);
  });

  it("skips disabled and readonly fields", () => {
    const root = form(`
      <input autocomplete="email" disabled />
      <input autocomplete="tel-national" readonly />
    `);
    expect(detectFields(root)).toHaveLength(0);
  });

  it("claims each vault key only once", () => {
    // A confirm-email pair must not produce two fills from one key.
    const root = form(`
      <label for="e1">Email</label><input id="e1" />
      <label for="e2">Confirm Email</label><input id="e2" />
    `);
    const emails = detectFields(root).filter((m) => m.key === "email");
    expect(emails).toHaveLength(1);
    expect(emails[0]!.element).toBe(root.querySelector("#e1"));
  });

  it("leaves unrecognised fields alone rather than guessing", () => {
    const root = form(`<label for="x">Favourite dinosaur</label><input id="x" />`);
    expect(detectFields(root)).toHaveLength(0);
  });

  describe("remote field map", () => {
    const rules = [{ key: "phone", selector: "#weird" }] as const;

    it("applies an override rule the heuristics would have missed", () => {
      // No label, no autocomplete, an opaque id - unmatchable without the rule.
      const root = form(`<input id="weird" />`);

      expect(detectFields(root, null, "boards.greenhouse.io")).toHaveLength(0);
      expect(detectFields(root, map(rules), "boards.greenhouse.io")[0]?.key).toBe("phone");
    });

    it("lets an override beat autocomplete", () => {
      // Overrides exist because the automatic path got the form wrong, so they
      // must outrank it - otherwise they are useless where they matter most.
      const root = form(`<input id="weird" autocomplete="email" />`);
      const found = detectFields(root, map(rules), "boards.greenhouse.io");

      expect(found).toHaveLength(1);
      expect(found[0]!.key).toBe("phone");
    });

    it("matches a host by suffix", () => {
      const root = form(`<input id="weird" />`);
      // One "greenhouse.io" block should cover every subdomain.
      expect(detectFields(root, map(rules, "greenhouse.io"), "job-boards.greenhouse.io")).toHaveLength(1);
    });

    it("ignores rules for a different host", () => {
      const root = form(`<input id="weird" />`);
      expect(detectFields(root, map(rules, "lever.co"), "boards.greenhouse.io")).toHaveLength(0);
    });

    it("does not let a suffix match on a lookalike domain", () => {
      const root = form(`<input id="weird" />`);
      // "notgreenhouse.io" must not match a "greenhouse.io" rule.
      expect(detectFields(root, map(rules, "greenhouse.io"), "notgreenhouse.io")).toHaveLength(0);
    });

    it("survives a malformed selector in the served map", () => {
      // The map is fetched at runtime, so a bad rule must not take down
      // detection for the whole page.
      const root = form(`<label for="e">Email</label><input id="e" />`);
      const broken = map([{ key: "phone", selector: "###" }]);

      expect(detectFields(root, broken, "boards.greenhouse.io")[0]?.key).toBe("email");
    });

    it("carries the control hint through to the caller", () => {
      const root = form(`<input id="weird" />`);
      const combo = map([{ key: "phone", selector: "#weird", control: "combo" as const }]);

      expect(detectFields(root, combo, "boards.greenhouse.io")[0]?.control).toBe("combo");
    });
  });

  it("finds textarea and select elements too", () => {
    const root = form(`
      <label for="c">Cover Letter</label><textarea id="c"></textarea>
      <label for="g">Gender</label><select id="g"><option></option></select>
    `);
    expect(keyFor(root, "#c")).toBe("defaultCoverLetter");
    expect(keyFor(root, "#g")).toBe("gender");
  });
});

/**
 * The matching that has to be right rather than merely helpful.
 *
 * Every case below is one where a near-miss writes a WRONG value into a real
 * job application rather than leaving a blank - a name in the employer box, or
 * the salary you want in the box asking what you earn now. Nobody re-reads a
 * form they have just watched fill itself, so these are the cases the
 * exclusion lists in detect.ts exist for.
 */
describe("detectFields: fields that look alike", () => {
  it("fills a full name from a bare Name label", () => {
    const root = form(`<label for="n">Name</label><input id="n" />`);
    expect(keyFor(root, "#n")).toBe("fullName");
  });

  it("trusts autocomplete=name for a whole name", () => {
    const root = form(`<input id="n" autocomplete="name" />`);
    expect(keyFor(root, "#n")).toBe("fullName");
  });

  it("leaves First name and Last name to their own keys", () => {
    const root = form(`
      <label for="f">First name</label><input id="f" />
      <label for="l">Last name</label><input id="l" />
    `);
    expect(keyFor(root, "#f")).toBe("firstName");
    expect(keyFor(root, "#l")).toBe("lastName");
  });

  it("does not put the applicant's name in Company name", () => {
    const root = form(`<label for="c">Company name</label><input id="c" />`);
    expect(keyFor(root, "#c")).not.toBe("fullName");
  });

  it("does not answer School name or Reference name with a full name", () => {
    const root = form(`
      <label for="s">School name</label><input id="s" />
      <label for="r">Reference name</label><input id="r" />
    `);
    expect(keyFor(root, "#s")).not.toBe("fullName");
    expect(keyFor(root, "#r")).not.toBe("fullName");
  });

  it("separates current CTC from expected CTC", () => {
    const root = form(`
      <label for="a">What is your current CTC (Current Cost to Company)</label><input id="a" />
      <label for="b">What is your expected CTC (Expected Cost to Company)</label><input id="b" />
    `);
    expect(keyFor(root, "#a")).toBe("currentSalary");
    expect(keyFor(root, "#b")).toBe("desiredSalary");
  });

  it("reads a bare CTC as the salary you are on now", () => {
    const root = form(`<label for="c">CTC</label><input id="c" />`);
    expect(keyFor(root, "#c")).toBe("currentSalary");
  });

  it("keeps current and expected salary apart in plain English too", () => {
    const root = form(`
      <label for="a">Current salary</label><input id="a" />
      <label for="b">Expected salary</label><input id="b" />
    `);
    expect(keyFor(root, "#a")).toBe("currentSalary");
    expect(keyFor(root, "#b")).toBe("desiredSalary");
  });

  it("fills a bare Location with the composed location", () => {
    const root = form(`<label for="l">Location</label><input id="l" />`);
    expect(keyFor(root, "#l")).toBe("currentLocation");
  });

  it("leaves Current city to the city field, not the whole location", () => {
    // "Ahmedabad, Gujarat, India" is the wrong answer to a box asking for a city.
    const root = form(`<label for="c">Current city</label><input id="c" />`);
    expect(keyFor(root, "#c")).toBe("city");
  });

  it("does not answer Preferred location with where you already are", () => {
    const root = form(`<label for="p">Preferred work location</label><input id="p" />`);
    expect(keyFor(root, "#p")).not.toBe("currentLocation");
  });

  it("still matches the derived current employer keys", () => {
    // These come from the ticked role rather than a field of their own, so a
    // contract re-sync that dropped them would silently stop filling here.
    const root = form(`
      <label for="c">Current employer</label><input id="c" />
      <label for="t">Current title</label><input id="t" />
    `);
    expect(keyFor(root, "#c")).toBe("currentCompany");
    expect(keyFor(root, "#t")).toBe("currentTitle");
  });

  it("trusts autocomplete=organization for a current employer", () => {
    const root = form(`<input id="o" autocomplete="organization" />`);
    expect(keyFor(root, "#o")).toBe("currentCompany");
  });
});

/**
 * Forms that never wrote a `<label>`.
 *
 * A question rendered as a plain div above its input looks identical to a
 * human and is invisible to `element.labels`. Without the nearby-text fallback
 * these fields carry no signature at all beyond a generated `name`, so matching
 * them is not merely unreliable - it is impossible.
 */
describe("detectFields: unassociated label text", () => {
  it("reads a question rendered as a div above the field", () => {
    const root = form(`
      <div class="q">
        <div class="qtext">What is your current CTC (Current Cost to Company)?</div>
        <textarea name="answer_8321"></textarea>
      </div>
    `);
    expect(keyFor(root, "textarea")).toBe("currentSalary");
  });

  it("still separates current from expected when neither has a label", () => {
    const root = form(`
      <div class="q"><div>What is your current CTC (Current Cost to Company)?</div>
        <textarea name="a_1"></textarea></div>
      <div class="q"><div>What is your expected CTC (Expected Cost to Company)?</div>
        <textarea name="a_2"></textarea></div>
    `);
    expect(keyFor(root, '[name="a_1"]')).toBe("currentSalary");
    expect(keyFor(root, '[name="a_2"]')).toBe("desiredSalary");
  });

  it("reads a label sitting beside the field in a row", () => {
    const root = form(`<div class="row"><span>Current location</span><input name="f_9912" /></div>`);
    expect(keyFor(root, "input")).toBe("currentLocation");
  });

  it("refuses text from a container holding more than one field", () => {
    // THE CASE THIS GUARD EXISTS FOR. Both inputs would otherwise inherit
    // "First name Last name" and each look equally like both - and a confident
    // match on the wrong half writes a surname into the given-name box.
    const root = form(`
      <div class="pair">
        First name Last name
        <input name="p_1" /><input name="p_2" />
      </div>
    `);
    expect(keyFor(root, '[name="p_1"]')).toBeUndefined();
    expect(keyFor(root, '[name="p_2"]')).toBeUndefined();
  });

  it("does not let a real label be overridden by surrounding text", () => {
    // The label is the author's own answer; nearby text is only ever a guess,
    // so it must not get a vote when a label exists.
    const root = form(`
      <div class="q">
        Tell us about your current CTC
        <label for="e">Email</label><input id="e" />
      </div>
    `);
    expect(keyFor(root, "#e")).toBe("email");
  });

  it("does not swallow a country dropdown's option list as description", () => {
    const root = form(`
      <div class="q">
        <div>Current location</div>
        <input name="loc_1" />
      </div>
      <div class="q">
        <select name="c"><option>India</option><option>United States</option></select>
      </div>
    `);
    expect(keyFor(root, '[name="loc_1"]')).toBe("currentLocation");
  });
});
