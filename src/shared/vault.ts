/**
 * Single source of truth for the Job Autofill profile vault.
 *
 * Deliberately framework-neutral and free of `server-only`, so the same field
 * definitions drive every side:
 *
 *   - app/api/vault              - validates and persists a change.
 *   - lib/server/vault           - reads and writes the row.
 *   - the browser extension      - fills forms from these exact keys.
 *
 * The extension lives in a separate repository, so this file is the contract
 * between the two. Renaming a key here silently breaks autofill for every
 * installed extension until it ships an update - add a new key and migrate
 * instead.
 *
 * WHY MOSTLY JSONB: applicant tracking systems churn their field sets
 * constantly. Storing the profile as a single `data` blob means adding
 * "notice period" is a change to this file, not a database migration. Only
 * `user_id`, `schema_version` and `updated_at` are first-class columns,
 * because those are the things we query and sync on.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *   - The resume FILE. We have never stored the binary, only extracted text
 *     (`evaluations.resume_text`, `resume_scans.original_text`). Attaching a
 *     PDF to an application needs Supabase Storage plus a retention and
 *     deletion story, which is phase 2. `resumeEvaluationId` is the pointer
 *     that will connect them.
 *   - Anything more sensitive than the EEO block below. The extension holds a
 *     Supabase refresh token in `chrome.storage.local`, which is extractable
 *     by anyone with local filesystem access. That is an acceptable risk for
 *     contact details; it is not one for government identifiers, so those must
 *     not be added here without app-level encryption first.
 */

/**
 * 1 - initial flat profile.
 * 2 - `list` fields arrive (`additionalLinks`, `previousRoles`), so a value can
 *     now be an array of flat rows and not just a string or boolean.
 *     The single `otherUrl` folded into `additionalLinks`.
 * 3 - `previousRoles` became `roles` and swallowed the current job, which used
 *     to be its own `currentCompany` / `currentTitle` pair. Those two keys
 *     still exist for the extension but are now DERIVED - see deriveCurrentRole.
 *
 * Both steps run on read; see migrateVaultData.
 */
export const VAULT_SCHEMA_VERSION = 3;

/* -------------------------------------------------------------------------- */
/* Field definitions                                                          */
/* -------------------------------------------------------------------------- */

export type VaultFieldType =
  | "text"
  | "textarea"
  | "email"
  | "tel"
  | "url"
  | "date"
  | "boolean"
  | "choice"
  | "list";

/**
 * Ceiling on rows in a repeatable list.
 *
 * The whole profile is one jsonb blob that the extension pulls on every fill,
 * so an unbounded list is an unbounded payload on someone else's careers page.
 * Twenty is far past a real work history and cheap to hold.
 */
export const MAX_LIST_ITEMS = 20;

export type VaultFieldGroupId =
  | "identity"
  | "location"
  | "links"
  | "authorization"
  | "current"
  | "preferences"
  | "eeo";

/**
 * Tabs the editor splits the groups across. Seven groups in one column is a
 * long scroll for a form nobody enjoys filling in, so related groups share a
 * tab and the user finishes one short screen at a time.
 *
 * The grouping is not arbitrary. Identity and location sit together because
 * that is exactly the cluster the browser's own autofill knows how to fill in
 * one shot (name, email, phone, street, city, postcode) - splitting them would
 * turn one keystroke into two trips through the tabs.
 */
export type VaultTabId = "personal" | "work" | "availability" | "voluntary";

export const VAULT_TABS: readonly { id: VaultTabId; label: string }[] = [
  { id: "personal", label: "About you" },
  { id: "work", label: "Work" },
  { id: "availability", label: "Availability" },
  { id: "voluntary", label: "Voluntary" },
] as const;

export type VaultField = {
  key: string;
  type: VaultFieldType;
  label: string;
  /**
   * HTML autocomplete token this field maps to, when one exists. This is the
   * single highest-signal hint on a real application form - far more reliable
   * than guessing from a label - so the extension's matcher tries it first.
   */
  autocomplete?: string;
  /** Allowed values for `choice` fields. Anything else is rejected on write. */
  options?: readonly string[];
  maxLength?: number;
  /** Visible rows for a `textarea`. */
  rows?: number;
  /**
   * Shape of one row in a `list`. Item fields are scalars only - nesting a
   * list inside a list buys nothing and complicates every validator on the
   * path.
   */
  itemFields?: readonly VaultField[];
  /** Singular noun for a `list` row, used for "Add link" / "Remove link 2". */
  itemNoun?: string;
};

