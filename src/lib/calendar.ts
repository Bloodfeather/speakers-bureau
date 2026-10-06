// src/lib/calendar.ts - the date arithmetic behind the events month grid.
//
// ---------------------------------------------------------------------------
// WHY THE SELECTION UNIT IS A DAY, NOT AN EVENT
// ---------------------------------------------------------------------------
//
// The first version of this page let a reader click an event row. That is wrong
// for this dataset, and the shape of the data says so rather than a preference:
// two events can share a calendar date. The election-day row is an all-day event
// on 2026-11-03, and a debate can sit on 2026-11-03 at 6:30pm. A control whose
// unit is the event cannot represent "the reader picked that date", so the panel
// either shows one of the two events and hides the other, or it needs a second
// control to disambiguate - which is the same page with a worse interface.
//
// So the unit here is the DAY. `EventDay` is the thing a calendar cell holds and
// the thing a radio selects; `count` and `multiple` let a cell say "3 events here"
// without the cell having to decide which one is selected. That single change is
// why this module exists, and why `eventDays` groups at all.
//
// ---------------------------------------------------------------------------
// THE TIMEZONE TRAP, WHICH IS THE WHOLE REASON FOR THE ARITHMETIC BELOW
// ---------------------------------------------------------------------------
//
// `startsAt` is a LOCAL WALL CLOCK string, never a UTC instant. That is enforced
// upstream in src/lib/events-schema.ts and is not negotiable. The consequence for
// THIS file is that the obvious way to get a weekday is wrong:
//
//     new Date('2026-11-01').getDay()   // 6 in America/Los_Angeles, 0 in UTC
//
// A date-only string with no time and no zone is parsed by the ECMAScript spec as
// UTC MIDNIGHT. Reading it back with a LOCAL accessor then applies the machine's
// offset, which is NEGATIVE west of Greenwich, so the local clock is still on the
// previous evening and `getDay()` reports the day BEFORE. On this machine
// (America/New_York, UTC-4/-5) `new Date('2026-11-01').getDay()` returns 6 when
// the answer is 0.
//
// That is not a subtle rounding error. It moves every cell of the grid by one
// column, so the 1st of the month renders under the wrong weekday, on a build
// machine whose zone nobody chose. And it is INVISIBLE on a machine set to UTC,
// which is why it ships.
//
// So: no `new Date(string)` and no local accessor appears in this file, for any
// purpose. Weekdays come from `Date.UTC(...)` used purely as calendar arithmetic,
// read back with `getUTCDay()`. Nothing here is ever formatted from the resulting
// Date, so no machine zone is involved at any point - the same discipline
// parseWallClock() uses in events-schema.ts, and for the same reason.
//
// test/calendar.test.mjs does not take that on trust. It runs this module in child
// processes under TZ=UTC, TZ=America/Los_Angeles and TZ=Asia/Kathmandu and
// compares the output byte for byte. An invariance claim about a code path is a
// claim about code, and code claims are what look true and are false on the GH
// Pages runner.
//
// ---------------------------------------------------------------------------
// NOTHING IN HERE THROWS
// ---------------------------------------------------------------------------
//
// Every exported function in this module returns an empty list, a null grid, an
// empty string or a value, for every input including the ones a caller should
// never pass. That is a deliberate, uniform rule and not a series of independent
// decisions:
//
//   - `eventDays` never throws: a missing list is an empty list.
//   - `monthGridFor` returns null for a key that is not a real month, because a
//     caller that passed a bad key has a bug and a blank calendar would hide it.
//   - `monthGrids` skips such a month rather than throwing (it used to).
//   - `dayRadioLabel` returns '' for anything that is not a day.
//
// The reason is the caller. events.astro calls `monthGrids` at MODULE SCOPE, so
// anything this module throws stops `npm run build` with a stack trace in a
// helper, on a page that would otherwise have rendered. data/events.json is
// validated properly and loudly by src/lib/events.ts and by `npm run
// events:check`; this module's job is to lay out grids, not to be the place a
// bad date is discovered.
//
// ---------------------------------------------------------------------------
// `.ts` ON THE SPECIFIER IS LOAD-BEARING
// ---------------------------------------------------------------------------
//
// `npm test` runs `node --test` over test/*.test.mjs, and test/calendar.test.mjs
// imports this module. Bare Node's ESM resolver cannot resolve an extensionless
// relative import - it has no idea "./events-schema" means "events-schema.ts" - so
// the specifier carries the extension. tsconfig extends astro/tsconfigs/strict,
// which sets allowImportingTsExtensions, so this is legal TypeScript too. It is
// the same convention and the same reason as in events-schema.ts and months.ts:
// if it is ever "tidied" away, `node --test` breaks while `npm run build` keeps
// working, which is the worst possible split.

