import { FILLABLE_FIELDS } from "./fields";

/**
 * Mapping DOM fields to vault keys.
 *
 * Layered, cheapest and most reliable first:
 *
 *   1. `autocomplete` attribute. By far the strongest signal - it is a
 *      standardised token the site author wrote deliberately, and most vault
 *      fields declare the one they correspond to. When present it is trusted
 *      outright.
 *   2. Remote field map, keyed by hostname. Served from our API so a broken
 *      Greenhouse selector is a deploy, not a store review.
 *   3. Keyword scoring over the field's visible text - label, placeholder,
 *      aria-label, name, id.
 *
 * Anything that does not clear CONFIDENCE_THRESHOLD is reported as skipped
 * rather than guessed at. Filling the wrong value into a job application is
 * worse than leaving it blank: the user may not notice before submitting.
 */

export type FieldMatch = {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  key: string;
  confidence: number;
  label: string;
  /** Set when the match came from a hand-written override rather than a guess. */
  control?: "input" | "select" | "combo";
};

/** Mirror of lib/shared/field-map.ts in the main repo. */
export type FieldRule = { key: string; selector: string; control?: "input" | "select" | "combo" };
export type SiteRules = { host: string; rules: readonly FieldRule[] };
export type FieldMap = { version: number; sites: readonly SiteRules[] };

/**
 * Rules for the current host. Matched by hostname suffix so one "greenhouse.io"
 * block covers boards. and job-boards. alike.
 */
function rulesFor(map: FieldMap | null, hostname: string): readonly FieldRule[] {
  if (!map?.sites) return [];

  return map.sites
    .filter((site) => hostname === site.host || hostname.endsWith(`.${site.host}`))
    .flatMap((site) => site.rules);
}

const CONFIDENCE_THRESHOLD = 0.5;

/** Keywords per vault key, most specific first. */
const KEYWORDS: Record<string, string[]> = {
  fullName: ["full name", "legal name", "candidate name", "applicant name", "your name", "name"],
  firstName: ["first name", "firstname", "given name", "forename"],
  lastName: ["last name", "lastname", "surname", "family name"],
  preferredName: ["preferred name", "nickname", "goes by"],
  pronouns: ["pronoun"],
  email: ["email", "e-mail"],
  phone: ["phone", "mobile", "telephone", "contact number"],
  phoneCountryCode: ["country code", "dial code"],
  addressLine1: ["address line 1", "street address", "address 1", "address"],
  addressLine2: ["address line 2", "address 2", "apartment", "suite", "unit"],
  city: ["city", "town", "locality"],
  state: ["state", "province", "region", "county"],
  postalCode: ["postal code", "zip code", "zip", "postcode"],
  country: ["country"],
  currentLocation: ["current location", "where are you based", "based in", "your location", "location"],
  linkedinUrl: ["linkedin"],
  githubUrl: ["github"],
  portfolioUrl: ["portfolio", "website", "personal site"],
  workAuthorized: ["authorized to work", "authorised to work", "work authorization", "legally authorized"],
  requiresSponsorship: ["sponsorship", "require sponsorship", "visa sponsorship"],
  currentCompany: ["current company", "current employer", "company", "employer"],
  currentTitle: ["current title", "job title", "current role", "occupation"],
  yearsExperience: ["years of experience", "years experience", "experience in years"],
  // CTC ("cost to company") is how most Indian job forms ask both of these, and
  // they are routinely asked side by side. Putting the desired figure in the
  // box asking what you earn now is the kind of mistake nobody spots before
  // submitting, which is why the two lists exclude each other below.
  currentSalary: [
    "current ctc",
    "current cost to company",
    "current salary",
    "current compensation",
    "current package",
    "present salary",
    "existing salary",
    "ctc",
  ],
  desiredSalary: [
    "expected ctc",
    "expected cost to company",
    "desired ctc",
    "desired salary",
    "expected salary",
    "salary expectation",
    "expected compensation",
    "expected package",
    "compensation",
  ],
  salaryCurrency: ["currency"],
  noticePeriod: ["notice period", "notice"],
  earliestStartDate: ["start date", "available from", "availability date", "earliest start"],
  willingToRelocate: ["relocate", "relocation", "willing to move"],
  remotePreference: ["remote", "work preference", "onsite", "hybrid"],
  howDidYouHear: ["how did you hear", "how you heard", "referral source", "where did you hear"],
  summary: ["summary", "about you", "tell us about yourself"],
  defaultCoverLetter: ["cover letter", "why do you want", "motivation"],
  gender: ["gender"],
  raceEthnicity: ["race", "ethnicity", "hispanic"],
  veteranStatus: ["veteran", "military"],
  disabilityStatus: ["disability", "disabled"],
};