/**
 * A flat key the API computes and sends, but the editor never renders.
 *
 * Carries the same metadata as a real field because the EXTENSION cannot tell
 * the difference and should not have to - it matches a form input to a key and
 * asks for a value, whether that value was typed or computed. `autocomplete` in
 * particular has to survive the trip: "organization" is the strongest signal
 * there is for a "current employer" input.
 */
export type DerivedField = VaultField & {
  /** Key on the ticked `roles` row that feeds this one. */
  fromRole: string;
};

export const REMOTE_PREFERENCES = ["onsite", "hybrid", "remote", "no_preference"] as const;

/**
 * US EEO answers. "decline" is the default everywhere and must stay first:
 * these are voluntary self-identification questions, and pre-filling anything
 * else by default would answer them on the user's behalf.
 */
export const EEO_DECLINE = "decline";
export const EEO_GENDER = [EEO_DECLINE, "male", "female", "non_binary"] as const;
export const EEO_VETERAN = [EEO_DECLINE, "not_a_veteran", "protected_veteran", "veteran"] as const;
export const EEO_DISABILITY = [EEO_DECLINE, "yes", "no"] as const;
export const EEO_ETHNICITY = [
  EEO_DECLINE,
  "hispanic_latino",
  "white",
  "black_african_american",
  "asian",
  "native_american_alaska_native",
  "native_hawaiian_pacific_islander",
  "two_or_more",
] as const;

