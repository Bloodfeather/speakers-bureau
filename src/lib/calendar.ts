// src/lib/calendar.ts - the date arithmetic behind the events month grid.
//
// ---------------------------------------------------------------------------
// WHY THE SELECTION UNIT IS A DAY, NOT AN EVENT
// ---------------------------------------------------------------------------
//
// Letting a reader click an event row is wrong for this dataset, and the shape of
// the data says so rather than a preference:
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
//   - `monthGrids` skips such a month rather than throwing.
//   - `dayRadioLabel`, `isSelectableDay` and `continuationLabel` return a false or
//     an empty string for anything that is not a day.
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
  formatEventDateSpan,
  isDateSpan,
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
 *
 * THE THREE STATES, because `events` is NOT guaranteed non-empty and that is the
 * whole point of having them.
 *
 *   1. A day with events on it: `events` holds them, `count` is their number,
 *      `continues` is false. It gets a radio, a panel and a clickable cell.
 *   2. A day with NO event of its own that a multi-day event runs THROUGH:
 *      `events` is EMPTY, `continues` is true, and `covering` names the events
 *      whose span reaches it. It gets a cell with a marker and NO radio, NO
 *      panel and NO `html:has(#day-...)` rule, because it is not independently
 *      selectable - the event is listed once, on the day it starts.
 *   3. A day with nothing on it at all: not a day here. `monthGridFor` renders a
 *      cell with `day: null`, and there is no `EventDay` to describe it.
 *
 * State 2 is the defect this shape exists for. If `eventDays`
 * keyed only on `dayKey(startsAt)`, early voting - `2026-10-19` to
 * `2026-10-31` - would be marked on 19 October and the other twelve days would
 * render as ordinary empty squares. The panel and the list both say "19 - 31 October
 * 2026", so the DEFAULT view of the page (the calendar; the list is behind a
 * toggle) asserted that voter access existed on one day out of thirteen. A
 * confidently wrong answer, and the pessimistic one, on a page publishing real
 * voter-access information.
 */
export interface EventDay {
  /** `YYYY-MM-DD`, the identity of the day. */
  key: string
  /** `14 November 2026`. */
  label: string
  /** `2026-11-14`, for a `<time datetime>` attribute. */
  machine: string
  /**
   * The events that START on this date, ascending.
   *
   * EMPTY on a day that is only covered by a span. That is not a regression in
   * this field's promise, it is the correction: "never empty: a day with none is
   * not a day" was true only while `endsAt` was never consulted, and following
   * it is what produced a calendar that under-reported a fortnight of voting by
   * twelve days. `count` is `events.length`, so a covered day counts zero events
   * of its own, which is accurate.
   */
  events: EventRecord[]
  /** `events.length`. Zero on a day that is only covered by a span. */
  count: number
  /** True when `count` is greater than one, which is the case the grid is for. */
  multiple: boolean
  /**
   * True when an event's date span COVERS this day without starting on it.
   *
   * `continues === covering.length > 0`, kept as a named boolean because the
   * cell renderer branches on the idea ("this date is covered by something that
   * started earlier") rather than on a list length.
   */
  continues: boolean
  /**
   * The events whose span covers this day but does not start on it, ascending by
   * their own start date.
   *
   * A day can carry events of its own AND be covered - a debate on the 22nd
   * inside a fortnight of early voting - and then this holds the covering events
   * while `events` holds its own. The two lists do not overlap, and the renderer
   * needs both.
   */
  covering: EventRecord[]
}

/**
 * One square of the month grid.
 *
 * A real day of the month always has `dayNumber`; it has `day: null` when nothing
 * falls on it, because an empty cell is still a place the reader can look and a
 * calendar that omitted empty days would be a list wearing a grid's clothes. A
 * padding cell belongs to an adjacent month and has both fields null.
 *
 * A `day` here is NOT necessarily a selectable day. It may be a day a multi-day
 * event merely runs through, which has `count: 0` and `continues: true`; the cell
 * renderer decides between a `<label>` and an inert `<span>` with
 * `isSelectableDay`, and the distinction is the whole design of the covered-day
 * marker. See `EventDay` above.
 */