/**
 * Words that disqualify a key even though one of its keywords matched.
 *
 * THIS IS WHAT MAKES THE SHORT KEYWORDS SAFE. "name" and "ctc" are the words
 * forms actually use, but on their own they are also inside "Company name" and
 * "Expected CTC" - and scoring alone does not separate those reliably, because
 * a short keyword in a short label scores about as well either way.
 *
 * A miss here is not a blank field, it is the WRONG value in a real job
 * application: the applicant's name in the employer box, or the salary they
 * want in the box asking what they earn now. Neither is likely to be read back
 * before submitting, so the guard is deliberately eager - a key that bows out
 * leaves the field to a more specific key, or to the user.
 */
const EXCLUSIONS: Record<string, readonly string[]> = {
  fullName: [
    "first",
    "last",
    "given",
    "family",
    "surname",
    "middle",
    "maiden",
    "preferred",
    "nick",
    "pronoun",
    "company",
    "employer",
    "organisation",
    "organization",
    "school",
    "university",
    "college",
    "reference",
    "emergency",
    "supervisor",
    "manager",
    "recruiter",
    "file",
    "user",
    "domain",
    "product",
  ],
  // "Preferred location" and "Are you willing to relocate" are asking where you
  // would GO, not where you are.
  currentLocation: [
    "preferred",
    "desired",
    "relocat",
    "willing",
    "job location",
    "office",
    "work location",
    "position",
    "role location",
  ],
  currentSalary: ["expected", "desired", "target", "preferred", "minimum", "maximum", "range"],
  desiredSalary: ["current", "present", "existing"],
};

function isExcluded(key: string, signature: string): boolean {
  const terms = EXCLUSIONS[key];
  if (!terms) return false;
  return terms.some((term) => signature.includes(term));
}

/**
 * autocomplete token -> fillable key.
 *
 * Covers composed and derived keys as well as stored ones: `name` is the
 * standard token for a whole name, and `organization` for a current employer.
 * Both are far stronger evidence than anything the keyword pass can offer.
 */
const BY_AUTOCOMPLETE = new Map<string, string>(
  [...FILLABLE_FIELDS.values()]
    .filter((field) => field.autocomplete)
    .map((field) => [field.autocomplete as string, field.key]),
);

export type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Input types that never hold profile data. */
const SKIP_TYPES = new Set(["password", "hidden", "submit", "button", "reset", "image", "file"]);

function isFillable(element: Element): element is FieldElement {
  if (element instanceof HTMLInputElement) {
    if (SKIP_TYPES.has(element.type)) return false;
    return !element.disabled && !element.readOnly;
  }
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLSelectElement) return !element.disabled;
  return false;
}

/**
 * Every scrap of text that describes a field, lowercased.
 *
 * `name` and `id` go in last and matter least: they are often minified or
 * framework-generated (`field_4823901`), so a match there is weak evidence
 * compared to a visible label a human wrote.
 */
function signatureOf(element: FieldElement): string {
  const described: string[] = [];

  // `.labels` is the native association list - it covers both `for=` and
  // wrapping labels with no selector building, so there is no id to escape.
  // The earlier `label[for="${CSS.escape(id)}"]` lookup meant an id containing
  // a quote or bracket produced an invalid selector that threw, and CSS.escape
  // itself is missing in some environments.
  for (const label of element.labels ?? []) {
    if (label.textContent) described.push(label.textContent);
  }

  const wrapping = element.closest("label");
  if (wrapping?.textContent) described.push(wrapping.textContent);

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const node = element.ownerDocument.getElementById(id);
      if (node?.textContent) described.push(node.textContent);
    }
  }

  described.push(
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("placeholder") ?? "",
  );

  // Only when the author left us nothing to read. This is both the cheap path
  // and the safe one: a form that labelled its fields properly never pays for
  // the DOM walk, and never risks the guesswork it involves.
  if (described.join("").trim() === "") {
    described.push(nearbyText(element));
  }

  return [...described, element.getAttribute("name") ?? "", element.id]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** How far up to look for text describing a field. */
const NEARBY_MAX_DEPTH = 4;
/** Enough for a wordy question, not enough to swallow a whole form. */
const NEARBY_MAX_LENGTH = 240;

/**
 * Text sitting next to a field that was never associated with it.
 *
 * PLENTY OF REAL FORMS NEVER WRITE A `<label>`. A question rendered as a plain
 * `<div>` above its input looks identical to a user and is invisible to
 * `element.labels`, so without this the field has no signature at all beyond a
 * generated name like `answer_8321` - and matching it is not close, it is
 * impossible.
 *
 * THE ONE-FIELD RULE IS WHAT MAKES THIS SAFE. We climb only through containers
 * holding exactly one fillable field. A container with two would give both the
 * same text: "First name" and "Last name" sitting above a pair of inputs would
 * make each field look like both, and the matcher would confidently write the
 * wrong half of somebody's name. Stopping there costs a match; not stopping
 * would cost correctness.
 */