export const VAULT_FIELD_GROUPS: readonly {
  id: VaultFieldGroupId;
  /**
   * Which editor tab this group appears under. Required rather than optional
   * so a group added here cannot quietly render nowhere - TypeScript makes you
   * choose a home for it.
   */
  tab: VaultTabId;
  label: string;
  description: string;
  fields: readonly VaultField[];
}[] = [
  {
    id: "identity",
    tab: "personal",
    label: "Identity",
    description: "The block every application form opens with.",
    fields: [
      { key: "firstName", type: "text", label: "First name", autocomplete: "given-name", maxLength: 100 },
      { key: "lastName", type: "text", label: "Last name", autocomplete: "family-name", maxLength: 100 },
      { key: "preferredName", type: "text", label: "Preferred name", autocomplete: "nickname", maxLength: 100 },
      { key: "pronouns", type: "text", label: "Pronouns", maxLength: 40 },
      { key: "email", type: "email", label: "Email", autocomplete: "email", maxLength: 254 },
      { key: "phone", type: "tel", label: "Phone", autocomplete: "tel-national", maxLength: 40 },
      { key: "phoneCountryCode", type: "text", label: "Country code", autocomplete: "tel-country-code", maxLength: 8 },
    ],
  },
  {
    id: "location",
    tab: "personal",
    label: "Location",
    description: "Mailing address, asked for on most US and UK forms.",
    fields: [
      { key: "addressLine1", type: "text", label: "Address line 1", autocomplete: "address-line1", maxLength: 200 },
      { key: "addressLine2", type: "text", label: "Address line 2", autocomplete: "address-line2", maxLength: 200 },
      { key: "city", type: "text", label: "City", autocomplete: "address-level2", maxLength: 100 },
      { key: "state", type: "text", label: "State / province", autocomplete: "address-level1", maxLength: 100 },
      { key: "postalCode", type: "text", label: "Postal code", autocomplete: "postal-code", maxLength: 20 },
      { key: "country", type: "text", label: "Country", autocomplete: "country-name", maxLength: 100 },
    ],
  },
  {
    id: "links",
    tab: "work",
    label: "Links",
    description: "Profiles recruiters ask for by name, plus anything else worth sending.",
    fields: [
      // The three named links stay named. An ATS asks for "LinkedIn URL" in a
      // labelled input of its own, so the extension needs to know which link is
      // which - a bare list of URLs would leave it guessing.
      { key: "linkedinUrl", type: "url", label: "LinkedIn", autocomplete: "url", maxLength: 300 },
      { key: "githubUrl", type: "url", label: "GitHub", maxLength: 300 },
      { key: "portfolioUrl", type: "url", label: "Portfolio / website", maxLength: 300 },
      {
        // Replaces the old single `otherUrl`. Everything past the named three
        // is a free-for-all - Behance, a paper, a second GitHub - so it is a
        // list rather than one more fixed slot.
        key: "additionalLinks",
        type: "list",
        label: "Other links",
        itemNoun: "link",
        itemFields: [
          { key: "label", type: "text", label: "Label", maxLength: 60 },
          { key: "url", type: "url", label: "URL", maxLength: 300 },
        ],
      },
    ],
  },
  {
    id: "authorization",
    tab: "availability",
    label: "Work authorisation",
    description: "The near-universal yes/no pair on US applications.",
    fields: [
      { key: "workAuthorized", type: "boolean", label: "Authorised to work in the country you're applying to" },
      { key: "requiresSponsorship", type: "boolean", label: "Will require visa sponsorship" },
    ],
  },
  {
    id: "current",
    tab: "work",
    label: "Work experience",
    description:
      "Every role, newest first. Tick the one you're in now — that's the one we put in “current employer” and “current title” on applications.",
    fields: [
      { key: "yearsExperience", type: "text", label: "Years of experience", maxLength: 10 },
      {
        // One list, current role included, rather than a fixed pair of
        // "current company / current title" inputs sitting above it. The
        // extension still gets its flat `currentCompany` / `currentTitle` keys
        // - deriveCurrentRole writes them from the ticked row on every save,
        // so the contract survives without the user typing anything twice.
        key: "roles",
        type: "list",
        label: "Roles",
        itemNoun: "role",
        itemFields: [
          { key: "company", type: "text", label: "Company", maxLength: 200 },
          { key: "title", type: "text", label: "Title", maxLength: 200 },
          { key: "current", type: "boolean", label: "I currently work here" },
          { key: "startDate", type: "date", label: "Start date" },
          { key: "endDate", type: "date", label: "End date" },
          { key: "description", type: "textarea", label: "What you did", maxLength: 2000, rows: 3 },
        ],
      },
    ],
  },
  {
    id: "preferences",
    tab: "availability",
    label: "Availability and preferences",
    description:
      "The questions that decide whether you make the shortlist. The two salary fields also answer “current CTC” and “expected CTC”.",
    fields: [
      // Split from `desiredSalary` because forms routinely ask for both, and
      // filling what you want into a box asking what you earn now is a bad
      // enough mistake that leaving it blank would be the better outcome.
      { key: "currentSalary", type: "text", label: "Current salary", maxLength: 40 },
      { key: "desiredSalary", type: "text", label: "Desired salary", maxLength: 40 },
      { key: "salaryCurrency", type: "text", label: "Currency", maxLength: 10 },
      { key: "noticePeriod", type: "text", label: "Notice period", maxLength: 60 },
      { key: "earliestStartDate", type: "date", label: "Earliest start date" },
      { key: "willingToRelocate", type: "boolean", label: "Willing to relocate" },
      { key: "remotePreference", type: "choice", label: "Work preference", options: REMOTE_PREFERENCES },
      { key: "howDidYouHear", type: "text", label: "How did you hear about us", maxLength: 300 },
      // Both hold paragraphs - a cover letter runs to 8000 characters - so a
      // one-line input showed the user a keyhole view of what they had written.
      { key: "summary", type: "textarea", label: "Professional summary", maxLength: 2000, rows: 4 },
      { key: "defaultCoverLetter", type: "textarea", label: "Default cover letter", maxLength: 8000, rows: 8 },
    ],
  },
  {
    id: "eeo",
    tab: "voluntary",
    label: "Voluntary self-identification",
    description:
      "US equal-opportunity questions. Always optional, and every field defaults to declining to answer.",
    fields: [
      { key: "gender", type: "choice", label: "Gender", options: EEO_GENDER },
      { key: "raceEthnicity", type: "choice", label: "Race / ethnicity", options: EEO_ETHNICITY },
      { key: "veteranStatus", type: "choice", label: "Veteran status", options: EEO_VETERAN },
      { key: "disabilityStatus", type: "choice", label: "Disability status", options: EEO_DISABILITY },
    ],
  },
] as const;

/** Every field, flattened, keyed for O(1) lookup during validation. */
export const VAULT_FIELDS: ReadonlyMap<string, VaultField> = new Map(
  VAULT_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, field] as const)),
);

/** One row of a `list` field. Flat by construction - never a nested list. */
export type VaultListItem = Record<string, string | boolean>;

export type VaultValue = string | boolean | VaultListItem[];

export type VaultData = Record<string, VaultValue>;

export type Vault = {
  data: VaultData;
  schemaVersion: number;
  updatedAt: string | null;
};

/** Empty vault - what a user has until they save something. */
export const EMPTY_VAULT: Vault = {
  data: {},
  schemaVersion: VAULT_SCHEMA_VERSION,
  updatedAt: null,
};

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type VaultValidationResult = {
  /** Only known keys with values of the right shape. Safe to persist. */
  data: VaultData;
  /** Keys that were dropped, so the caller can say why rather than failing silently. */
  rejected: string[];
};