import {
  formatEventDate,
  machineDateTime,
  monthLabel,
  parseWallClock,
  sortEvents,
  type EventRecord
} from './events-schema.ts'
import { monthKeyPart, twoDigits } from './months.ts'

// ---------------------------------------------------------------------------
// Weekday vocabulary, SUNDAY FIRST
// ---------------------------------------------------------------------------
//
// Sunday first is not a preference, it is the calendar grid convention this page
// follows and it is baked into every index below: `cells[0]` is always the Sunday
// of the first week, and `leading` below is a `getUTCDay()` value used directly as
// a cell index. A Monday-first grid would need an off-by-one on every one of those
// and would render 1 November under "Mo" while its own data said Sunday.
//
// Both arrays are exported rather than written into the markup, because the .astro
// components render the header row and the grid body and they must agree on which
// column is which. Two hand-maintained weekday lists WILL drift, and a drift here
// is a calendar that labels every column wrongly.

/** Column headers, Sunday first. */
export const WEEKDAY_LABELS: readonly string[] = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/** The same seven days in full, Sunday first. Used for the accessible label. */
export const WEEKDAY_FULL: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

/** A minimum of five rows, so every month grid is 35 or 42 cells and no more. */
const MINIMUM_ROWS = 5

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One calendar date, and every event that falls on it.
 *
 * This is the selection unit. `count` and `multiple` are stored rather than
 * computed by the caller because both the cell renderer and the radio's
 * accessible label need them, and two components deriving "more than one" from
 * `events.length` is two places for the rule to live.
 */
export interface EventDay {
  /** `YYYY-MM-DD`, the identity of the day. */
  key: string
  /** `14 November 2026`. */
  label: string
  /** `2026-11-14`, for a `<time datetime>` attribute. */
  machine: string
  /** The events on this date, ascending. Never empty: a day with none is not a day. */
  events: EventRecord[]
  /** `events.length`. */
  count: number
  /** True when `count` is greater than one, which is the case the grid is for. */
  multiple: boolean
}

/**
 * One square of the month grid.
 *
 * A real day of the month always has `dayNumber`; it has `day: null` when no
 * event falls on it, because an empty cell is still a place the reader can look
 * and a calendar that omitted empty days would be a list wearing a grid's
 * clothes. A padding cell belongs to an adjacent month and has both fields null.
 */
export interface DayCell {
  /** 1-31, or null for a padding cell. */
  dayNumber: number | null
  /** The `EventDay` when this date carries at least one event, else null. */
  day: EventDay | null
}

/** One month, laid out Sunday first, seven cells per row. */
export interface MonthGrid {
  /** `2026-11`, sortable, stable, and usable as an anchor fragment. */
  key: string
  /** `November 2026`. */
  label: string
  /**
   * A multiple of seven cells, and always 35 or 42.
   *
   * ALWAYS 35 OR 42, which is a deliberate floor rather than a tautology. A
   * February that begins on a Sunday has exactly four natural weeks - 28 cells,
   * 28 for that month alone in a century. A calendar whose height then changes by
   * a whole row in one month out of twelve is jittery, and a component written
   * against `cells.length === 42 ? sixRows : fiveRows` would be wrong twice a
   * year. So a short month is padded out to five rows: `MINIMUM_ROWS` below.
   */
  cells: DayCell[]
  /** Total events across the month, counting every cell that carries one. */
  eventCount: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// `twoDigits` is NOT defined here. It lives in src/lib/months.ts, because three
// modules needed the same two lines and two of them disagreed about whether the
// value they were handed was 0-based or 1-based - which is the kind of difference
// that renders a plausible wrong date rather than an error. See the zero-padding
// note in months.ts.

/**
 * `2026-11-14` from a year, a ONE-BASED month and a day.
 *
 * Both helpers are named for what they take, so the 0-based / 1-based split that
 * used to live in the difference between `monthKeyPart` and a local `twoDigits`
 * is now carried by the call rather than by remembering which function is which.
 */
function makeDayKey(year: number, month: number, day: number): string {
  return `${year}-${monthKeyPart(month)}-${twoDigits(day)}`
}

/**
 * Coerce anything to an array, so a missing argument is an empty list.
 *
 * Every exported function in this file takes a `readonly T[]`, which the type
 * system should make `null` impossible. It is not impossible in practice: the
 * callers are .astro components reading a JSON-shaped prop, and `data.events`
 * being absent is exactly the kind of thing that reaches a render as undefined.
 * A page that throws at build time because a list was missing is worse than a
 * page that renders no events.
 */
function asList<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : []
}

