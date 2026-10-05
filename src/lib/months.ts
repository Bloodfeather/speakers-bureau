// src/lib/months.ts - the twelve month names, in one place.
//
// WHY THIS FILE EXISTS SEPARATELY. src/lib/articles.ts has carried its own
// MONTHS table since the reading room was built, and it is correct there. But
// src/lib/articles.ts reads data/articles.json at module scope, so importing it
// from anything that only wants a month name would drag the whole article
// dataset in with it - and a validator that fails because an unrelated JSON file
// is missing is a validator whose failure reason lies.
//
// So the table lives here, with no data import and no Astro global, and it can
// be imported by the events code, by scripts/check-events.mjs and by node --test
// without pulling anything else along.
//
// ONE KNOWN DUPLICATION, STATED RATHER THAN HIDDEN: articles.ts still declares
// its own identical MONTHS table. Collapsing it is a one-line change to a file
// owned by the reading-room work, so it is recorded as a follow-up in
// build-log.md instead of being edited underneath its owner. The two tables are
// asserted equal by test/events.test.mjs, so a drift fails the suite instead of
// quietly rendering one page's dates differently from another's.
//
// WHY A TABLE AND NOT Intl.DateTimeFormat: see the long note above the table in
// articles.ts. Month names come from ICU data on the build machine, so the same
// commit can render "October" here and something else on the GH Pages runner. A
// twelve-element literal has no ICU dependency and is trivially assertable.

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

/** Zero-pad a 1-based month number to the two digits a `YYYY-MM` key needs. */
export function monthKeyPart(monthIndex0: number): string {
  return String(monthIndex0 + 1).padStart(2, '0')
}
