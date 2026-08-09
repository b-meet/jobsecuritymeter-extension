import { DERIVED_FIELDS, VAULT_FIELDS, isTagList, type VaultData } from "@/shared/vault";
import { combineExperience, formatExperience } from "./experience";

/**
 * Everything the matcher may fill, and how to turn a key into a value.
 *
 * Four kinds of key end up here, and detection cannot tell them apart - nor
 * should it. It matches an input to a key and asks for a value.
 *
 *   1. STORED. A key the user typed into the profile editor.
 *   2. DERIVED. Computed by the API and sent flat - `currentCompany` from the
 *      ticked role. Declared in shared/vault.ts, which is the synced contract.
 *   3. COMPOSED. Assembled here, in the extension, by joining stored values.
 *   4. COMPUTED. Assembled here too, but by reading ONE stored value and
 *      transforming it - "5.5" years of experience into a years box and a
 *      months box.
 *
 * WHY COMPOSED AND COMPUTED KEYS LIVE HERE AND NOT IN THE CONTRACT. They are
 * rearrangements of values the extension already holds - "full name" is first
 * plus last, nothing more. Sending them from the API would grow the payload
 * with data it already contains and force a contract re-sync every time a form
 * taught us a new shape. Derived keys are different: they read `roles`, and the
 * extension should not have to understand the shape of a list to answer
 * "current employer".
 */

export type FillableField = {
  key: string;
  label: string;
  autocomplete?: string;
};

type CompositeField = FillableField & {
  /** Stored keys read, in order. Blank parts are skipped, not padded. */
  parts: readonly string[];
  separator: string;
};

type ComputedField = FillableField & {
  /**
   * Reads the whole vault rather than one named key.
   *
   * Total experience is stored across two boxes, and one of these keys
   * deliberately shadows a stored key of the same name, so a single `from`
   * was not enough for either.
   *
   * Returns undefined when the stored values cannot be read as this shape.
   */
  compute: (data: VaultData) => string | undefined;
};

/**
 * Keys with no slot of their own in the vault.
 *
 * Each one exists because forms ask for it as a single input while the profile
 * collects it in pieces. Filling nothing into a "Full name" box because we
 * happen to store two halves is a bad answer when we plainly know the name.
 */
const COMPOSITES: readonly CompositeField[] = [
  {
    key: "fullName",
    label: "Full name",
    // The standard token for a whole name. Sites that set it are telling us
    // outright, and it outranks every keyword guess below.
    autocomplete: "name",
    parts: ["firstName", "lastName"],
    separator: " ",
  },
  {
    key: "currentLocation",
    label: "Current location",
    // City and state, and deliberately NOT the street address. A form asking
    // "Location" wants somewhere to place you, not somewhere to post a letter -
    // volunteering a home address to a job board is worse than an empty box.
    //
    // Country is left off too. "Ahmedabad, Gujarat" and "San Francisco, CA" are
    // what these boxes expect; a form that wants the country asks for it in a
    // field of its own, which `country` already answers.
    parts: ["city", "state"],
    separator: ", ",
  },
];

const COMPOSITE_FIELDS: ReadonlyMap<string, CompositeField> = new Map(
  COMPOSITES.map((field) => [field.key, field] as const),
);

/**
 * Keys that re-shape a single stored answer to fit how a form asks for it.
 *
 * "Total experience" is the one that made this necessary. The profile keeps it
 * as one box because that is how somebody thinks about it, while a good share
 * of forms - Keka and most of the Indian ATSs - split it into a Years input and
 * a Months dropdown standing next to each other. Both controls are real,
 * separately labelled, and separately matched; without these keys the matcher
 * recognises them and then has nothing to offer either one.
 *
 * A months value of "0" is a real answer, not a blank, and is filled as such -
 * five years of experience means zero months, and a Months dropdown left on its
 * placeholder is an unanswered question on a form that will not submit.
 */