export interface DayCell {
  /** 1-31, or null for a padding cell. */
  dayNumber: number | null
  /** The `EventDay` when something falls on this date, else null. */
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
 * Both helpers are named for what they take, so the 0-based / 1-based split is
 * carried by the call rather than by remembering which function is which.
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

/**
 * The `YYYY-MM-DD` key `offset` days after `key`, or '' if the key is not a date.
 *
 * This is the one piece of date arithmetic in this file that has to ADD, and it is
 * written to the same rule as the rest of it: `Date.UTC` as calendar arithmetic,
 * read back with `getUTC*`, and never formatted from. Nothing here can apply a
 * machine offset, so a span walks the same days in Kathmandu as in Los Angeles -
 * and `test/calendar.test.mjs` runs this module under three zones and compares
 * byte for byte, so that is measured rather than promised.
 *
 * `Date.UTC` maps a year 0-99 into the 20th century, which would silently rewrite
 * `0099-12-30` into 1999. `parseWallClock` already rejects years below 100, so a
 * key that reaches here is four digits and the mapping cannot fire.
 */
function shiftDayKey(key: string, offset: number): string {
  const parts = parseWallClock(key)
  if (parts === null) return ''
  const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset))
  return makeDayKey(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate())
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
 * original reason this function exists, and it is asserted directly in the test
 * rather than left implied.
 *
 * TWO KINDS OF DAY COME OUT, and the second kind is the fix. A day an event
 * STARTS on holds that event in `events`; a day a multi-day event merely RUNS
 * THROUGH holds nothing in `events` and names the covering event in `covering`.
 * Before, only the first kind existed: `endsAt` was never consulted on this path,
 * so the fortnight of early voting that the panel and the list both print as
 * "19 - 31 October 2026" was marked on the calendar on 19 October alone and the
 * other twelve dates rendered as ordinary empty squares. On a page of real
 * voter-access information that is the wrong answer in the pessimistic direction,
 * on the page's DEFAULT view.
 *
 * Order comes from `sortEvents`, so the same list always produces the same days
 * in the same order regardless of the order it arrived in - design rule 8 applied
 * to grouping. Sorting before grouping is also what makes "within a day,
 * chronological" free rather than a second sort, and what makes each `covering`
 * list ascending.
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

  const ordered = sortEvents(usable)

  const byKey = new Map<string, EventRecord[]>()
  for (const event of ordered) {
    const key = dayKey(event.startsAt)
    if (key === '') continue
    const bucket = byKey.get(key)
    if (bucket === undefined) byKey.set(key, [event])
    else bucket.push(event)
  }

  // -------------------------------------------------------------------------
  // THE SPAN WALK, which is the whole fix.
  // -------------------------------------------------------------------------
  //
  // For every event whose date span covers more than one date, every date AFTER
  // its start and up to and including its end is a day the event runs on. Those
  // days are added to `days` as covered days - NOT as new days with events of
  // their own, and NOT as new selectable days.
  //
  // `isDateSpan` is the single rule for what a span is, shared with the formatter
  // that prints "19 - 31 October 2026" in the panel and the list. If those two
  // disagreed, the page would say "19 - 31 October 2026" in prose and mark one
  // square in the grid, which is the contradiction being fixed. So they cannot
  // disagree: they ask the same function.
  //
  // `gop-quarterly-meeting` is the case that makes `isDateSpan` necessary rather
  // than merely tidy. It runs 18:30 to 20:30 on 5 October, and an implementation
  // that treated any `endsAt` as a DATE would mark 5 and 6 October for a
  // two-hour meeting. The end date here is the end date only when both ends are
  // date-only values, so a timed pair contributes nothing to this walk.
  //
  // NO CAP ON THE LENGTH OF A SPAN, deliberately. A cap would silently mark the
  // first N covered days and drop the rest, which is the pessimistic half of the
  // original defect wearing a limit. A `endsAt` of 2099 renders an absurd number
  // of marked squares, which is visible in the built page and gets fixed at the
  // source; `npm run events:check` is where a hand-edited range is diagnosed.
  const covering = new Map<string, EventRecord[]>()
  for (const event of ordered) {
    const endsAt = event.endsAt
    if (typeof endsAt !== 'string' || !isDateSpan(event.startsAt, endsAt)) continue
    const startKey = dayKey(event.startsAt)
    const endKey = dayKey(endsAt)
    if (startKey === '' || endKey === '') continue
    // From offset 1, so the start date is NOT a covered day: it is the day the
    // event is LISTED on, and it is already in `byKey` with the event on it.
    for (let offset = 1; ; offset += 1) {
      const key = shiftDayKey(startKey, offset)
      if (key === '' || key > endKey) break
      const bucket = covering.get(key)
      if (bucket === undefined) covering.set(key, [event])
      else bucket.push(event)
    }
  }

  // The union of both maps' keys, so a day that is only covered still exists and
  // `monthGridFor` will place it. Iterating a Set built from both means a span
  // crossing a month boundary produces a grid for the month it crosses INTO,
  // which is the case the shipped data does not exercise and a future one will.
  const keys = new Set<string>([...byKey.keys(), ...covering.keys()])

  // sortEvents already emits ascending startsAt, so the insertion order of the
  // map above is ascending by key already. Sorted again anyway, because "ascending"
  // is part of this function's contract and the reason it currently holds is an
  // implementation detail of sortEvents that a future edit could change.
  return [...keys]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => {
      const list = byKey.get(key) ?? []
      const spans = covering.get(key) ?? []
      return {
        key,
        label: formatEventDate(key),
        machine: machineDateTime(key),
        events: list,
        count: list.length,
        multiple: list.length > 1,
        continues: spans.length > 0,
        covering: spans
      }
    })
}

