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

export const VAULT_SCHEMA_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Field definitions                                                          */
/* -------------------------------------------------------------------------- */

export type VaultFieldType = "text" | "email" | "tel" | "url" | "date" | "boolean" | "choice";

export type VaultFieldGroupId =
  | "identity"
  | "location"
  | "links"
  | "authorization"
  | "current"
  | "preferences"
  | "eeo";

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
  label: string;
  description: string;
  fields: readonly VaultField[];
}[] = [
  {
    id: "identity",
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
    label: "Links",
    description: "Profiles recruiters ask for by name.",
    fields: [
      { key: "linkedinUrl", type: "url", label: "LinkedIn", autocomplete: "url", maxLength: 300 },
      { key: "githubUrl", type: "url", label: "GitHub", maxLength: 300 },
      { key: "portfolioUrl", type: "url", label: "Portfolio / website", maxLength: 300 },
      { key: "otherUrl", type: "url", label: "Other link", maxLength: 300 },
    ],
  },
  {
    id: "authorization",
    label: "Work authorisation",
    description: "The near-universal yes/no pair on US applications.",
    fields: [
      { key: "workAuthorized", type: "boolean", label: "Authorised to work in the country you're applying to" },
      { key: "requiresSponsorship", type: "boolean", label: "Will require visa sponsorship" },
    ],
  },
  {
    id: "current",
    label: "Current role",
    description: "Used for the 'where do you work now' fields.",
    fields: [
      { key: "currentCompany", type: "text", label: "Current company", autocomplete: "organization", maxLength: 200 },
      { key: "currentTitle", type: "text", label: "Current title", autocomplete: "organization-title", maxLength: 200 },
      { key: "yearsExperience", type: "text", label: "Years of experience", maxLength: 10 },
    ],
  },
  {
    id: "preferences",
    label: "Availability and preferences",
    description: "The questions that decide whether you make the shortlist.",
    fields: [
      { key: "desiredSalary", type: "text", label: "Desired salary", maxLength: 40 },
      { key: "salaryCurrency", type: "text", label: "Currency", maxLength: 10 },
      { key: "noticePeriod", type: "text", label: "Notice period", maxLength: 60 },
      { key: "earliestStartDate", type: "date", label: "Earliest start date" },
      { key: "willingToRelocate", type: "boolean", label: "Willing to relocate" },
      { key: "remotePreference", type: "choice", label: "Work preference", options: REMOTE_PREFERENCES },
      { key: "howDidYouHear", type: "text", label: "How did you hear about us", maxLength: 300 },
      { key: "summary", type: "text", label: "Professional summary", maxLength: 2000 },
      { key: "defaultCoverLetter", type: "text", label: "Default cover letter", maxLength: 8000 },
    ],
  },
  {
    id: "eeo",
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

export type VaultData = Record<string, string | boolean>;

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

/** How much of the vault is filled in - drives the "profile complete" nudge. */
export function vaultCompletion(data: VaultData): { filled: number; total: number } {
  let filled = 0;
  for (const key of VAULT_FIELDS.keys()) {
    const value = data[key];
    if (typeof value === "boolean" || (typeof value === "string" && value !== "")) {
      filled += 1;
    }
  }
  return { filled, total: VAULT_FIELDS.size };
}