function nearbyText(element: FieldElement): string {
  let node = element.parentElement;

  for (let depth = 0; node && depth < NEARBY_MAX_DEPTH; depth += 1) {
    if (countFillable(node) > 1) break;

    const text = textWithin(node).replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, NEARBY_MAX_LENGTH);

    node = node.parentElement;
  }

  return "";
}

function countFillable(node: Element): number {
  let count = 0;
  for (const candidate of node.querySelectorAll("input, textarea, select")) {
    if (isFillable(candidate)) count += 1;
  }
  return count;
}

/**
 * Tags whose text describes themselves rather than the field beside them.
 *
 * `option` is the important one: a country `<select>` carries every country
 * name in the world as text, which would swamp any real signal around it.
 */
const OPAQUE_TO_TEXT = new Set(["SELECT", "OPTION", "TEXTAREA", "BUTTON", "SCRIPT", "STYLE"]);

function textWithin(node: Element): string {
  let text = "";

  for (const child of node.childNodes) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      text += ` ${child.nodeValue ?? ""}`;
      continue;
    }
    if (child instanceof Element && !OPAQUE_TO_TEXT.has(child.tagName)) {
      text += ` ${textWithin(child)}`;
    }
  }

  return text;
}

/** Human-readable name for the fill report. */
function labelOf(element: FieldElement): string {
  const signature = signatureOf(element);
  const first = signature.split(/[|·\n]/)[0]?.trim();
  return (first || element.getAttribute("name") || "this field").slice(0, 60);
}

function scoreKeywords(signature: string): { key: string; confidence: number } | null {
  let best: { key: string; confidence: number } | null = null;

  for (const [key, keywords] of Object.entries(KEYWORDS)) {
    if (isExcluded(key, signature)) continue;

    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i]!;
      if (!signature.includes(keyword)) continue;

      // Earlier keywords are more specific ("first name" beats "name"), and a
      // longer match against a short signature is stronger evidence than the
      // same match buried in a paragraph.
      const specificity = 1 - i * 0.1;
      const coverage = Math.min(1, keyword.length / Math.max(signature.length, 1));
      const confidence = Math.min(0.95, 0.55 + specificity * 0.25 + coverage * 0.2);

      if (!best || confidence > best.confidence) best = { key, confidence };
      break;
    }
  }

  return best;
}

/**
 * Find every fillable field in a root and the vault key it maps to.
 *
 * Takes a ParentNode so it can run against the document, a shadow root, or a
 * detached fragment in tests.
 */
export function detectFields(
  root: ParentNode = document,
  map: FieldMap | null = null,
  hostname: string = typeof location === "undefined" ? "" : location.hostname,
): FieldMatch[] {
  const matches: FieldMatch[] = [];
  const claimed = new Set<string>();
  const seen = new Set<Element>();

  // Override rules run FIRST and win outright. They exist precisely because the
  // automatic path got this form wrong, so letting autocomplete outrank them
  // would make them useless on the sites that need them most.
  for (const rule of rulesFor(map, hostname)) {
    if (!FILLABLE_FIELDS.has(rule.key) || claimed.has(rule.key)) continue;

    let element: Element | null = null;
    try {
      element = root.querySelector(rule.selector);
    } catch {
      // A malformed selector in the served map must not take down detection for
      // the whole page - skip the rule and carry on with the heuristics.
      continue;
    }

    if (!element || !isFillable(element)) continue;

    claimed.add(rule.key);
    seen.add(element);
    matches.push({
      element,
      key: rule.key,
      confidence: 1,
      label: labelOf(element),
      control: rule.control,
    });
  }

  for (const element of root.querySelectorAll("input, textarea, select")) {
    if (seen.has(element)) continue;
    if (!isFillable(element)) continue;

    const autocomplete = element.getAttribute("autocomplete")?.trim().toLowerCase();
    // Tokens can be space-separated and section-prefixed ("shipping given-name").
    const token = autocomplete?.split(/\s+/).pop();
    const fromAutocomplete = token ? BY_AUTOCOMPLETE.get(token) : undefined;

    const match = fromAutocomplete
      ? { key: fromAutocomplete, confidence: 1 }
      : scoreKeywords(signatureOf(element));

    if (!match || match.confidence < CONFIDENCE_THRESHOLD) continue;
    if (!FILLABLE_FIELDS.has(match.key)) continue;

    // A form asking twice for the same thing (a confirm-email pair, say) would
    // otherwise get two fills from one key. First match wins - it is the one
    // higher up the form.
    if (claimed.has(match.key)) continue;
    claimed.add(match.key);

    matches.push({ element, key: match.key, confidence: match.confidence, label: labelOf(element) });
  }

  return matches;
}
