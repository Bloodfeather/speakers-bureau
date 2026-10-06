// test/calendar.test.mjs - the month grid, proven rather than asserted in prose.
//
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS FOR
// ---------------------------------------------------------------------------
//
// src/lib/calendar.ts is pure date arithmetic, and pure date arithmetic is the
// category of code where a wrong answer is indistinguishable from a right one by
// looking at the page. A grid that is one column out still renders six rows of
// numbers, still has every event attached to a cell, and still looks like a
// calendar. Nobody files a bug against it. The events land in the wrong weekday
// and nobody notices until the day they publish.
//
// So the two things asserted hardest here are the two that fail silently:
//
//   1. THE SELECTION UNIT IS A DAY. Two events on one date must produce ONE
//      EventDay with count 2. That is the whole reason the module exists, and it
//      is asserted directly rather than left implied by a grid assertion.
//
//   2. THE GRID DOES NOT DEPEND ON THE MACHINE TIMEZONE. This is the bug the
//      suite is really aimed at, it is explained at length in the section headed
//      "THE TIMEZONE TRAP" below, and it is tested by running the module in
//      child processes under three zones and comparing the output byte for byte.
//
// Design rule 7 is not at risk: this suite reads the committed dataset and never
// writes to it, and it writes no files at all.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  WEEKDAY_FULL,
  WEEKDAY_LABELS,
  continuationLabel,
  dayKey,
  dayRadioLabel,
  eventDays,
  isSelectableDay,
  monthGridFor,
  monthGrids
} from '../src/lib/calendar.ts';
import { isDateSpan, isPast, validateEvents } from '../src/lib/events-schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const CALENDAR_MODULE = resolve(PROJECT_ROOT, 'src', 'lib', 'calendar.ts');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The real dataset, read once, so a test can use events an author would write. */
const REAL_TEXT = await readFile(resolve(PROJECT_ROOT, 'data', 'events.json'), 'utf8');
const REAL_DOC = JSON.parse(REAL_TEXT);

/** Assert the fixture validated, then return the events. A positive control. */
function realEvents(message) {
  const result = validateEvents(REAL_DOC);
  assert.equal(result.ok, true, `${message}: the committed dataset must be valid, got ${JSON.stringify(result.problems)}`);
  assert.ok(result.events.length > 0, `${message}: the committed dataset must yield at least one event`);
  return result.events;
}

/** A minimal event that is valid, so a test can break exactly one thing. */
function goodEvent(overrides = {}) {
  return {
    id: 'test-event',
    name: 'A Test Event',
    event: 'Something happens, in words.',
    startsAt: '2026-11-14T18:30',
    endsAt: '2026-11-14T20:00',
    allDay: false,
    timezone: 'Eastern Time (ET)',
    location: 'Somewhere',
    type: 'Forum',
    thumbnail: null,
    banner: null,
    url: null,
    notes: null,
    ...overrides
  };
}

/** The grid for one month, asserting the key parsed before anything else runs. */
function gridFor(monthKey, days, message) {
  const grid = monthGridFor(monthKey, days);
  assert.ok(grid !== null, `${message}: monthGridFor("${monthKey}") must return a grid, not null`);
  return grid;
}

/** The index of the first cell whose dayNumber is `wanted`, or -1. */
function indexOfDay(grid, wanted) {
  return grid.cells.findIndex((cell) => cell.dayNumber === wanted);
}