/**
 * Whitelist an incoming payload down to known fields.
 *
 * Mirrors the approach in app/api/account/email-preferences: unknown keys are
 * DROPPED rather than trusted, because this object is written straight into a
 * jsonb column and later read back by an extension that injects it into web
 * pages. An attacker-controlled key that survives to that point is a script
 * injection waiting to happen on someone else's careers site.
 *
 * Empty strings are preserved rather than dropped: clearing a field is a
 * meaningful edit, and PATCH has no other way to express it.
 */
/**
 * Whitelist one `list` value down to known item fields.
 *
 * Returns null - meaning "reject the whole key" - rather than a partial list.
 * The same reasoning as the top-level whitelist applies with more force here:
 * these rows end up injected into someone else's careers page, so an unknown
 * sub-key is a fact about the payload we do not want to paper over.
 */
function validateListValue(field: VaultField, value: unknown): VaultListItem[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) return null;

  const items: VaultListItem[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

    const item: VaultListItem = {};

    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
      const itemField = field.itemFields?.find((candidate) => candidate.key === key);
      if (!itemField) return null;

      if (itemField.type === "boolean") {
        if (typeof entry !== "boolean") return null;
        item[key] = entry;
        continue;
      }

      if (typeof entry !== "string") return null;

      const trimmed = entry.trim();
      if (itemField.maxLength && trimmed.length > itemField.maxLength) return null;

      item[key] = trimmed;
    }

    items.push(item);
  }

  return items;
}

export function validateVaultData(input: unknown): VaultValidationResult {
  const data: VaultData = {};
  const rejected: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { data, rejected };
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const field = VAULT_FIELDS.get(key);
    if (!field) {
      rejected.push(key);
      continue;
    }

    if (field.type === "boolean") {
      if (typeof value !== "boolean") {
        rejected.push(key);
        continue;
      }
      data[key] = value;
      continue;
    }

    if (field.type === "list") {
      const items = validateListValue(field, value);
      // All-or-nothing: one malformed row rejects the whole list rather than
      // being quietly dropped, because silently losing a job the user typed out
      // is worse than telling them the save did not take.
      if (!items) {
        rejected.push(key);
        continue;
      }
      data[key] = items;
      continue;
    }

    if (typeof value !== "string") {
      rejected.push(key);
      continue;
    }

    const trimmed = value.trim();

    if (field.type === "choice") {
      // An empty choice means "not set", which is legitimate. Any other value
      // has to be one we published.
      if (trimmed && !field.options?.includes(trimmed)) {
        rejected.push(key);
        continue;
      }
      data[key] = trimmed;
      continue;
    }

    if (field.maxLength && trimmed.length > field.maxLength) {
      rejected.push(key);
      continue;
    }

    data[key] = trimmed;
  }

  return { data, rejected };
}

/* -------------------------------------------------------------------------- */
/* Migration                                                                  */
/* -------------------------------------------------------------------------- */

/** Dropped in schema 2. Named here only so the migration can still find it. */
const LEGACY_OTHER_URL = "otherUrl";

/**
 * Keys the editor no longer shows but the extension still fills.
 *
 * They are DERIVED, not typed: deriveCurrentRole rewrites them from whichever
 * role is ticked "current" every time the vault is written. They are absent
 * from VAULT_FIELD_GROUPS on purpose, so validateVaultData rejects a client
 * that tries to set them by hand and there is exactly one writer.
 */
export const DERIVED_FIELDS: ReadonlyMap<string, DerivedField> = new Map(
  (
    [
      {
        key: "currentCompany",
        type: "text",
        label: "Current company",
        autocomplete: "organization",
        maxLength: 200,
        fromRole: "company",
      },
      {
        key: "currentTitle",
        type: "text",
        label: "Current title",
        autocomplete: "organization-title",
        maxLength: 200,
        fromRole: "title",
      },
    ] as const satisfies readonly DerivedField[]
  ).map((field) => [field.key, field] as const),
);

export const DERIVED_KEYS: readonly string[] = [...DERIVED_FIELDS.keys()];

/**
 * Project the ticked role onto the flat keys the extension reads.
 *
 * An ATS asks "current employer" and "current title" as single labelled
 * inputs far more often than it asks for a full history, so those keys have to
 * keep existing even though the editor now collects them as one row among
 * many. Falls back to the first row with content when nothing is ticked -
 * roles are entered newest first, so that is the best available guess - and
 * clears the keys when there is no usable row at all, rather than leaving a
 * stale employer behind after the row is deleted.
 */