// ---------------------------------------------------------------------------
// dayKey
// ---------------------------------------------------------------------------

/**
 * The `YYYY-MM-DD` key for an event's start, or '' if there is not one.
 *
 * A validated wall clock's first ten characters ARE the date, so the cheap
 * implementation is `startsAt.slice(0, 10)`. This validates first anyway, and the
 * reason is specific rather than defensive habit: the return value is a MAP KEY.
 * `eventDays` groups by it and `monthGridFor` looks days up by it, so a garbage
 * entry must not silently become a day key that no cell will ever match - it
 * would render nowhere and cost nothing to notice. Validating here means the
 * junk is dropped at the boundary, once, with one rule.
 *
 * parseWallClock does the round-trip check, so `2026-02-30` and `2026-13-01` are
 * rejected here exactly as they are by the validator.
 */
export function dayKey(startsAt: string): string {
  if (typeof startsAt !== 'string') return ''
  const trimmed = startsAt.trim()
  if (trimmed === '') return ''
  const parsed = parseWallClock(trimmed)
  if (parsed === null) return ''
  return makeDayKey(parsed.year, parsed.month, parsed.day)
}

// ---------------------------------------------------------------------------
// eventDays
// ---------------------------------------------------------------------------

/**
 * Group events into days, ascending by date, chronological within each day.
 *
 * Two events on 2026-11-03 produce ONE `EventDay` with `count: 2`. That is the
 * entire reason this function exists, and it is asserted directly in the test
 * rather than left implied.
 *
 * Order comes from `sortEvents`, so the same list always produces the same days
 * in the same order regardless of the order it arrived in - design rule 8 applied
 * to grouping. Sorting before grouping is also what makes "within a day,
 * chronological" free rather than a second sort.
 *
 * Never throws. A missing list is an empty list, and an entry that is not an
 * event with a real `startsAt` is dropped rather than passed to `sortEvents`,
 * which would throw on it: `wallClockToSortable` calls `.split` on the value.
 */
export function eventDays(events: readonly EventRecord[]): EventDay[] {
  const usable = asList(events).filter(
    (entry): entry is EventRecord =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as EventRecord).startsAt === 'string' &&
      dayKey((entry as EventRecord).startsAt) !== ''
  )
  if (usable.length === 0) return []

  const byKey = new Map<string, EventRecord[]>()
  for (const event of sortEvents(usable)) {
    const key = dayKey(event.startsAt)
    if (key === '') continue
    const bucket = byKey.get(key)
    if (bucket === undefined) byKey.set(key, [event])
    else bucket.push(event)
  }

  // sortEvents already emits ascending startsAt, so the insertion order of this
  // map is ascending by key already. Sorted again anyway, because "ascending" is
  // part of this function's contract and the reason it currently holds is an
  // implementation detail of sortEvents that a future edit could change.
  return [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, list]) => ({
      key,
      label: formatEventDate(key),
      machine: machineDateTime(key),
      events: list,
      count: list.length,
      multiple: list.length > 1
    }))
}

// ---------------------------------------------------------------------------
// monthGridFor
// ---------------------------------------------------------------------------

/**
 * The weekday index of the 1st of a month, Sunday first, as a cell offset.
 *
 * `Date.UTC` is CALENDAR ARITHMETIC and nothing else here. It is the only way to
 * ask "which weekday is this date" without a zone, and it is read back with
 * `getUTCDay`, which cannot apply an offset. See the trap at the top of this file.
 */
function leadingCellsFor(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
}

/** How many days the month has. Day zero of the next month is its last day. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Lay one month out as a seven-column grid, Sunday first.
 *
 * Leading padding puts the 1st in its own column; trailing padding completes the
 * last week. Both are `DayCell`s with both fields null, and `dayNumber: null` is
 * what tells a component it is looking at a blank rather than at the 1st of the
 * next month - a distinction that is the whole reason padding is modelled instead
 * of left as an absent element.
 *
 * Every real day of the month gets a cell, event or not, and `eventCount` counts
 * the events in this month only: a `days` list spanning three months is a normal
 * input and must not inflate the count of the month being rendered.
 *
 * Returns null for a month key that is not `YYYY-MM` naming a real month. Null
 * rather than an empty grid, because a caller that passed a bad key has a bug and
 * a blank calendar would hide it.
 */