/** The weekday offset of the 1st, worked out independently of the module. */
function weekdayOfFirst(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  // Date.UTC + getUTCDay: the same discipline the module uses, written out here
  // so the test's expected value is not the module's own output read back.
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

// ---------------------------------------------------------------------------
// The positive control for the whole suite
// ---------------------------------------------------------------------------

test('the committed dataset produces days and grids that are populated', async (t) => {
  // POSITIVE CONTROL, and it comes first on purpose. Almost every test below is a
  // negative one: padding cells are null, empty days are null, an unparseable
  // month key is null, a missing list is empty. An implementation that returned
  // all-null everywhere would pass every one of them, and the page would render a
  // grid of thirty empty squares. This is the assertion that makes the rest mean
  // anything.
  const events = realEvents('positive control');
  const days = eventDays(events);
  const grids = monthGrids(days);

  t.diagnostic(`events: ${events.length}, days: ${days.length}, grids: ${grids.length}`);
  t.diagnostic(`grid cells per month: ${grids.map((g) => `${g.key}=${g.cells.length}`).join(', ')}`);

  assert.ok(days.length > 0, 'positive control: the committed dataset must yield at least one EventDay');
  // EVERY DAY EITHER HOLDS AN EVENT OR IS COVERED BY ONE. The weaker invariant
  // "every day must hold at least one event" is not neutral: it encoded a defect,
  // because `eventDays` consulted only `startsAt`, so the days inside a span such
  // as the early voting window were not in the list at all and the assertion was in
  // part proving that the calendar under-reported voter access.
  //
  // The invariant is that no day is ever inert: if it exists, something
  // happens on it, whether that something starts there or merely runs through.
  assert.ok(
    days.every((day) => day.count === day.events.length),
    'positive control: a day\'s count must always agree with its own event list'
  );
  assert.ok(
    days.every((day) => day.count > 0 || day.continues),
    'positive control: every day must either hold an event of its own or be covered by a span. A day with neither is ' +
      'rendered as an ordinary empty square, which is the defect this suite was changed to prevent.'
  );
  assert.ok(
    days.every((day) => day.continues === day.covering.length > 0),
    'positive control: `continues` must be exactly `covering.length > 0`, or the flag and the list can disagree'
  );
  // And the two lists must never overlap: `events` is what STARTS here, `covering`
  // is what runs THROUGH here, and a day holding the same event in both would
  // double-count it in the month totals.
  assert.ok(
    days.every((day) => day.events.every((event) => !day.covering.includes(event))),
    'positive control: an event must never appear both in a day\'s own events and in its covering events'
  );
  assert.ok(
    days.some((day) => day.continues),
    'positive control: the committed dataset must exercise the covered-day path. Early voting runs 19 to 31 October ' +
      '2026, so twelve covered days exist. If it does not, the real page no longer covers this path and the fixtures ' +
      'below are the only thing testing it - say so here rather than letting the suite pass quietly.'
  );
  assert.ok(grids.length > 0, 'positive control: the committed dataset must yield at least one MonthGrid');
  assert.equal(
    grids.reduce((total, grid) => total + grid.eventCount, 0),
    events.length,
    'positive control: the grids must account for every event exactly once'
  );

  // And the grid must actually place events, which is the end of the whole chain.
  const placed = grids.reduce(
    (total, grid) => total + grid.cells.filter((cell) => cell.day !== null).length,
    0
  );
  assert.equal(placed, days.length, 'positive control: every day must land in exactly one cell');

  // Every cell is either a real day of its month or a padding cell, and the real
  // days are 1..N in ascending order with no gap and no repeat. Checked here on
  // the real data rather than only on hand-built fixtures, because the fixtures
  // could be wrong in the same way the code is.
  for (const grid of grids) {
    assert.equal(
      grid.cells.length % 7,
      0,
      `positive control: ${grid.key} must be a whole number of seven-column rows, got ${grid.cells.length}`
    );
    const real = grid.cells.filter((cell) => cell.dayNumber !== null).map((cell) => cell.dayNumber);
    assert.deepEqual(
      real,
      Array.from({ length: real.length }, (_, i) => i + 1),
      `positive control: ${grid.key} must carry its days as 1..${real.length} in order, got ${JSON.stringify(real)}`
    );
    for (const cell of grid.cells) {
      assert.ok(
        cell.dayNumber !== null || cell.day === null,
        `positive control: a padding cell in ${grid.key} must carry no day, got ${JSON.stringify(cell)}`
      );
      assert.ok(
        cell.day === null || cell.dayNumber !== null,
        `positive control: a cell carrying an EventDay must have a dayNumber, got ${JSON.stringify(cell)}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// dayKey
// ---------------------------------------------------------------------------

test('dayKey takes the date off a timed value and off an all-day value alike', () => {
  // POSITIVE CONTROL first: a timed value yields the date it starts on.
  assert.equal(
    dayKey('2026-11-14T18:30'),
    '2026-11-14',
    'a timed wall clock must yield its calendar date'
  );

  // The case that matters for this design: an all-day value is a bare date, and
  // the whole election-day row depends on it keying to the same shape.
  assert.equal(dayKey('2026-11-03'), '2026-11-03', 'a bare all-day date must yield itself');

  // A seconds part is still the same day.
  assert.equal(
    dayKey('2026-11-14T18:30:00'),
    '2026-11-14',
    'a seconds part must not change the day it is on'
  );

  // Across a month, a year and a leap day, because a zero-padding slip is the
  // kind of bug that only shows up in January.
  assert.equal(dayKey('2026-01-05T09:00'), '2026-01-05', 'a single-digit month and day must be zero-padded');
  assert.equal(dayKey('2024-02-29T09:00'), '2024-02-29', 'a leap day is a real date');
  assert.equal(dayKey('2026-12-31'), '2026-12-31', 'the last day of the year');

  // An event just before midnight local is still THAT day. This is worth stating
  // because it is the hour a timezone bug would corrupt: 11:30pm on the 3rd is
  // the 3rd, and any implementation reaching for UTC here would put it on the
  // 4th for a reader east of Greenwich.
  assert.equal(
    dayKey('2026-11-03T23:30'),
    '2026-11-03',
    'a late-evening wall clock stays on its own local date'
  );
});

test('dayKey returns an empty string rather than throwing on input it cannot use', () => {
  // POSITIVE CONTROL above proved it returns a real key for a real value; these
  // are the values that must not produce a key. The return value is a MAP KEY
  // used by eventDays and monthGridFor, so junk that quietly became a key would
  // render nowhere and cost nothing to notice.
  assert.equal(dayKey(''), '', 'the empty string must yield an empty key, not a throw');
  assert.equal(dayKey('   '), '', 'a whitespace-only value must yield an empty key');
  assert.equal(dayKey('nonsense'), '', 'prose is not a wall clock');
  assert.equal(dayKey('2026-13-01'), '', 'month 13 does not exist');
  assert.equal(dayKey('2026-02-30'), '', '30 February does not exist');
  assert.equal(dayKey('2026-11'), '', 'a month with no day is not a day key');
  assert.equal(dayKey('2026-11-14T18:30:00Z'), '', 'a UTC instant is not a wall clock; the schema rejects it upstream, and so does this');
  assert.equal(dayKey(undefined), '', 'a missing value must not throw');
  assert.equal(dayKey(null), '', 'null must not throw');
  assert.equal(dayKey(20261114), '', 'a number must not throw');
});

// ---------------------------------------------------------------------------
// THE CASE THE WHOLE DESIGN EXISTS FOR: two events, one date
// ---------------------------------------------------------------------------

test('two events on the same date produce ONE day, not two', () => {
  // THE ASSERTION THIS MODULE EXISTS TO MAKE PASSABLE. A timed debate at 6:30pm
  // and an all-day election on 2026-11-03 are two events and ONE calendar date.
  //
  // A control whose unit is the event cannot represent "the reader picked the
  // 3rd", so the panel either shows the debate and hides the election or needs a
  // second control to disambiguate - the same page with a worse interface. Grouping
  // by day is what makes the cell able to say "2 events" instead of choosing.
  const events = [
    goodEvent({ id: 'election-day', allDay: true, startsAt: '2026-11-03', endsAt: null, timezone: null }),
    goodEvent({ id: 'riverside-debate', startsAt: '2026-11-03T18:30', endsAt: '2026-11-03T20:00' })
  ];
  const days = eventDays(events);

  // POSITIVE CONTROL on the fixture: both events are genuinely on that date, and
  // dayKey agrees, so a failure below is about grouping and not about the data.
  assert.equal(events.length, 2, 'positive control: the fixture has two events');
  assert.equal(dayKey('2026-11-03'), '2026-11-03', 'positive control: the fixture date is a real day');
  assert.equal(dayKey('2026-11-03T18:30'), '2026-11-03', 'positive control: the timed event is on the same date');

  assert.equal(days.length, 1, 'two events on one date must produce exactly ONE EventDay');
  const day = days[0];
  assert.equal(day.key, '2026-11-03', 'the day must key on the shared date');
  assert.equal(day.count, 2, 'the day must count both events');
  assert.equal(day.multiple, true, 'a day with two events must be flagged multiple');
  assert.equal(day.events.length, 2, 'the day must hold both events');

  // And the single-event case must NOT be flagged multiple, or the flag means
  // nothing. This is the other half of the assertion: `multiple` is only
  // information if it is false somewhere.
  const single = eventDays([goodEvent({ id: 'solo', startsAt: '2026-12-01T10:00' })]);
  assert.equal(single.length, 1, 'positive control: one event on one date is one day');
  assert.equal(single[0].count, 1, 'a lone event counts once');
  assert.equal(single[0].multiple, false, 'a day with one event must NOT be flagged multiple');

  // Three is still one day, and the label says "3 events".
  const three = eventDays([
    goodEvent({ id: 'a', startsAt: '2026-11-10T09:00' }),
    goodEvent({ id: 'b', startsAt: '2026-11-10T12:00' }),
    goodEvent({ id: 'c', startsAt: '2026-11-10T18:00' })
  ]);
  assert.equal(three.length, 1, 'three events on one date are still one day');
  assert.equal(three[0].count, 3, 'all three must be counted');
  assert.equal(dayRadioLabel(three[0]), '10 November 2026, 3 events', 'the accessible label must state the count');
});

test('the shipped data doubles up on 3 November, so the page exercises the stacking path', (t) => {
  // THE STACKING PATH IS ASSERTED AGAINST THE REAL DATA, NOT ONLY A FIXTURE, and the
  // assertion is deliberately worded to go red on a data change so that anyone who
  // removes one of the colliding events has to render the panel in a browser and
  // confirm it still stacks, then change this assertion on purpose.
  //
  // The obvious weaker form of this test passes a hand-built FIXTURE to `eventDays`
  // and asserts `multiples.every(...)`, which is trivially true of an empty array:
  // the name would claim something about the shipped data while the assertion could
  // not fail for any input. A test that lies is worse than no test.
  const days = eventDays(realEvents('real-data doubling'));
  const multiples = days.filter((day) => day.multiple);

  t.diagnostic(`shipped data: ${days.length} dates, ${multiples.length} carrying more than one event`);

  // The shipped data NOW DOES DOUBLE UP, and it does so for a real reason rather
  // than because a test wanted it to: two elections fall on 3 November 2026 - the
  // state and federal general election, and Greenwood's municipal election - which
  // is exactly the collision the day-based selection unit exists to handle.
  //
  // So the assertion below is a POSITIVE one.
  assert.ok(
    multiples.length >= 1,
    'the shipped data is expected to carry at least one doubled date - the two elections on 3 November 2026 - so ' +
      'the stacking path is exercised by the real page rather than only by a fixture. If you have removed one of ' +
      'those events, change this deliberately.'
  );
  t.diagnostic(
    `doubled dates in the shipped data: ${multiples.map((day) => `${day.key} x${day.count}`).join(', ')}`
  );

  // And the collision is the one we think it is, not an accidental duplicate.
  assert.equal(
    multiples.some((day) => day.key === '2026-11-03' && day.count === 2),
    true,
    '2026-11-03 must carry exactly two events: the General Election and the City of Greenwood election'
  );

  // And the non-vacuous version of what the old test was reaching for: given a
  // fixture that DOES double up, every day flagged multiple must really carry more
  // than one event. Asserted on a known count so an empty result cannot pass.
  const doubled = eventDays([
    goodEvent({ id: 'a', startsAt: '2026-11-14T09:00' }),
    goodEvent({ id: 'b', startsAt: '2026-11-14T19:00' }),
    goodEvent({ id: 'c', startsAt: '2026-11-20T19:00' })
  ]);
  const flagged = doubled.filter((day) => day.multiple);

  assert.equal(flagged.length, 1, 'positive control: the fixture must produce exactly one doubled date');
  assert.equal(flagged[0].key, '2026-11-14', 'positive control: and it must be the date that was doubled');
  assert.equal(flagged[0].count, 2, 'the doubled date must report a count of 2');
  assert.equal(doubled.length, 2, 'two dates in, two days out: doubling must merge, not duplicate');
});

// ---------------------------------------------------------------------------
// Ordering: days ascending, events chronological within a day
// ---------------------------------------------------------------------------

test('days come out ascending, and events within a day come out chronological', () => {
  // The list is deliberately out of order and spans two months, so both the
  // between-day ordering and the within-day ordering have work to do.
  const events = [
    goodEvent({ id: 'dec-late', startsAt: '2026-12-20T19:00' }),
    goodEvent({ id: 'nov-late-pm', startsAt: '2026-11-14T20:00' }),
    goodEvent({ id: 'nov-early', startsAt: '2026-10-02T09:00' }),
    goodEvent({ id: 'nov-early-pm', startsAt: '2026-11-14T09:00' }),
    goodEvent({ id: 'nov-mid', startsAt: '2026-11-14T13:00' })
  ];
  const days = eventDays(events);

  // Three distinct dates: October, mid-November (three events on it) and December.
  assert.equal(days.length, 3, 'three distinct dates must produce three days');
  assert.deepEqual(
    days.map((d) => d.key),
    ['2026-10-02', '2026-11-14', '2026-12-20'],
    'days must come out ascending, and the input was deliberately not in that order'
  );

  // Within the day, chronological - NOT the order the events were handed over.
  const middle = days[1];
  assert.deepEqual(
    middle.events.map((e) => e.id),
    ['nov-early-pm', 'nov-mid', 'nov-late-pm'],
    'events within one day must be in clock order, not input order'
  );

  // Input order must not change the output. This is design rule 8 applied to
  // grouping: two builds of one commit must produce byte-identical HTML.
  const reversed = eventDays([...events].reverse());
  assert.deepEqual(
    reversed.map((d) => `${d.key}:${d.events.map((e) => e.id).join(',')}`),
    days.map((d) => `${d.key}:${d.events.map((e) => e.id).join(',')}`),
    'input order must not affect the days or the order within them'
  );

  // An all-day event on a day with a timed one sorts FIRST, because it has no
  // clock time and "that day" precedes "6:30pm that day" for a reader. That is
  // sortEvents' rule, and the day grouping inherits it rather than re-deciding.
  const mixed = eventDays([
    goodEvent({ id: 'timed', startsAt: '2026-11-03T18:30' }),
    goodEvent({ id: 'all-day', allDay: true, startsAt: '2026-11-03', endsAt: null, timezone: null })
  ]);
  assert.deepEqual(
    mixed[0].events.map((e) => e.id),
    ['all-day', 'timed'],
    'an all-day event must sort before a timed event on the same date'
  );
});

// ---------------------------------------------------------------------------
// MULTI-DAY SPANS: the covered days, and the days that must NOT be covered
// ---------------------------------------------------------------------------
//
// THE DEFECT THIS BLOCK EXISTS FOR. `eventDays` keyed every event on
// `dayKey(startsAt)` and `endsAt` was never consulted on the grid path. Early
// voting runs 19 to 31 October 2026 and was marked on the calendar on 19 October
// alone; the other twelve dates rendered as ordinary empty squares while the panel
// and the list both printed "19 - 31 October 2026". The calendar is the page's
// DEFAULT view, so on a page of real voter-access information the default view
// under-reported voter access on twelve of the thirteen days it runs - confidently,
// and in the pessimistic direction.
// ---------------------------------------------------------------------------

/** An all-day multi-day event, which is the only shape that makes a span. */
function spanEvent(overrides = {}) {
  return goodEvent({
    id: 'a-span',
    name: 'A Window',
    allDay: true,
    startsAt: '2026-10-19',
    endsAt: '2026-10-31',
    timezone: null,
    ...overrides
  });
}

test('a multi-day span marks every day it runs on, not only the day it starts', (t) => {
  const days = eventDays([spanEvent()]);

  t.diagnostic(`days produced: ${days.length}`);

  // POSITIVE CONTROL, and it comes first: the owner day is a day with the event ON
  // it. If that were false, "the twelve covered days" below could be satisfied by
  // any implementation that simply listed every date of the span as an event day.
  const owner = days.find((day) => day.key === '2026-10-19');
  assert.ok(owner !== undefined, 'positive control: the span\'s start date must be a day');
  assert.equal(owner.count, 1, 'positive control: the start date holds the event itself');
  assert.equal(owner.events.length, 1, 'positive control: and it is in `events`, not only in `covering`');
  assert.equal(owner.continues, false, 'positive control: the FIRST day of a span is not itself a covered day');
  assert.equal(owner.covering.length, 0, 'positive control: it covers nothing - it starts here');

  // THE ASSERTION. The 19th to the 31st INCLUSIVE is thirteen dates, and all
  // thirteen must be in the list: the start date plus the twelve after it. Count
  // them as the span's dates PLUS the covered ones and you get eighteen, which is
  // wrong: the start date is already among them. The number a reader cares about
  // is thirteen days of access.
  assert.equal(days.length, 13, 'a 13-day span must produce 13 days: the start date plus the twelve after it');

  const covered = days.filter((day) => day.continues);
  assert.equal(covered.length, 12, 'exactly the twelve dates after the start must be covered days');

  // The dates themselves, named out. A count of twelve is satisfied by any twelve
  // days; the reader is going to be told these are the 20th to the 31st, so the
  // test has to say so.
  assert.deepEqual(
    covered.map((day) => day.key),
    Array.from({ length: 12 }, (_, i) => `2026-10-${20 + i}`),
    'the covered dates must be 20 to 31 October, with no gap and no repeat'
  );

  // A covered day carries NO events of its own. That is what makes it distinct from
  // an event day, and it is why `isSelectableDay` exists and why a covered day must
  // not be given a radio.
  for (const day of covered) {
    assert.equal(day.events.length, 0, `a covered day must hold no events of its own (${day.key})`);
    assert.equal(day.count, 0, `a covered day counts zero events of its own (${day.key})`);
    assert.equal(day.multiple, false, `a covered day is never "multiple" (${day.key})`);
    assert.equal(isSelectableDay(day), false, `a covered day must NOT be selectable (${day.key})`);
    assert.equal(day.covering.length, 1, `and it must name the one event covering it (${day.key})`);
    assert.equal(day.covering[0].id, 'a-span', `the covering event is named on the day (${day.key})`);
  }

  // The owner IS selectable, and its label says so. A day with events on it is a
  // control; a day with none is not.
  assert.equal(isSelectableDay(owner), true, 'a day with an event on it must be selectable');
  assert.deepEqual(
    days.filter((day) => isSelectableDay(day)).map((day) => day.key),
    ['2026-10-19'],
    'the ONLY selectable day in this fixture is the span\'s first day'
  );

  // The covered day still carries its own formatted label and machine value, so a
  // cell renderer can print the date without a second lookup.
  assert.equal(covered[0].label, '20 October 2026', 'a covered day must still know what date it is');
  assert.equal(covered[0].machine, '2026-10-20', 'and its machine-readable form, for <time datetime>');
});

test('the real early-voting window produces exactly twelve covered days', (t) => {
  // THE SHIPPED DATA, not a fixture. This is the case the page actually renders, and
  // a fixture-only test would leave the real page unverified, which is how a defect
  // like this reaches a build.
  const events = realEvents('real span');
  const early = events.find((event) => event.id === 'early-voting');
  assert.ok(early !== undefined, 'positive control: the committed dataset must contain early-voting');
  assert.equal(early.allDay, true, 'positive control: early voting is an all-day event, which is what makes it a span');

  const startKey = dayKey(early.startsAt);
  const endKey = dayKey(early.endsAt);
  const days = eventDays(events);
  const covered = days.filter((day) => day.continues);

  t.diagnostic(`early voting ${startKey} to ${endKey}; ${covered.length} covered days in the real data`);
  t.diagnostic(`covered: ${covered.map((day) => day.key).join(', ')}`);

  // DERIVED FROM THE DATA, not written out, so correcting a real date does not
  // fail an unrelated arithmetic test. The count is derived too: every day strictly
  // between the two ends.
  const expected = (() => {
    const out = [];
    for (let n = Number(startKey.slice(8, 10)) + 1; n <= Number(endKey.slice(8, 10)); n += 1) {
      out.push(`2026-10-${String(n).padStart(2, '0')}`);
    }
    return out;
  })();

  assert.deepEqual(
    covered.map((day) => day.key),
    expected,
    'the real early-voting window must cover every date after its start, to its end'
  );
  assert.equal(covered.length, 12, 'the real window covers twelve days after its start');

  // And the shipped dataset must not be marked as past on the day it is reviewed,
  // which is what the inherited pastness in events.astro depends on.
  assert.equal(isPast(early, '2026-10-05'), false, 'positive control: early voting is upcoming on the review date');
});

test('a TIMED span is a time range, not a date range, and covers nothing', (t) => {
  // THE CASE THAT BIT THE SUITE ONCE. `gop-quarterly-meeting` runs 18:30 to 20:30 on
  // 5 October 2026. Read as DATES, that is 5 October to 5 October - which is not
  // two dates, so it is not a span. An implementation that ignored the times would
  // mark 5 and 6 October for a two-hour meeting, on a calendar of real election
  // dates.
  const timed = goodEvent({
    id: 'gop-quarterly-meeting',
    startsAt: '2026-10-05T18:30',
    endsAt: '2026-10-05T20:30'
  });

  // POSITIVE CONTROL: the same day twice with a LATER TIME is really the shape under
  // test. A fixture with no `endsAt` at all would pass the "zero covered days"
  // assertions below for the wrong reason - there would be no end to read.
  assert.equal(
    new Date(dayKey(timed.startsAt)).toString(),
    new Date(dayKey(timed.endsAt)).toString(),
    'positive control: the two timestamps really are on the same calendar date'
  );
  assert.equal(timed.startsAt < timed.endsAt, true, 'positive control: and the end really is later in the day');

  assert.equal(isDateSpan(timed.startsAt, timed.endsAt), false, 'a same-day timed pair is not a date span');

  const days = eventDays([timed]);
  assert.equal(days.length, 1, 'a two-hour meeting must produce ONE day, not two');
  assert.equal(days[0].key, '2026-10-05', 'and it is the day it starts on');
  assert.equal(days[0].continues, false, 'a same-day timed pair covers no other day');
  assert.equal(days.filter((day) => day.continues).length, 0, 'and produces ZERO covered days');

  // And the real event, which is the one the calendar would actually render wrong.
  const real = realEvents('timed span').find((event) => event.id === 'gop-quarterly-meeting');
  assert.ok(real !== undefined, 'positive control: the committed dataset must contain gop-quarterly-meeting');
  assert.equal(
    eventDays([real]).filter((day) => day.continues).length,
    0,
    'the real quarterly meeting must not mark a second day on the calendar'
  );
});

test('a one-day event, and an event with no endsAt, cover nothing at all', () => {
  // POSITIVE CONTROL: the span fixture DOES cover days, so "zero covered days"
  // below means the guard works rather than that the module does nothing.
  assert.equal(eventDays([spanEvent()]).filter((day) => day.continues).length, 12, 'positive control: a span covers days');

  // No end. The common case, and it must be exactly as it was before this change.
  const noEnd = eventDays([goodEvent({ id: 'open-ended', startsAt: '2026-11-14T18:30', endsAt: null })]);
  assert.equal(noEnd.length, 1, 'an event with endsAt: null yields one day');
  assert.equal(noEnd[0].continues, false, 'and it covers nothing');
  assert.equal(noEnd[0].covering.length, 0, 'and names no covering event');
  assert.equal(isDateSpan('2026-11-14T18:30', null), false, 'isDateSpan is false for a null end');

  // An all-day start with an all-day end ON THE SAME DAY. Same shape as the timed
  // case, different reason, and it is the one a hand-edited file produces by
  // forgetting to change the end date.
  const oneDay = eventDays([
    goodEvent({ id: 'single', allDay: true, startsAt: '2026-11-03', endsAt: '2026-11-03', timezone: null })
  ]);
  assert.equal(oneDay.length, 1, 'an all-day event whose endsAt is its own start is one day');
  assert.equal(oneDay[0].continues, false, 'and covers nothing, because it runs on no second date');

  // A two-day span is the smallest real one: exactly one covered day.
  const twoDay = eventDays([
    goodEvent({ id: 'pair', allDay: true, startsAt: '2026-11-03', endsAt: '2026-11-04', timezone: null })
  ]);
  assert.equal(twoDay.length, 2, 'a two-date span produces the start date plus one covered date');
  assert.equal(twoDay[1].key, '2026-11-04', 'the covered date is the day after the start');
  assert.equal(twoDay[1].continues, true, 'and it is covered');
});

test('a span crossing a month or a year boundary covers the days on the far side', () => {
  // MONTH BOUNDARY. The shipped early-voting window does not cross one, so this is
  // the only thing exercising the case - and the case matters because the second
  // month must still be RENDERED. `monthGrids` derives its months from the days,
  // and if covered days were left out of the list, 1 to 2 November would exist in
  // the data and nowhere on the page.
  const acrossMonth = eventDays([
    goodEvent({ id: 'crossing', allDay: true, startsAt: '2026-10-30', endsAt: '2026-11-02', timezone: null })
  ]);
  assert.deepEqual(
    acrossMonth.map((day) => day.key),
    ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'],
    'a span crossing a month boundary must produce a day on each side of it'
  );
  assert.deepEqual(
    acrossMonth.filter((day) => day.continues).map((day) => day.key),
    ['2026-10-31', '2026-11-01', '2026-11-02'],
    'and every date after the start is covered, whichever month it is in'
  );

  // ...and the second month IS rendered, with its covered days in it.
  const grids = monthGrids(acrossMonth);
  assert.deepEqual(
    grids.map((g) => g.key),
    ['2026-10', '2026-11'],
    'a span crossing a month boundary must produce BOTH month grids'
  );
  const november = grids.find((g) => g.key === '2026-11');
  assert.equal(november.eventCount, 0, 'November holds no event that STARTS in it');
  assert.equal(
    november.cells.filter((cell) => cell.day !== null).length,
    2,
    'but it does hold the two covered dates, or the reader is not told the event runs then'
  );
  assert.equal(
    november.cells.filter((cell) => cell.day !== null && isSelectableDay(cell.day)).length,
    0,
    'and none of them is selectable - there is no radio and no panel for a covered day'
  );

  // YEAR BOUNDARY, where the arithmetic has to roll the year as well as the month.
  // A December-to-January span is the case where a zero-padding slip in the day
  // roll would produce a key that matches no cell.
  const acrossYear = eventDays([
    goodEvent({ id: 'new-year', allDay: true, startsAt: '2026-12-28', endsAt: '2027-01-03', timezone: null })
  ]);
  assert.deepEqual(
    acrossYear.map((day) => day.key),
    ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'],
    'a span crossing a year boundary must roll the year and re-pad the day'
  );
  assert.equal(acrossYear.filter((day) => day.continues).length, 6, 'six covered dates across the year boundary');
  assert.equal(acrossYear[4].key, '2027-01-01', 'the first of January must be spelled 2027-01-01, not 2026-01-01');

  // Both months rendered, and the grids together still account for one event: the
  // covered days add nothing, so the "every event exactly once" invariant survives.
  const yearGrids = monthGrids(acrossYear);
  assert.deepEqual(
    yearGrids.map((g) => g.key),
    ['2026-12', '2027-01'],
    'both months must render'
  );
  assert.equal(
    yearGrids.reduce((total, g) => total + g.eventCount, 0),
    1,
    'the two grids together count the one event exactly once, and the covered days add none'
  );

  // A leap day inside a span, because that is where a naive day roll breaks.
  const leap = eventDays([
    goodEvent({ id: 'leap-span', allDay: true, startsAt: '2024-02-28', endsAt: '2024-03-01', timezone: null })
  ]);
  assert.deepEqual(
    leap.map((day) => day.key),
    ['2024-02-28', '2024-02-29', '2024-03-01'],
    'a span crossing 29 February must include the leap day'
  );
});

test('a day with its own events AND covered by a span carries both, and stays selectable', () => {
  // THE COMBINED CASE, which is the one the grid's three branches are built for: a
  // debate on the 22nd, inside a fortnight of early voting. `events` holds the
  // debate, `covering` holds the voting window, and the day is selectable because
  // the reader can genuinely choose it - there is something to show them.
  const days = eventDays([
    spanEvent(),
    goodEvent({ id: 'mid-window-debate', startsAt: '2026-10-22T19:00', endsAt: '2026-10-22T20:00' })
  ]);

  const both = days.find((day) => day.key === '2026-10-22');
  assert.ok(both !== undefined, 'positive control: the debate date must be in the day list');
  assert.deepEqual(
    both.events.map((e) => e.id),
    ['mid-window-debate'],
    'its own event is in `events`'
  );
  assert.deepEqual(
    both.covering.map((e) => e.id),
    ['a-span'],
    'the event it runs through is in `covering`'
  );
  assert.equal(both.count, 1, 'it counts one event of its own');
  assert.equal(both.continues, true, 'and it is still flagged as covered');
  assert.equal(isSelectableDay(both), true, 'so it IS selectable - there is a panel with something in it');
  assert.equal(dayRadioLabel(both), '22 October 2026, 1 event', 'and its radio label counts only its own event');

  // The month grid places it once, and the month's total counts each event once.
  const october = monthGridFor('2026-10', days);
  assert.equal(october.eventCount, 2, 'October holds two events that START in it, not nineteen');
  const placed = october.cells.filter((cell) => cell.day !== null);
  assert.equal(placed.length, 13, 'and thirteen dates carry something - the debate plus the twelve covered days');

  // Two events covering ONE date: both are named, and neither is lost. This is the
  // case that makes `covering` a list rather than a single event.
  const doubled = eventDays([
    spanEvent({ id: 'first-window' }),
    spanEvent({ id: 'second-window', startsAt: '2026-10-24', endsAt: '2026-10-31' })
  ]);
  const coveredTwice = doubled.find((day) => day.key === '2026-10-25');
  assert.ok(coveredTwice !== undefined, 'positive control: a date inside both windows must exist');
  assert.deepEqual(
    coveredTwice.covering.map((e) => e.id),
    ['first-window', 'second-window'],
    'both covering events are named, ascending by their own start'
  );
  // The range is spelled by `formatEventDateSpan`, so a same-month span reads
    // "19 - 31 October 2026" with ONE month name. That is the point of asserting on
    // the string rather than on a shape: if the wording changes, this fails loudly
    // instead of quietly accepting a looser pattern.
    assert.equal(
      continuationLabel(coveredTwice),
      'Covered by 2 events, one of which runs 19 - 31 October 2026. It is listed on 19 October 2026.',
      'the hidden text says there are two events running through it rather than naming one and hiding the other'
    );
});

test('continuationLabel says what is covered, how long, and where it is listed', (t) => {
  const days = eventDays([
    spanEvent({ id: 'early-voting', name: 'Early Voting (in person)', startsAt: '2026-10-19', endsAt: '2026-10-31' })
  ]);
  const covered = days.find((day) => day.key === '2026-10-25');

  // A day that is not covered must yield the empty string, so a renderer can emit
  // the element unconditionally. A function that returned text for everything would
  // put a false sentence in every empty cell.
  assert.notEqual(continuationLabel(covered), '', 'positive control: a covered day yields real text');
  assert.equal(continuationLabel(days.find((day) => day.key === '2026-10-19')), '', 'the span\'s own day is not covered');
  assert.equal(continuationLabel(null), '', 'a missing day yields an empty string, not a throw');
  assert.equal(continuationLabel(undefined), '', 'an undefined day must not throw');

  const label = continuationLabel(covered);
  t.diagnostic(`continuationLabel: ${label}`);

  // THREE facts, and all three are needed. Name the event and the reader does not
  // know what is running; give the range and they still cannot find it in the list;
  // give the start date and they can. This is the difference between marking a day
  // and telling a reader what to do about it.
  assert.match(label, /Covered by Early Voting \(in person\)/, 'it names the event that runs on the date');
  assert.match(label, /runs 19 - 31 October 2026/, 'and the range it runs, using the same formatter as the panel');
  assert.match(label, /listed on 19 October 2026/, 'and the date it is listed on, which is the only way to reach it');
  assert.equal(label.includes('25 October'), false, 'and it does not describe the covered day as if it were the event day');

  // ASCII only, because this string is written into a built page on a machine that
  // corrupts non-ASCII source (ROADMAP design rule 9).
  for (let i = 0; i < label.length; i += 1) {
    assert.ok(label.charCodeAt(i) <= 127, `continuationLabel must be ASCII, found U+${label.charCodeAt(i).toString(16)} at ${i}`);
  }
});

test('eventDays never throws on a missing or malformed list', () => {
  // POSITIVE CONTROL first, because every assertion here is "does not throw" and
  // a function that throws on ALL input would pass all of them.
  assert.equal(eventDays([goodEvent()]).length, 1, 'positive control: one good event yields one day');

  for (const bad of [null, undefined, [], 'a string', 42, {}]) {
    let result;
    assert.doesNotThrow(
      () => {
        result = eventDays(bad);
      },
      `eventDays must not throw on ${JSON.stringify(bad)}`
    );
    assert.deepEqual(result, [], `eventDays(${JSON.stringify(bad)}) must be an empty list, not ${JSON.stringify(result)}`);
  }

  // Entries inside a real list. sortEvents calls .split on startsAt, so a null
  // entry or an event with no startsAt would throw there rather than in the
  // grouping, and this module must not be the thing that finds out.
  const hostile = [
    [null],
    [undefined],
    [[]],
    ['a string'],
    [goodEvent({ startsAt: '' })],
    [goodEvent({ startsAt: 'nonsense' })],
    [goodEvent({ startsAt: '2026-02-30T10:00' })],
    [goodEvent(), null, goodEvent({ id: 'other', startsAt: '2026-12-01T10:00' })]
  ];
  for (const list of hostile) {
    let result;
    assert.doesNotThrow(
      () => {
        result = eventDays(list);
      },
      `eventDays must not throw on a list containing ${JSON.stringify(list)}`
    );
    assert.ok(Array.isArray(result), `eventDays must return an array for ${JSON.stringify(list)}`);
  }

  // The last hostile list is the interesting one: the usable events survive
  // rather than the whole list being discarded. A filter that threw everything
  // away would pass every doesNotThrow above and render an empty calendar.
  const mixed = eventDays([goodEvent({ id: 'kept-a' }), null, goodEvent({ id: 'kept-b', startsAt: '2026-12-01T10:00' })]);
  assert.deepEqual(
    mixed.map((d) => d.key),
    ['2026-11-14', '2026-12-01'],
    'usable events must survive alongside unusable entries, or one bad row empties the calendar'
  );
});

// ---------------------------------------------------------------------------
// Grid shape: where the 1st lands, and how many cells there are
// ---------------------------------------------------------------------------

test('the 1st of the month lands in the column its weekday names', () => {
  // THE TEST THAT WOULD HAVE CAUGHT THE TIMEZONE BUG. If `leading` were computed
  // with a local accessor, every one of these offsets would be one too small west
  // of Greenwich and the 1st would render a column early. On a machine set to UTC
  // they would all pass, which is why the offsets below were chosen to DIFFER
  // rather than to be 0.
  //
  // The expected values are worked out here by this test, from Date.UTC and
  // getUTCDay, and printed in the message - so a failure names the month, the
  // expected column and the column actually used.
  const months = [
    '2026-11', // the 1st is a Sunday, so offset 0: no leading padding at all
    '2026-01', // a Thursday
    '2026-06', // a Monday
    '2026-09', // a Tuesday
    '2026-08' // a Saturday, the largest possible offset
  ];
  const seen = new Set();

  for (const key of months) {
    const grid = gridFor(key, [], `first-day placement for ${key}`);
    const expected = weekdayOfFirst(key);

    // POSITIVE CONTROL on the instrument: a grid with no cells could not fail an
    // index assertion in a way that means anything, so the shape is checked first.
    assert.equal(grid.key, key, `${key}: the grid must echo its key`);
    assert.ok(grid.cells.length >= 35, `${key}: a grid must have at least 35 cells, got ${grid.cells.length}`);

    assert.equal(
      grid.cells[expected].dayNumber,
      1,
      `${key}: the 1st must land in column ${expected} (${WEEKDAY_FULL[expected]}), but column ` +
        `${grid.cells[expected].dayNumber} is there and the 1st is at index ${indexOfDay(grid, 1)}`
    );
    assert.equal(
      indexOfDay(grid, 1),
      expected,
      `${key}: the 1st must be the cell at index ${expected}, got ${indexOfDay(grid, 1)}`
    );

    // Everything before it is padding, and everything after it is a real day or
    // padding - which is the same shape as the padding test below but asserted
    // here so a failure about placement cannot be mistaken for one about padding.
    for (let i = 0; i < expected; i += 1) {
      assert.equal(grid.cells[i].dayNumber, null, `${key}: cell ${i} precedes the 1st and must be padding`);
    }
    assert.notEqual(seen.has(expected), true, `${key}: this suite needs months with DIFFERENT offsets, and ${expected} repeats`);
    seen.add(expected);
  }

  // Stated rather than left implicit, so a reader knows what the fixture set is
  // for: 2026-11 is offset 0 and the others are not, which is the whole point.
  assert.equal(seen.size, months.length, 'every month in the fixture must have a distinct weekday offset');
  assert.ok(seen.has(0), 'the fixture must include a Sunday 1st, which is the zero-padding case');
  assert.ok(seen.size > 1, 'positive control: the fixture must include at least two offsets, or this test proves nothing');
});

test('every month grid is 35 or 42 cells, never anything else', () => {
  // Twelve consecutive months of 2026, so both the five-row and the six-row shape
  // are exercised, and a month that begins on a Sunday in a non-leap February -
  // which has exactly four natural weeks - is included rather than avoided.
  //
  // The floor at 35 is deliberate and is stated in the MonthGrid doc comment: a
  // February that starts on a Sunday would otherwise be 28 cells, the only month
  // in a century with that height, and a component written against
  // `cells.length === 42` would be wrong in one month out of twelve.
  const fiveRow = ['2026-11', '2026-03', '2026-01', '2026-04', '2026-06', '2026-07', '2026-09', '2026-10', '2026-12'];
  const sixRow = ['2026-05', '2026-08'];

  for (const key of [...fiveRow, ...sixRow]) {
    const grid = gridFor(key, [], `cell count for ${key}`);
    const expected = key === '2026-02' ? 35 : key === '2026-05' || key === '2026-08' ? 42 : grid.cells.length;

    assert.equal(grid.cells.length % 7, 0, `${key}: cells must be a whole number of seven-column rows, got ${grid.cells.length}`);
    assert.ok(
      grid.cells.length === 35 || grid.cells.length === 42,
      `${key}: a month grid must be 35 or 42 cells, got ${grid.cells.length}`
    );
    assert.equal(grid.cells.length, expected, `${key}: ${expected} cells were expected for this month`);
  }

  // The two shapes are genuinely both present, so this is not a suite that only
  // ever exercises the five-row case.
  const lengths = new Set([...fiveRow, ...sixRow].map((key) => gridFor(key, [], 'shape survey').cells.length));
  assert.ok(lengths.has(35), 'positive control: at least one month must be a five-row grid');
  assert.ok(lengths.has(42), 'positive control: at least one month must be a six-row grid');

  // February 2026 begins on a Sunday and has 28 days, so it is the month the
  // floor exists for. Named explicitly rather than left to the loop above.
  const february = gridFor('2026-02', [], 'four-week February');
  assert.equal(february.cells.length, 35, 'February 2026 starts on a Sunday and has 28 days, so the five-row floor applies');
  assert.equal(
    february.cells.filter((cell) => cell.dayNumber !== null).length,
    28,
    'February 2026 must still have exactly 28 real days, and 7 padding cells'
  );

  // The 30th and 31st land where they should, which catches an off-by-one in the
  // loop that builds the real days. 1 December 2026 is a Tuesday, so the 1st is
  // cell 2 and the 31st is cell 2 + 30 = 32.
  const december = gridFor('2026-12', [], 'end of a 31-day month');
  assert.equal(weekdayOfFirst('2026-12'), 2, '1 December 2026 is a Tuesday, so cell 2');
  assert.equal(indexOfDay(december, 31), 32, 'the 31st must be cell 32, i.e. lead 2 plus 30 days before it');
  assert.equal(indexOfDay(december, 30), 31, 'the 30th must be cell 31');
  assert.equal(december.cells.length, 35, 'December 2026 completes its last week exactly');
});

test('a padding cell is blank, and a real day with no events is a number', () => {
  // The distinction is the whole reason DayCell models padding rather than
  // leaving it out: `dayNumber: null` is how a component knows a square belongs
  // to the previous or next month, and a day that is merely empty is still a
  // place in THIS month that the reader can look at.
  const days = eventDays([
    goodEvent({ id: 'one', startsAt: '2026-11-14T18:30' }),
    goodEvent({ id: 'two', startsAt: '2026-11-14T20:00' })
  ]);
  const grid = gridFor('2026-11', days, 'padding versus empty');

  // November 2026 starts on a Sunday, so there is NO leading padding; the 1st is
  // cell 0. Checked so the trailing assertions below cannot pass vacuously
  // because there was nothing to distinguish them from.
  assert.equal(grid.cells[0].dayNumber, 1, 'positive control: 1 November 2026 is a Sunday and occupies cell 0');

  const padding = grid.cells.filter((cell) => cell.dayNumber === null);
  assert.ok(padding.length > 0, 'positive control: a 30-day month starting on a Sunday still needs trailing padding');
  for (const cell of padding) {
    assert.equal(cell.day, null, 'a padding cell must carry no day');
  }

  const realCells = grid.cells.filter((cell) => cell.dayNumber !== null);
  assert.equal(realCells.length, 30, 'November has 30 real days and every one gets a cell');

  // The day with events references the EventDay from the input - identity, not a
  // copy, so a component that stored a cell's `day` and looked it up later would
  // find the same object the grid was built from.
  const fourteenth = grid.cells[indexOfDay(grid, 14)];
  assert.equal(fourteenth.dayNumber, 14, 'the 14th is a real day of November');
  assert.ok(fourteenth.day !== null, 'a date carrying events must reference an EventDay');
  assert.equal(fourteenth.day.key, '2026-11-14', 'the referenced day must be the right date');
  assert.equal(fourteenth.day.count, 2, 'the referenced day must carry both events');
  assert.equal(fourteenth.day, days[0], 'the cell must reference the very EventDay the caller passed in, not a copy');

  // And a real day with NO events has a dayNumber and a null day. 15 November is
  // not in the fixture, so it is the empty case.
  const fifteenth = grid.cells[indexOfDay(grid, 15)];
  assert.equal(fifteenth.dayNumber, 15, 'a day with no events is still a real day of the month');
  assert.equal(fifteenth.day, null, 'a real day with no events must carry no EventDay');

  // Every cell is exactly one of the two, checked across the whole grid rather
  // than on two samples, so a cell that was somehow both or neither is caught.
  for (const cell of grid.cells) {
    const kind = cell.dayNumber === null ? 'padding' : cell.day === null ? 'empty' : 'event';
    assert.ok(
      ['padding', 'empty', 'event'].includes(kind),
      `a cell in November must be padding, an empty day, or a day with events, got ${JSON.stringify(cell)}`
    );
  }
  const kinds = grid.cells.reduce((tally, cell) => {
    const kind = cell.dayNumber === null ? 'padding' : cell.day === null ? 'empty' : 'event';
    tally[kind] = (tally[kind] ?? 0) + 1;
    return tally;
  }, {});
  assert.equal(kinds.event, 1, 'exactly one cell carries events');
  assert.equal(kinds.empty, 29, 'the other 29 real days are empty');
  assert.equal(kinds.padding, 5, 'November 2026 needs 5 trailing padding cells to complete its last week');
});

test('a month with events in it counts only its own events', () => {
  // POSITIVE CONTROL: the fixture really does span three months, or this test
  // would pass on a grid that counted nothing.
  const days = eventDays([
    goodEvent({ id: 'october', startsAt: '2026-10-02T09:00' }),
    goodEvent({ id: 'nov-a', startsAt: '2026-11-03T18:30' }),
    goodEvent({ id: 'nov-b', startsAt: '2026-11-14T18:30' }),
    goodEvent({ id: 'december', startsAt: '2026-12-20T19:00' })
  ]);
  assert.equal(days.length, 4, 'positive control: the fixture spans three months and four dates');

  const november = gridFor('2026-11', days, 'per-month counting');
  assert.equal(november.eventCount, 2, 'November holds two of the four events, not all four');
  assert.equal(indexOfDay(november, 3), 2, '3 November 2026 is a Tuesday, so cell 2');
  assert.equal(indexOfDay(november, 14), 13, '14 November 2026 is a Saturday, so cell 13');

  const october = gridFor('2026-10', days, 'October counting');
  assert.equal(october.eventCount, 1, 'October holds one event');
  const december = gridFor('2026-12', days, 'December counting');
  assert.equal(december.eventCount, 1, 'December holds one event');

  // And the total across all three is the whole list, so nothing was lost or
  // double-counted by building each grid independently.
  const total = [october, november, december].reduce((sum, g) => sum + g.eventCount, 0);
  assert.equal(total, 4, 'the three grids together must account for all four events');

  // A grid for a month with NO days in the input is still a grid, with no events.
  const september = gridFor('2026-09', days, 'a month absent from the data');
  assert.equal(september.eventCount, 0, 'a month not in the days list must count zero');
  assert.equal(
    september.cells.filter((cell) => cell.day !== null).length,
    0,
    'and must carry no day'
  );
});

test('an unparseable month key yields null rather than an empty grid', () => {
  // POSITIVE CONTROL on the parser itself: real keys in the same shapes the
  // component will pass must still work, or this test would pass on a grid
  // function that returns null for everything.
  for (const good of ['2026-11', '2026-01', '2026-12', '2024-02']) {
    assert.ok(
      monthGridFor(good, []) !== null,
      `positive control: monthGridFor("${good}") must return a grid, so the negative cases below mean something`
    );
  }

  for (const bad of ['', '   ', 'nonsense', '2026-13', '2026-00', '2026-1', '202611', '2026-11-01', '11-2026', null, undefined, 202611]) {
    assert.equal(
      monthGridFor(bad, []),
      null,
      `monthGridFor(${JSON.stringify(bad)}) must return null, so the caller finds out about its own bug`
    );
  }

  // A null is the right answer rather than an empty grid because a caller that
  // passed a bad key has a bug, and a blank calendar would hide it: the page
  // would render a month heading with thirty blank squares and nothing red.
  assert.equal(monthGridFor('2026-99', []), null, 'month 99 is not a month');

  // And monthGridFor must not throw on a missing days list either.
  let result;
  assert.doesNotThrow(
    () => {
      result = monthGridFor('2026-11', null);
    },
    'monthGridFor must not throw when the days list is missing'
  );
  assert.ok(result !== null, 'a missing days list is an empty one, not a bad month key');
  assert.equal(result.eventCount, 0, 'and the grid is empty');
});

// ---------------------------------------------------------------------------
// THE TIMEZONE TRAP
// ---------------------------------------------------------------------------
//
// A date-only string with no time and no offset is parsed by the ECMAScript
// spec as UTC MIDNIGHT. That is not an implementation quirk, it is the spec, and
// it is why this works:
//
//     new Date('2026-11-01')            // 2026-11-01T00:00:00Z
//     .getDay()  in UTC                 // 0  (Sunday, correct)
//     .getDay()  in America/Los_Angeles // 6  (Saturday, the day BEFORE)
//
// Reading UTC midnight back with a LOCAL accessor applies the machine's offset,
// and every offset west of Greenwich is negative, so the local clock is still on
// the previous evening. The grid shifts a column and every event lands under the
// wrong weekday, on a build machine whose zone nobody chose.
//
// THE FAILURE IS INVISIBLE ON A MACHINE SET TO UTC, which is why it ships, and
// why "the tests pass" is not the argument: the tests pass on THIS machine, whose
// zone is America/New_York, and they pass on the GH Pages runner, and they would
// also pass in UTC - which is precisely the configuration in which the bug does
// not reproduce. So the grid is run in child processes with TZ set explicitly and
// the output compared byte for byte.
// ---------------------------------------------------------------------------

test('the grids are byte-identical under UTC, Los Angeles and Kathmandu', async (t) => {
  // A fixed fixture defined HERE and duplicated into the child script, rather
  // than the child importing a module that builds its own data: the child must
  // compute from the same inputs or the comparison is not a comparison.
  const FIXTURES = [
    goodEvent({ id: 'october-start', startsAt: '2026-10-02T09:00', endsAt: null }),
    goodEvent({ id: 'election-day', allDay: true, startsAt: '2026-11-03', endsAt: null, timezone: null }),
    goodEvent({ id: 'riverside-debate', startsAt: '2026-11-03T18:30', endsAt: '2026-11-03T20:00' }),
    goodEvent({ id: 'winter-open', allDay: true, startsAt: '2026-11-14', endsAt: null, timezone: null }),
    // A SPAN, AND IT IS IN THIS FIXTURE FOR THE SAKE OF THE COMPARISON BELOW. The
    // covered-day walk in `eventDays` is the only code in this module that ADDS to a
    // date, and it is the only place where a machine offset could shift a key: one
    // zone rolling a day backwards produces a different set of covered days, and the
    // grids would then differ across zones for a reason that looks like a timezone
    // bug in the reader's data rather than in the code. The fixture was all
    // single-date events before this, which left the new arithmetic uncompared.
    goodEvent({
      id: 'winter-window',
      name: 'A Three Day Window',
      allDay: true,
      startsAt: '2026-11-14',
      endsAt: '2026-11-16',
      timezone: null
    }),
    // And a span crossing a MONTH, so the roll is compared across the boundary too.
    goodEvent({
      id: 'month-crossing',
      name: 'A Window Over The Month End',
      allDay: true,
      startsAt: '2026-10-30',
      endsAt: '2026-11-02',
      timezone: null
    }),
    goodEvent({ id: 'february-leap', startsAt: '2024-02-29T09:00', endsAt: null }),
    goodEvent({ id: 'december-end', startsAt: '2026-12-31T18:30', endsAt: null })
  ];

  // Only the fields the calendar reads are serialised into the child. An event
  // carries a name and a description that have nothing to do with date
  // arithmetic, and putting them in the comparison would mean a copy edit to
  // data/events.json failed a timezone test - which is the wrong reason for a
  // red build.
  const slim = FIXTURES.map((event) => ({
    id: event.id,
    name: event.name,
    event: event.event,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    timezone: event.timezone,
    location: event.location,
    type: event.type,
    thumbnail: null,
    banner: null,
    url: null,
    notes: null
  }));

  const script = `
    import { eventDays, monthGrids } from ${JSON.stringify(pathToFileURL(CALENDAR_MODULE).href)};
    const events = ${JSON.stringify(slim)};
    const grids = monthGrids(eventDays(events));
    // JSON, not console.log: a stray newline or a "[object Object]" would make
    // two correct runs differ for a reason that has nothing to do with timezones.
    process.stdout.write(JSON.stringify(grids.map((g) => ({
      key: g.key,
      label: g.label,
      eventCount: g.eventCount,
      cells: g.cells.map((c) => [c.dayNumber, c.day === null ? null : c.day.key])
    }))));
  `;

  const run = (tz) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8'
    });

  const utc = run('UTC');
  const losAngeles = run('America/Los_Angeles');
  const kathmandu = run('Asia/Kathmandu');

  // -------------------------------------------------------------------------
  // POSITIVE CONTROL, IN FOUR PARTS, because a comparison of three runs is
  // satisfied by three EMPTY runs.
  // -------------------------------------------------------------------------
  //
  // 1. The child produced text. An empty string from every zone would be
  //    "identical" and would pass the whole point of this test.
  assert.ok(utc.length > 100, `positive control: the child must actually emit a grid, got ${utc.length} characters`);
  assert.match(utc, /"2026-11"/, 'positive control: the child must emit the November grid key, got a truncated run');

  // 2. It parses as JSON. A crash or a stray character would leave text that
  //    string-compares identically across zones and means nothing.
  let parsed;
  assert.doesNotThrow(
    () => {
      parsed = JSON.parse(utc);
    },
    `positive control: the child output must be JSON, got: ${utc.slice(0, 200)}`
  );

  // 3. THE SHAPE IS RIGHT, checked against the grid this process builds itself.
  //    A run that emitted one cell per grid, or dropped the months, would agree
  //    across all three zones and be wrong. This is the oracle the invariance
  //    comparison cannot be: an invariance test says "these agree", never "these
  //    are right".
  const local = monthGrids(eventDays(slim)).map((g) => ({
    key: g.key,
    label: g.label,
    eventCount: g.eventCount,
    cells: g.cells.map((c) => [c.dayNumber, c.day === null ? null : c.day.key])
  }));
  assert.deepEqual(
    parsed,
    local,
    'the child must compute the same grids as this process, or the cross-zone comparison below is comparing nothing'
  );
  assert.deepEqual(
    parsed.map((g) => g.key),
    ['2024-02', '2026-10', '2026-11', '2026-12'],
    'positive control: the fixture must produce four months, ascending, including a leap-day month'
  );
  const novemberFromChild = parsed.find((g) => g.key === '2026-11');
  assert.equal(novemberFromChild.eventCount, 4, 'positive control: November carries four events that START in it');
  assert.equal(novemberFromChild.cells.length, 35, 'positive control: the November grid must be a five-row grid');
  assert.equal(novemberFromChild.cells[0][0], 1, 'positive control: 1 November 2026 must be cell 0, the Sunday column');
  assert.equal(novemberFromChild.cells[13][0], 14, 'positive control: 14 November 2026 must be cell 13, a Saturday');

  // `month-crossing` starts in OCTOBER, so it must not be counted here even though
  // it covers two November dates. That is the "each grid counts only its own events"
  // rule meeting a span for the first time, and getting it wrong would report four
  // events in November for three that start there.
  assert.equal(
    parsed.find((g) => g.key === '2026-10').eventCount,
    2,
    'positive control: October counts the two events that start there, and not the span reaching into November'
  );

  // The fixture's SPANS, in the child's own output - so the covered days are part of
  // what the cross-zone comparison is actually comparing, and not merely part of
  // what this process computed. November holds 3 and 14 November plus the two dates
  // the November window covers; 1 and 2 November are covered from October.
  assert.deepEqual(
    novemberFromChild.cells.filter(([, key]) => key !== null).map(([dayNumber]) => dayNumber),
    [1, 2, 3, 14, 15, 16],
    'positive control: the child must place both spans\' dates, including the ones covered from October'
  );
  assert.equal(
    parsed
      .find((g) => g.key === '2026-10')
      .cells.filter(([, key]) => key !== null)
      .map(([dayNumber]) => dayNumber)
      .join(','),
    '2,30,31',
    'positive control: the month-crossing span must put covered days on 31 October as well as in November'
  );

  // 4. THE BUG IS DEMONSTRABLY REAL ON THIS MACHINE, which is the step that stops
  //    this test from being vacuously green. If the local-accessor version of
  //    the same arithmetic did NOT differ under TZ, then the zones below are not
  //    doing anything and the whole comparison is decoration.
  const buggy = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "process.stdout.write(String(new Date('2026-11-01').getDay()))"
    ],
    { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' }
  );
  t.diagnostic(`new Date('2026-11-01').getDay() under TZ=America/Los_Angeles: ${buggy}`);
  assert.equal(
    buggy.trim(),
    '6',
    'positive control: this test can only be meaningful if the local-accessor version IS wrong here. ' +
      'If this now returns 0, the machine or Node changed and the invariance comparison below may be testing nothing'
  );

  t.diagnostic(`child output: ${utc.length} characters, identical across three zones`);

  // -------------------------------------------------------------------------
  // THE ACTUAL ASSERTION.
  // -------------------------------------------------------------------------
  // Asia/Kathmandu is UTC+5:45, which is the offset that breaks naive
  // implementations hardest - it is not a whole number of hours, so an approach
  // that rounded an offset to hours would still agree in most zones and be wrong
  // there.
  assert.equal(
    losAngeles,
    utc,
    'the grids must be byte-identical in America/Los_Angeles (UTC-8/-7, the zone this bug reproduces in)'
  );
  assert.equal(kathmandu, utc, 'the grids must be byte-identical in Asia/Kathmandu (UTC+5:45)');
});

// ---------------------------------------------------------------------------
// monthGrids: months from the data only
// ---------------------------------------------------------------------------

test('monthGrids derives its months from the data and invents nothing', () => {
  // The 3 November fixture is the case that matters for this function as well as
  // for grouping: two events, one date, and the month must appear ONCE.
  const days = eventDays([
    goodEvent({ id: 'october', startsAt: '2026-10-02T09:00' }),
    goodEvent({ id: 'election-day', allDay: true, startsAt: '2026-11-03', endsAt: null, timezone: null }),
    goodEvent({ id: 'debate', startsAt: '2026-11-03T18:30' }),
    goodEvent({ id: 'november', startsAt: '2026-11-14T18:30' }),
    goodEvent({ id: 'december', startsAt: '2026-12-20T19:00' })
  ]);
  const grids = monthGrids(days);

  // POSITIVE CONTROL on the fixture: it really does span three months.
  assert.equal(days.length, 4, 'positive control: the fixture has four distinct dates');

  assert.deepEqual(
    grids.map((g) => g.key),
    ['2026-10', '2026-11', '2026-12'],
    'months must come from the data, ascending, with no invented ones'
  );
  assert.deepEqual(
    grids.map((g) => g.label),
    ['October 2026', 'November 2026', 'December 2026'],
    'labels come from the month table, not from ICU on the build machine'
  );
  assert.deepEqual(
    grids.map((g) => g.eventCount),
    [1, 3, 1],
    'each grid counts only its own events'
  );
  assert.equal(grids.length, 3, 'a date carrying two events must produce ONE month, not two');

  // No invented months. This is the assertion that stops someone "improving"
  // monthGrids to render all twelve months so the page has a full year on it:
  // every invented month is a heading the reader is shown with nothing in it.
  assert.equal(
    grids.some((g) => g.key === '2026-01' || g.key === '2026-02' || g.key === '2026-09'),
    false,
    'a month with no events must not appear in the calendar'
  );

  // The day that carries two events is in November ONCE, and both are there.
  const november = grids.find((g) => g.key === '2026-11');
  const third = november.cells[november.cells.findIndex((cell) => cell.dayNumber === 3)];
  assert.equal(third.day.count, 2, 'the doubled-up date must be a single cell holding both events');
  assert.deepEqual(
    third.day.events.map((e) => e.id),
    ['election-day', 'debate'],
    'and both events must be on it, with the all-day one first'
  );

  // An empty or missing list yields no months at all. Not a placeholder month,
  // not an empty grid - nothing, because a calendar of empty months says the
  // year exists and has nothing in it.
  assert.deepEqual(monthGrids([]), [], 'an empty day list yields no months');
  assert.deepEqual(monthGrids(null), [], 'a missing day list yields no months and must not throw');
  assert.deepEqual(monthGrids(undefined), [], 'an undefined day list must not throw');
  assert.deepEqual(monthGrids(eventDays([])), [], 'no events means no days and no months');
});

test('monthGrids drops a month it cannot lay out instead of throwing', () => {
  // THE THROW THIS REPLACED. monthGrids used to assert that every key it found had
  // come out of a real day's key, and to throw if `monthGridFor` disagreed:
  //
  //     throw new Error(`monthGrids: ${key} came from a real day but did not parse`)
  //
  // The assertion was FALSE. `day.key` is a string on a plain object, and the key
  // filter here is a regex on `YYYY-MM`, which `2026-13` passes. monthGridFor then
  // rejects it through parseWallClock's round-trip, returns null, and the build
  // died inside a helper - at MODULE SCOPE in events.astro, so `npm run build`
  // went red with a stack trace instead of rendering a page.
  //
  // Every other export in this module never throws, and that is a stated rule, not
  // an accident: a missing list is an empty list, a bad month key is a null grid.
  // monthGrids was the one exception, and the exception was the one that could
  // take the build down.
  //
  // The fix is a filter, not a cast, so the bad month yields NO grid exactly as
  // monthGridFor already returned null for it. A bad DATE IN THE DATA is still
  // reported properly and loudly by src/lib/events.ts and `npm run events:check`;
  // this function lays out grids and is not the place that gets to find out.
  //
  // POSITIVE CONTROL first, because every assertion below is "does not throw" and a
  // function that threw on everything would pass all of them.
  const good = monthGrids(eventDays([goodEvent({ startsAt: '2026-11-14T18:30' })]));
  assert.equal(good.length, 1, 'positive control: one real day must yield one grid');
  assert.equal(good[0].key, '2026-11', 'positive control: and it must be the right month');

  // A month-13 key. Matches /^\d{4}-\d{2}$/, so it reaches monthGridFor, which
  // rejects it. This is the input that used to throw.
  const impossible = [
    { key: '2026-13-01', label: 'x', machine: '2026-13-01', events: [], count: 1, multiple: false }
  ];
  let result;
  assert.doesNotThrow(
    () => {
      result = monthGrids(impossible);
    },
    'monthGrids must not throw on a day whose key names month 13'
  );
  assert.deepEqual(result, [], 'a month that does not exist yields no grid, rather than a throw or a blank one');

  // Month 00, and a day that is not a date at all.
  for (const key of ['2026-00-15', 'nonsense-01', '', '2026-1-1']) {
    assert.doesNotThrow(
      () => monthGrids([{ key, label: 'x', machine: key, events: [], count: 1, multiple: false }]),
      `monthGrids must not throw on the day key ${JSON.stringify(key)}`
    );
  }

  // A bad month alongside a good one: the good month SURVIVES. A guard that threw
  // everything away would pass every doesNotThrow above and render an empty
  // calendar, which is the failure this test exists to prevent.
  const mixed = monthGrids([
    { key: '2026-11-14', label: 'x', machine: '2026-11-14', events: [], count: 1, multiple: false },
    { key: '2026-13-01', label: 'x', machine: '2026-13-01', events: [], count: 1, multiple: false }
  ]);
  assert.deepEqual(
    mixed.map((g) => g.key),
    ['2026-11'],
    'the real month must survive alongside an impossible one'
  );

  // And the shape of the argument is defended too: entries that are not days at all.
  for (const bad of [null, undefined, 'a string', 42, {}, [{ key: 123 }], [{ key: null }]]) {
    assert.doesNotThrow(() => monthGrids(bad), `monthGrids must not throw on ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// dayRadioLabel
// ---------------------------------------------------------------------------

test('the radio label names the date and the count, singular or plural', () => {
  const days = eventDays([
    goodEvent({ id: 'solo', startsAt: '2026-11-14T18:30' }),
    goodEvent({ id: 'late-a', startsAt: '2026-11-03T18:30' }),
    goodEvent({ id: 'late-b', startsAt: '2026-11-03T20:00' }),
    goodEvent({ id: 'x', startsAt: '2026-11-20T09:00' }),
    goodEvent({ id: 'y', startsAt: '2026-11-20T10:00' }),
    goodEvent({ id: 'z', startsAt: '2026-11-20T11:00' })
  ]);
  const byKey = new Map(days.map((d) => [d.key, d]));

  // POSITIVE CONTROL on the fixture: the counts the labels depend on are real.
  assert.equal(days.length, 3, 'positive control: three distinct dates');
  assert.equal(byKey.get('2026-11-14').count, 1, 'positive control: 14 November holds one event');
  assert.equal(byKey.get('2026-11-03').count, 2, 'positive control: 3 November holds two');
  assert.equal(byKey.get('2026-11-20').count, 3, 'positive control: 20 November holds three');

  assert.equal(
    dayRadioLabel(byKey.get('2026-11-14')),
    '14 November 2026, 1 event',
    'one event is singular: "1 events" is the kind of thing that ships'
  );
  assert.equal(
    dayRadioLabel(byKey.get('2026-11-03')),
    '3 November 2026, 2 events',
    'the date is NOT zero-padded, because the reader sees the same date everywhere else unpadded'
  );
  assert.equal(dayRadioLabel(byKey.get('2026-11-20')), '20 November 2026, 3 events', 'three is plural');

  // The label must be exactly the date the cell shows plus the count, because it
  // is read out where the cell's own text is not. A label that disagreed with the
  // visible date would be a screen reader describing a different day.
  const day = byKey.get('2026-11-03');
  assert.ok(
    dayRadioLabel(day).startsWith(`${day.label}, `),
    `the label must lead with the day\'s own label "${day.label}", got "${dayRadioLabel(day)}"`
  );

  // A missing day must not throw. A cell renderer reaches this with whatever the
  // grid put there, and a build-time throw over an empty string is absurd.
  assert.equal(dayRadioLabel(null), '', 'a missing day yields an empty label rather than a throw');
  assert.equal(dayRadioLabel(undefined), '', 'an undefined day must not throw');
});

// ---------------------------------------------------------------------------
// The weekday vocabulary the components render from
// ---------------------------------------------------------------------------

test('the weekday lists are Sunday first, seven entries, and agree with the grid', () => {
  // Two hand-maintained lists drift, and a drift here mislabels every column.
  // They are exported from one module so the header row and the grid body cannot
  // disagree about which column is which.
  assert.equal(WEEKDAY_LABELS.length, 7, 'there are seven columns');
  assert.equal(WEEKDAY_FULL.length, 7, 'the full names must cover the same seven days');
  assert.deepEqual([...WEEKDAY_LABELS], ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], 'Sunday first, abbreviated');
  assert.equal(WEEKDAY_FULL[0], 'Sunday', 'the grid is Sunday first, so index 0 is Sunday');
  assert.equal(WEEKDAY_FULL[6], 'Saturday', 'and index 6 is Saturday');

  // And they must agree with the grid they head. 1 November 2026 is a Sunday, so
  // cell 0 is headed "Su" - which is only checkable because the grid and the
  // labels come from the same module and are compared here by a third party.
  const grid = gridFor('2026-11', [], 'weekday agreement');
  const firstCellIndex = indexOfDay(grid, 1);
  assert.equal(
    WEEKDAY_FULL[firstCellIndex],
    WEEKDAY_FULL[weekdayOfFirst('2026-11')],
    'the column the 1st lands in must be headed with the weekday the 1st actually is'
  );
});

// ---------------------------------------------------------------------------
// Authoring invariants on the file this suite covers
// ---------------------------------------------------------------------------

test('src/lib/calendar.ts is pure ASCII and imports its siblings with .ts', async () => {
  // ROADMAP design rule 9, enforced rather than trusted, for the same reason the
  // events suite enforces it: an em dash or a no-break space surviving into
  // authored source is the documented way this machine silently corrupts files,
  // and this is a file an assistant will rewrite.
  //
  // ASCII is checked against the code points themselves, not by eyeballing, and
  // the diagnostic prints the offset so a failure is actionable.
  const source = await readFile(CALENDAR_MODULE, 'utf8');

  const offenders = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) > 127) {
      const code = source.charCodeAt(i);
      offenders.push(`offset ${i} is U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
      break;
    }
  }
  assert.deepEqual(offenders, [], `non-ASCII characters in src/lib/calendar.ts:\n  ${offenders.join('\n  ')}`);

  // The `.ts` specifier is load-bearing and invisible: "tidying" it away breaks
  // `node --test` while `npm run build` keeps working, which is the worst
  // possible split because the fast check fails and the slow one does not.
  // Asserted on the SOURCE, because at runtime both forms behave identically on
  // this machine and only the source can be wrong.
  //
  // POSITIVE CONTROL on the check itself: the module does have relative imports,
  // so a regex that matched nothing would pass vacuously. The expected list is
  // named outright, which is the stronger form - a new sibling import makes this
  // go red, and the fix is to add its extension, not to widen the check.
  //
  // Two, and the zero-padding helpers live in src/lib/months.ts: `twoDigits` and
  // `monthKeyPart` are one implementation in the module that can be imported
  // without dragging a dataset along, so nothing here can disagree with
  // events-schema.ts about whether the value was 0-based or 1-based.
  const relativeImports = source.match(/from '(\.\/[^']+)'/g) ?? [];
  assert.deepEqual(
    relativeImports.map((line) => line.replace(/^from '/, '').replace(/'$/, '')),
    ['./events-schema.ts', './months.ts'],
    `positive control: this module's relative imports must be exactly the ones it has, with the extension, got ${JSON.stringify(relativeImports)}`
  );
  const bare = relativeImports.filter((line) => !/\.ts'$/.test(line));
  assert.deepEqual(
    bare,
    [],
    `these relative imports have no .ts extension, which bare Node's ESM resolver cannot load:\n  ${bare.join('\n  ')}`
  );
});