export function deriveCurrentRole(data: VaultData): VaultData {
  const roles = Array.isArray(data.roles) ? data.roles : [];
  const filled = roles.filter(listItemHasContent);
  const current = filled.find((role) => role.current === true) ?? filled[0];

  const derived = { ...data };

  for (const field of DERIVED_FIELDS.values()) {
    const { key } = field;
    const value = current?.[field.fromRole];
    // Cleared rather than left alone when there is no usable row, so deleting
    // the last role does not leave a stale employer behind to be filled into
    // the next application.
    if (typeof value === "string" && value !== "") derived[key] = value;
    else delete derived[key];
  }

  return derived;
}

/**
 * Bring a stored blob up to the current schema.
 *
 * Runs on read rather than as a one-off backfill, so a row written before the
 * upgrade is repaired the next time anyone looks at it and nothing has to be
 * coordinated with a deploy. Idempotent - a migrated blob passes through
 * untouched, which matters because this runs on every read.
 */
export function migrateVaultData(input: VaultData): VaultData {
  let data = migrateOtherUrl(input);
  data = migrateRoles(data);
  return data;
}

/** Schema 2: the single `otherUrl` slot became a row in `additionalLinks`. */
function migrateOtherUrl(data: VaultData): VaultData {
  const legacy = data[LEGACY_OTHER_URL];
  if (typeof legacy !== "string") return data;

  const migrated = { ...data };
  delete migrated[LEGACY_OTHER_URL];

  const url = legacy.trim();
  if (url === "") return migrated;

  const existing = Array.isArray(data.additionalLinks) ? data.additionalLinks : [];
  if (!existing.some((link) => link.url === url)) {
    migrated.additionalLinks = [...existing, { label: "Other", url }];
  }

  return migrated;
}

/**
 * Schema 3: `previousRoles` became `roles`, and the separately-typed current
 * company/title became the first row of it, ticked.
 *
 * The derived keys are left in place afterwards - deriveCurrentRole owns them
 * from here, and it will rewrite them from the row on the next save.
 */
function migrateRoles(data: VaultData): VaultData {
  const hasLegacyList = Array.isArray(data.previousRoles);
  const company = typeof data.currentCompany === "string" ? data.currentCompany.trim() : "";
  const title = typeof data.currentTitle === "string" ? data.currentTitle.trim() : "";
  const needsCurrentRow = (company !== "" || title !== "") && !Array.isArray(data.roles);

  if (!hasLegacyList && !needsCurrentRow) return data;

  const migrated = { ...data };
  const previous = Array.isArray(data.previousRoles) ? data.previousRoles : [];
  delete migrated.previousRoles;

  const existing = Array.isArray(data.roles) ? data.roles : [];
  // Newest first, so the role they are in now leads.
  const currentRow: VaultListItem[] =
    needsCurrentRow && !existing.some((role) => role.current === true)
      ? [{ company, title, current: true }]
      : [];

  migrated.roles = [...currentRow, ...existing, ...previous];
  return migrated;
}

/**
 * Has this row been given any real detail?
 *
 * Deliberately ignores booleans. Ticking "I currently work here" on an
 * otherwise blank row is not detail, and treating it as such would both inflate
 * the progress bar and unlock the "add another" button on an empty row - the
 * two places this predicate is used.
 */
export function listItemHasContent(item: VaultListItem): boolean {
  return Object.values(item).some((entry) => typeof entry === "string" && entry.trim() !== "");
}

/**
 * Does this value count towards completion?
 *
 * `false` is an answer, so a top-level boolean always counts. A list counts
 * once it holds a row with something in it - a blank row the user added and
 * never filled is not progress.
 */
function isFilled(value: VaultValue | undefined): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.some(listItemHasContent);
  return false;
}

/**
 * How much of the vault is filled in - drives the "profile complete" nudge.
 *
 * `keys` narrows the count to a slice of the profile, which is how the editor
 * puts a per-tab counter on each tab: without it a tab you have finished looks
 * identical to one you have not opened yet.
 */
export function vaultCompletion(
  data: VaultData,
  keys: Iterable<string> = VAULT_FIELDS.keys(),
): { filled: number; total: number } {
  let filled = 0;
  let total = 0;

  for (const key of keys) {
    total += 1;
    if (isFilled(data[key])) filled += 1;
  }

  return { filled, total };
}