export function monthGridFor(monthKey: string, days: readonly EventDay[]): MonthGrid | null {
  if (typeof monthKey !== 'string') return null
  const trimmed = monthKey.trim()
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return null

  // Reusing parseWallClock rather than splitting the key here means the month is
  // validated by the SAME round-trip the dataset validator uses, so a key that
  // names month 13 or a leap day cannot slip in through a second door.
  const anchor = parseWallClock(`${trimmed}-01`)
  if (anchor === null) return null
  const { year, month } = anchor

  const byKey = new Map<string, EventDay>()
  for (const day of asList(days)) {
    if (day !== null && typeof day === 'object' && typeof day.key === 'string') byKey.set(day.key, day)
  }

  const leading = leadingCellsFor(year, month)
  const realDays = daysInMonth(year, month)

  const cells: DayCell[] = []
  for (let i = 0; i < leading; i += 1) cells.push({ dayNumber: null, day: null })

  let eventCount = 0
  for (let dayNumber = 1; dayNumber <= realDays; dayNumber += 1) {
    const day = byKey.get(makeDayKey(year, month, dayNumber)) ?? null
    if (day !== null) eventCount += day.count
    cells.push({ dayNumber, day })
  }

  // Complete the final week, then apply the five-row floor. Both loops are the
  // same padding; the second exists because some months have four natural weeks.
  while (cells.length % 7 !== 0) cells.push({ dayNumber: null, day: null })
  while (cells.length < MINIMUM_ROWS * 7) cells.push({ dayNumber: null, day: null })

  return { key: trimmed, label: monthLabel(trimmed), cells, eventCount }
}

// ---------------------------------------------------------------------------
// monthGrids
// ---------------------------------------------------------------------------

/**
 * One grid per DISTINCT month present in `days`, ascending.
 *
 * The months come from the data and only from the data. A calendar that invented
 * a month because someone hardcoded a twelve-month list would render twelve
 * headings for a dataset with events in two, and every empty one would be a
 * month the reader is told exists and is told has nothing in it.
 *
 * Each grid is populated from ITS OWN days only, so a day's events can never
 * appear in the count of a month they are not in.
 *
 * NEVER THROWS, like every other export in this file. This one used to be the
 * exception: it threw when `monthGridFor` returned null for a key that had come
 * out of a day's own key. The reasoning was that such a key "cannot" happen - and
 * it can, because `day.key` is a plain string on a plain object. Anyone can call
 * `monthGrids([{ key: '2026-13-01', ... }])`, and it did: the regex below admits
 * `2026-13`, which `parseWallClock` then rejects. events.astro calls this at
 * MODULE SCOPE, so the throw took the whole build down rather than one cell.
 *
 * The philosophy is stated once, at `asList`: a missing list is an empty list, a
 * bad key is a null grid, and no input makes a page fail to render. So the
 * consistency check that was the throw is now a filter: a month key that does not
 * round-trip through `parseWallClock` yields NO grid, exactly as `monthGridFor`
 * already returned null for it. A day whose key is not a real date is dropped
 * rather than crashing the build - and `npm run events:check`, which validates
 * the whole file with the same parser, is where a bad date in the DATA is
 * reported properly. This function is not that tool and must not become it.
 */
export function monthGrids(days: readonly EventDay[]): MonthGrid[] {
  const keys = new Set<string>()
  for (const day of asList(days)) {
    if (day === null || typeof day !== 'object' || typeof day.key !== 'string') continue
    const key = day.key.slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(key)) keys.add(key)
  }

  const grids: MonthGrid[] = []
  for (const key of [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const mine = asList(days).filter(
      (day) => day !== null && typeof day === 'object' && typeof day.key === 'string' && day.key.slice(0, 7) === key
    )
    // Null means the key does not name a real month. Skipped, not thrown on: see
    // the note above. Filtered rather than cast so the type stays honest.
    const grid = monthGridFor(key, mine)
    if (grid !== null) grids.push(grid)
  }
  return grids
}

// ---------------------------------------------------------------------------
// dayRadioLabel
// ---------------------------------------------------------------------------

/**
 * The accessible name for the radio that selects a day: `3 November 2026, 2 events`.
 *
 * This is the text a screen reader announces when the reader tabs to a cell, and
 * it is the only place the reader learns that a date carries more than one thing.
 * A cell showing three dots announces as "3 November 2026" otherwise, which is a
 * label that reads as one event.
 *
 * Singular and plural are both handled because "1 events" is the kind of thing
 * that ships. The separator is an ASCII comma and the count is a number, so the
 * label carries no punctuation a locale would want to change - the same reason
 * every date on this site is rendered from a table rather than through ICU.
 */
export function dayRadioLabel(day: EventDay): string {
  if (day === null || typeof day !== 'object') return ''
  const count = typeof day.count === 'number' ? day.count : 0
  return `${day.label}, ${count} ${count === 1 ? 'event' : 'events'}`
}