/**
 * Is this day SELECTABLE - does the reader choose it, and does a panel exist for it?
 *
 * One place, because the answer is used in three: the radio group, the panels, and
 * the generated per-day selectors in src/pages/events.astro. Deriving it in each
 * of those independently is three chances to add a radio for a covered day, and a
 * radio for a covered day is a date that can be selected and shows an empty
 * panel - strictly worse than the defect above, because it looks like working
 * selection machinery pointing at nothing.
 *
 * The test is `count > 0`, not `!continues`: a day can carry its own events AND
 * be inside someone else's span (a debate on the 22nd of a fortnight of early
 * voting), and such a day is perfectly selectable.
 */
export function isSelectableDay(day: EventDay | null | undefined): boolean {
  return day !== null && typeof day === 'object' && (day.count ?? 0) > 0;
}

/**
 * The text a cell inside a multi-day span carries for a reader who cannot see it.
 *
 * This is the accessible half of the continuation marker and it is TEXT, which is
 * the part that survives greyscale print, forced-colours mode and every form of
 * colour vision deficiency. The drawn marker beside it is the part a sighted
 * reader uses at a glance; neither is sufficient alone.
 *
 * It names the covering event, the span it runs, AND the date the event is listed
 * on - because the reader who lands on 25 October by arrow-keying through the
 * grid needs to be told where to go next. Without that last clause the text says
 * only that something is happening, which leaves the reader looking for a link
 * that is not there.
 *
 * Returns '' for a day that is not covered, so a cell renderer can emit the
 * element unconditionally and never assert a non-empty string. Never throws.
 */
export function continuationLabel(day: EventDay | null | undefined): string {
  if (day === null || typeof day !== 'object' || !Array.isArray(day.covering) || day.covering.length === 0) {
    return '';
  }
  const owner = day.covering[0];
  if (owner === null || typeof owner !== 'object') return '';
  const span = formatEventDateSpan(owner.startsAt, owner.endsAt);
  // Two or more events running through one date is possible and rare; the single
  // case is worded for the reader and the plural case stays a fact.
  const who =
    day.covering.length === 1
      ? `${owner.name}, which runs ${span}`
      : `${day.covering.length} events, one of which runs ${span}`;
  return `Covered by ${who}. It is listed on ${formatEventDate(owner.startsAt)}.`;
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
 * input and must not inflate the count of the month being rendered. A day that is
 * only COVERED by a span adds nothing to it, because it holds no event of its own -
 * which is what keeps "the grids together account for every event exactly once"
 * true with covered days in the list.
 *
 * A covered day DOES get a cell, with `day` set, because that cell is how the
 * reader is told the event runs on the date. So `day` being non-null does not
 * mean "selectable": a cell whose day is only covered renders an inert `<span>`,
 * not a `<label>`.
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
 * A month is rendered if ANY day falls in it, covered or not - so a span crossing
 * a month boundary produces a grid for the month it crosses into, which is where
 * the remaining covered days have to be visible. That is the intended reading of
 * "months from the data": the data says something happens on those dates, even
 * when nothing STARTS there. The shipped early-voting window does not cross a
 * month, so test/calendar.test.mjs exercises this with a fixture rather than
 * hoping the real data grows one.
 *
 * NEVER THROWS, like every other export in this file. A month key can be
 * malformed without any caller misbehaving, because `day.key` is a plain string
 * on a plain object: anyone can call `monthGrids([{ key: '2026-13-01', ... }])`,
 * and the regex below admits `2026-13`, which `parseWallClock` then rejects.
 * events.astro calls this at MODULE SCOPE, so a throw here takes the whole build
 * down rather than one cell.
 *
 * The philosophy is stated once, at `asList`: a missing list is an empty list, a
 * bad key is a null grid, and no input makes a page fail to render. So the
 * consistency check is a filter: a month key that does not round-trip through
 * `parseWallClock` yields NO grid, exactly as `monthGridFor` returns null for
 * it. A day whose key is not a real date is dropped
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
