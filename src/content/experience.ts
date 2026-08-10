/**
 * Reading a length of service off one line of free text.
 *
 * The profile collects experience as a single box, because that is how a person
 * thinks about it and how most forms ask for it. A good number of forms - Keka
 * and most of the Indian ATSs among them - instead ask for it as two controls
 * side by side: a "Years" input and a "Months" dropdown. Neither can be filled
 * from "5.5" without someone doing this arithmetic, and leaving both blank
 * because the shapes differ is the wrong answer when we plainly know how long
 * the user has worked.
 *
 * The three ways people actually write it are all handled: a whole number, a
 * decimal, and a spelled-out pair.
 */

export type Experience = { years: number; months: number };

/** "6 months", "6 mos", "6m" - but never the "m" in "5 May". */
const MONTHS = /(\d+)\s*(?:months?|mos?|m)\b/;

const NUMBER = /\d+(?:\.\d+)?/;

/**
 * Past this the input is not a length of service.
 *
 * Somebody typing a salary or a year of birth into the experience box would
 * otherwise produce "1998 years", and a form that accepts it looks far worse
 * than one left blank.
 */
const MAX_YEARS = 70;

const MONTHS_IN_YEAR = 12;

/** A months figure typed into a box of its own. Null when there isn't one. */
function statedMonths(raw: string): number | null {
  const found = /\d+/.exec(raw.trim());
  if (!found) return null;

  const months = Number(found[0]);
  return Number.isFinite(months) ? months : null;
}

/**
 * The profile's two experience boxes, read as one answer.
 *
 * An explicit months figure BEATS anything inferred from the years box. The
 * user answering "how many additional months" directly is better evidence than
 * arithmetic on a decimal they may not have meant as one - and somebody with
 * five years and eight months has no natural way to write that as a decimal
 * anyway, which is why the second box exists.
 */
export function combineExperience(years: string, months: string): Experience | null {
  const parsed = parseExperience(years);
  const stated = statedMonths(months);

  if (!parsed && stated === null) return null;

  let whole = parsed?.years ?? 0;
  let rest = stated ?? parsed?.months ?? 0;

  whole += Math.floor(rest / MONTHS_IN_YEAR);
  rest %= MONTHS_IN_YEAR;

  if (whole > MAX_YEARS) return null;

  return { years: whole, months: rest };
}

/**
 * Back to one number, for the forms that ask in one box.
 *
 * Five years and six months is "5.5" - the shape those boxes expect, and the
 * shape parseExperience reads back. Trailing zeros are stripped so a whole
 * number stays a whole number rather than arriving as "5.00".
 */
export function formatExperience({ years, months }: Experience): string {
  if (months === 0) return String(years);
  return (years + months / MONTHS_IN_YEAR).toFixed(2).replace(/\.?0+$/, "");
}

export function parseExperience(raw: string): Experience | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  const monthly = MONTHS.exec(text);

  /**
   * Only digits BEFORE the months part can be years.
   *
   * Without the slice, "6 months" reads its own 6 as the year count and comes
   * out as six years and six months. Slicing is also what makes a months-only
   * answer work at all: there is nothing to the left, so years starts at zero.
   */
  const yearly = NUMBER.exec(monthly ? text.slice(0, monthly.index) : text);
  if (!monthly && !yearly) return null;

  const stated = yearly ? Number(yearly[0]) : 0;
  if (!Number.isFinite(stated)) return null;

  let years = Math.floor(stated);
  // A fraction is the other way people write half a year. "5.5" is five years
  // and six months, and flooring it away would quietly lose the half.
  let months = monthly ? Number(monthly[1]) : Math.round((stated - years) * MONTHS_IN_YEAR);

  // Carries both "18 months" and the rounding of "5.99" into a shape a Months
  // dropdown can actually accept, since those only ever run 0-11.
  years += Math.floor(months / MONTHS_IN_YEAR);
  months %= MONTHS_IN_YEAR;

  if (years > MAX_YEARS) return null;

  return { years, months };
}
