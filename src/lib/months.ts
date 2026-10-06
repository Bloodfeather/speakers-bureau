// src/lib/months.ts - the twelve month names, and the one zero-padding rule.
//
// ---------------------------------------------------------------------------
// WHY THE MONTH TABLE LIVES HERE RATHER THAN IN articles.ts
// ---------------------------------------------------------------------------
//
// articles.ts reads data/articles.json at module scope, so importing it from
// anything that only wants a month name would drag the whole article dataset in
// with it - and a validator that fails because an unrelated JSON file is missing
// is a validator whose failure reason lies.
//
// So the table lives here, with no data import and no Astro global, and it can be
// imported by the events code, by scripts/check-events.mjs and by node --test
// without pulling anything else along.
//
// ONE TABLE FOR THE WHOLE SITE. articles.ts imports MONTHS from here rather than
// declaring its own, so there is no second copy to drift. The duplication used to
// be guarded by a test that compared the two tables; the guard went with the
// duplication, because a test comparing a thing to itself cannot fail for a
// reason anyone can act on.
//
// WHY A TABLE AND NOT Intl.DateTimeFormat: see the long note above the table in
// articles.ts. Month names come from ICU data on the build machine, so the same
// commit can render "October" here and something else on the GH Pages runner. A
// twelve-element literal has no ICU dependency and is trivially assertable.
//
// ---------------------------------------------------------------------------
// `.ts` ON THE SPECIFIER IS LOAD-BEARING
// ---------------------------------------------------------------------------
//
// Bare Node's ESM resolver cannot resolve "./months" to "months.ts", and both
// `node --test` and scripts/check-events.mjs must load this module. tsconfig
// extends astro/tsconfigs/strict, which sets allowImportingTsExtensions, so the
// explicit extension is legal TypeScript too. Same convention, same reason, as
// in events-schema.ts and calendar.ts.

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const

// ---------------------------------------------------------------------------
// Zero-padding, ONE implementation
// ---------------------------------------------------------------------------
//
// THE 0-BASED / 1-BASED SPLIT THIS REPLACES WAS A LIVE TRAP. There were four
// copies of "pad to two digits" and two of them disagreed about what they took:
// monthKeyPart() took a ZERO-based month index and added 1, while calendar.ts's
// twoDigits() and three inline `String(x).padStart(2, '0')` calls took the value
// as given. Both were correct at their call sites and the difference was carried
// entirely by the name, so an off-by-one month renders as a plausible date rather
// than as an error.
//
// So: ONE function, it takes the value EXACTLY as given, and it does no index
// arithmetic. There is no zero-based variant to reach for the wrong one of.

/**
 * Zero-pad a value to the two digits a `YYYY-MM-DD` key needs.
 *
 * The value is used AS GIVEN - this function never adds or subtracts. Accepts a
 * number or a numeric string, because two callers have a string in hand by the
 * time they can validate it, and coercing twice would be a second place for the
 * answer to go wrong.
 */
export function twoDigits(value: number | string): string {
  return String(value).padStart(2, '0')
}

/**
 * The `MM` of a `YYYY-MM` key, from a ONE-BASED month number: 1 is January.
 *
 * Named for what it takes, because the previous version of this file took a
 * zero-based index under a name that did not say so.
 */
export function monthKeyPart(month1Based: number): string {
  return twoDigits(month1Based)
}
