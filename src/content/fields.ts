import { DERIVED_FIELDS, VAULT_FIELDS, type VaultData } from "@/shared/vault";

/**
 * Everything the matcher may fill, and how to turn a key into a value.
 *
 * Three kinds of key end up here, and detection cannot tell them apart - nor
 * should it. It matches an input to a key and asks for a value.
 *
 *   1. STORED. A key the user typed into the profile editor.
 *   2. DERIVED. Computed by the API and sent flat - `currentCompany` from the
 *      ticked role. Declared in shared/vault.ts, which is the synced contract.
 *   3. COMPOSED. Assembled here, in the extension, from stored values.
 *
 * WHY COMPOSED KEYS LIVE HERE AND NOT IN THE CONTRACT. They are a joining of
 * values the extension already holds - "full name" is first plus last, nothing
 * more. Sending them from the API would grow the payload with data it already
 * contains and force a contract re-sync every time a form taught us a new
 * shape. Derived keys are different: they read `roles`, and the extension
 * should not have to understand the shape of a list to answer "current
 * employer".
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
    // Deliberately city upward, and deliberately NOT the street address. A form
    // asking "Location" wants somewhere to place you, not somewhere to post a
    // letter - and volunteering a home address to a job board is worse than
    // leaving the box empty.
    parts: ["city", "state", "country"],
    separator: ", ",
  },
];

const COMPOSITE_FIELDS: ReadonlyMap<string, CompositeField> = new Map(
  COMPOSITES.map((field) => [field.key, field] as const),
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