function text(data: VaultData, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

/** The profile's two experience boxes as one answer. */
function experienceOf(data: VaultData) {
  return combineExperience(text(data, "yearsExperience"), text(data, "monthsExperience"));
}

const COMPUTED: readonly ComputedField[] = [
  {
    key: "experienceYears",
    label: "Experience (years)",
    compute: (data) => {
      const parsed = experienceOf(data);
      return parsed ? String(parsed.years) : undefined;
    },
  },
  {
    key: "experienceMonths",
    label: "Experience (months)",
    compute: (data) => {
      const parsed = experienceOf(data);
      return parsed ? String(parsed.months) : undefined;
    },
  },
  {
    /**
     * DELIBERATELY SHADOWS THE STORED KEY OF THE SAME NAME.
     *
     * A form that asks for total experience in one box should get the whole
     * answer, and the whole answer now lives in two boxes: somebody who filled
     * in 5 years and 6 months would otherwise have "5" written into it and lose
     * the half.
     *
     * The raw string is passed through untouched whenever there is no separate
     * months figure to fold in. That matters - "10+" is a perfectly good answer
     * to "years of experience" and normalising it to "10" would be us editing
     * what the user wrote for no reason.
     */
    key: "yearsExperience",
    label: "Years of experience",
    compute: (data) => {
      const raw = text(data, "yearsExperience").trim();
      const months = text(data, "monthsExperience").trim();
      if (months === "") return raw === "" ? undefined : raw;

      const parsed = combineExperience(raw, months);
      if (!parsed) return raw === "" ? undefined : raw;

      return formatExperience(parsed);
    },
  },
];

const COMPUTED_FIELDS: ReadonlyMap<string, ComputedField> = new Map(
  COMPUTED.map((field) => [field.key, field] as const),
);

/**
 * A list cannot be typed into a single input, so `roles` and `additionalLinks`
 * are not offered to the matcher at all. Their useful content reaches forms
 * through the derived keys instead.
 */
const SCALAR_VAULT_FIELDS = [...VAULT_FIELDS.values()].filter((field) => field.type !== "list");

const FILLABLE_ENTRIES: readonly (readonly [string, FillableField])[] = [
  ...SCALAR_VAULT_FIELDS,
  ...DERIVED_FIELDS.values(),
  ...COMPOSITE_FIELDS.values(),
  ...COMPUTED_FIELDS.values(),
].map((field) => [field.key, field] as const);

export const FILLABLE_FIELDS: ReadonlyMap<string, FillableField> = new Map(FILLABLE_ENTRIES);

/**
 * Resolve one key against a vault payload.
 *
 * Returns `undefined` for anything not worth writing, which the caller treats
 * as "the user has not filled this in" rather than as a failure. A list value
 * lands there too: it is real data, but not data that belongs in a text box.
 */
export function resolveValue(key: string, data: VaultData): string | boolean | undefined {
  const computed = COMPUTED_FIELDS.get(key);
  if (computed) return computed.compute(data);

  /**
   * A tag list becomes one comma-separated string.
   *
   * That is how forms ask for skills - a single input, occasionally a textarea,
   * and the comma is the separator every one of them expects. The order is the
   * user's own, which is why the editor tells them to put what they want seen
   * first: a form with a length cap will keep the front of this string.
   */
  if (VAULT_FIELDS.get(key)?.type === "tags") {
    const value = data[key];
    if (!isTagList(value)) return undefined;

    const joined = value
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "")
      .join(", ");

    return joined === "" ? undefined : joined;
  }

  const composite = COMPOSITE_FIELDS.get(key);

  if (composite) {
    const joined = composite.parts
      .map((part) => data[part])
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .map((part) => part.trim())
      .join(composite.separator);

    // Half a composite is still worth having - a profile with a first name and
    // no last name should fill "Meet", not nothing.
    return joined === "" ? undefined : joined;
  }

  const value = data[key];
  if (typeof value === "string" || typeof value === "boolean") return value;
  return undefined;
}
