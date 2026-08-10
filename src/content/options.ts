/**
 * Picking one option out of a list.
 *
 * Shared by the native `<select>` path in fill.ts and the custom-dropdown
 * driver in combo.ts, because the hard part is identical in both: the value the
 * user saved is almost never written the way the form writes it. "+91" has to
 * find "India (+91)", "6" has to find "06", and neither may be allowed to
 * settle for an option that merely CONTAINS the right characters.
 *
 * That last point is the whole reason this file exists rather than a one-line
 * `includes`. Country lists are alphabetical and dial codes nest inside one
 * another: "+1" is a substring of "India (+91)", "Anguilla (+1264)" and
 * "United States (+1)", in that order. A first-match `includes` therefore hands
 * an American applicant an Indian dial code, silently, on a real application.
 */

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A bare number, with or without a leading plus: "6", "011", "+91". */
const BARE_NUMBER = /^\+?(\d{1,4})$/;

/** Every option we could return is a better answer than one scoring this. */
export const NO_MATCH = 0;

/**
 * How well an option answers the value we want. `NO_MATCH` means "not an
 * answer at all" - the caller must leave the control alone rather than take it.
 *
 * The ladder, strongest first:
 *   5  the same string, or the same number written differently ("6" / "06")
 *   4  a number matched AS A NUMBER inside a longer label ("+91" in "India (+91)")
 *   3  the option begins with what we wanted
 *   2  what we wanted appears as a whole word
 *   1  what we wanted appears anywhere
 */
export function scoreOption(wanted: string, option: string): number {
  const want = normalize(wanted);
  const text = normalize(option);
  if (!want || !text) return NO_MATCH;

  if (text === want) return 5;

  // Selects that zero-pad their values are common enough that a string
  // comparison alone would miss half of them - a "Months" dropdown running
  // "00".."11" answers "6" perfectly well.
  if (/^\d+$/.test(want) && /^\d+$/.test(text) && Number(want) === Number(text)) return 5;

  const bare = BARE_NUMBER.exec(want);
  if (bare) {
    /**
     * A NUMBER MATCHES AS A NUMBER OR NOT AT ALL.
     *
     * The digit boundaries are doing real work: they stop "+1" from matching
     * "(+91)" or "(+1264)" while still letting it match "(+1)". Falling back to
     * a substring test here would defeat the point of the whole file, so a bare
     * number that fails this test scores nothing rather than dropping down the
     * ladder.
     */
    const digits = bare[1]!;
    return new RegExp(`(?<!\\d)\\+?${digits}(?!\\d)`).test(text) ? 4 : NO_MATCH;
  }

  if (text.startsWith(want)) return 3;
  if (new RegExp(`\\b${escapeRegExp(want)}\\b`).test(text)) return 2;
  return text.includes(want) ? 1 : NO_MATCH;
}

/**
 * The best option for a value, or null when nothing is close enough.
 *
 * Best-of rather than first-match. A form's option list is in the form's order,
 * not ours, so "first thing that contains the answer" is a coin flip dressed up
 * as a decision - the exact match is as likely to be at the bottom of a country
 * list as the top. Ties keep the earlier option, which is the only tiebreak
 * that is stable across renders.
 *
 * `textsOf` returns every string that could name an option - an option element
 * has both a value and a label, and a custom one may carry an aria-label the
 * visible text abbreviates.
 */
export function pickOption<T>(
  wanted: string,
  options: readonly T[],
  textsOf: (option: T) => readonly string[],
): T | null {
  let best: { option: T; score: number } | null = null;

  for (const option of options) {
    let score = NO_MATCH;
    for (const text of textsOf(option)) {
      const candidate = scoreOption(wanted, text);
      if (candidate > score) score = candidate;
    }

    if (score > NO_MATCH && (!best || score > best.score)) best = { option, score };
  }

  return best?.option ?? null;
}
