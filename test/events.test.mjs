// test/events.test.mjs - the rules in data/events.schema, proven rather than
// asserted in a comment.
//
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS ACTUALLY FOR
// ---------------------------------------------------------------------------
//
// data/events.json is going to be filled in by an AI assistant from a written
// description. The failure mode that matters is not a crash - it is a row that
// renders perfectly while quietly being wrong: a misspelled key, a time written
// with a UTC offset so it prints five hours out, a type invented so it becomes a
// ninth chip. None of those throw. All of them are asserted here.
//
// So this suite is weighted towards the mistakes a language model actually makes
// when writing JSON to a spec, not towards tidy paths through the code. The
// `timestamp-has-offset` case is the clearest example: it is a rule that looks
// pedantic until you notice that accepting an offset and printing it through
// getUTCHours renders a correct instant as the wrong evening.
//
// Design rule 7 is not at risk: this suite reads the committed dataset and never
// writes to it, and the one place it needs a file on disk is the public/ image
// check, which only stats paths.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ALLOWED_EVENT_KEYS,
  EVENT_FIELDS,
  EVENT_TYPES,
  eventTypesPresent,
  formatEventDate,
  formatEventDateSpan,
  formatEventTime,
  formatEventZone,
  groupByMonth,
  isEventType,
  isPast,
  machineDateTime,
  monthKey,
  monthLabel,
  parseWallClock,
  sortEvents,
  validateEvents,
  wallClockToSortable
} from '../src/lib/events-schema.ts';
import { checkImages } from '../scripts/check-events.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const EVENTS_JSON = resolve(PROJECT_ROOT, 'data', 'events.json');
const EVENTS_PAGE = resolve(PROJECT_ROOT, 'src', 'pages', 'events.astro');
const MONTHS_MODULE = resolve(PROJECT_ROOT, 'src', 'lib', 'months.ts');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REAL_TEXT = await readFile(EVENTS_JSON, 'utf8');
const REAL_DOC = JSON.parse(REAL_TEXT);

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

/** A one-event document that is valid unless a test breaks it. */
function goodDoc(eventOverrides = {}, rootOverrides = {}) {
  return { reviewedOn: '2026-10-05', events: [goodEvent(eventOverrides)], ...rootOverrides };
}

/** Assert the fixture was accepted, then return the result. A positive control. */
function expectValid(doc, message) {
  const result = validateEvents(doc);
  assert.equal(result.ok, true, `${message}: fixture must be valid, got ${JSON.stringify(result.problems)}`);
  assert.equal(result.events.length, 1, `${message}: fixture must yield exactly one event`);
  return result;
}

/** Assert the fixture was rejected for one named reason, and return the result. */
function expectReason(doc, reason, message) {
  const result = validateEvents(doc);
  assert.equal(result.ok, false, `${message}: fixture must be REJECTED, but it validated clean`);
  const reasons = result.problems.map((p) => p.reason);
  assert.ok(
    reasons.includes(reason),
    `${message}: expected reason "${reason}", got ${JSON.stringify(result.problems)}`
  );
  return result;
}

/**
 * Strip every comment out of an Astro source file, leaving only live code.
 *
 * An Astro page is frontmatter JavaScript, JSX-shaped markup and a <style> block,
 * so there are two comment syntaxes to remove: a block comment (`*` slash paired),
 * which is also how the template writes a comment inside braces, and a `//` line
 * comment in the frontmatter.
 *
 * This exists because the rules below are about CODE. This file's comments
 * legitimately NAME `.row` and `<noscript>` and `:global(` when explaining why
 * those things are absent from it, so asserting on the raw text would be asserting
 * against the explanation of the rule rather than the rule.
 */
function stripAstroComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The page's <style> block, extracted and stripped of its block comments. */
function styleBlockOf(source) {
  const match = source.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(match, 'the page must have a <style> block; if it moved, update this test rather than deleting it');
  return stripAstroComments(match[1]);
}

// ---------------------------------------------------------------------------
// The positive control for the whole suite
// ---------------------------------------------------------------------------

test('the committed data/events.json is valid and is not empty', async (t) => {
  // POSITIVE CONTROL, and it comes first on purpose. Every negative test below
  // asserts that some malformed input is rejected; if the validator rejected
  // EVERYTHING, all of them would pass while the site rendered nothing. This is
  // the assertion that makes the rest of the file mean anything.
  const result = validateEvents(REAL_DOC);

  t.diagnostic(`events in the committed dataset: ${result.events.length}`);
  t.diagnostic(`problems: ${result.problems.length}`);

  assert.equal(
    result.ok,
    true,
    `the committed dataset must be valid, got:\n  ${result.problems.map((p) => `${p.reason}: ${p.detail}`).join('\n  ')}`
  );
  // The floor was 7 while the data was seven placeholder events, one per type. It
  // is 5 now because the real calendar has six events covering three types, and a
  // number lower than the data would make this control vacuous - which is the one
  // job it has. The exact count is asserted on the next line against the file
  // itself, so nothing here depends on this floor being right.
  assert.ok(
    result.events.length >= 5,
    `positive control: the validator must accept a dataset with real content, got ${result.events.length} events`
  );
  assert.equal(result.events.length, REAL_DOC.events.length, 'every event must survive validation');
  assert.equal(result.reviewedOn, '2026-10-05', 'reviewedOn must be read back from the file');

  // WHAT REPLACED "every type is exercised by the sample data", and why.
  //
  // That assertion was true of the placeholders and is now FALSE of the real
  // calendar, because real events cover three of the eight types and no amount of
  // editing will change that. It was also the wrong thing to assert: "the shipped
  // data happens to use every value in an array" is a fact about the sample, not a
  // property of the vocabulary, and it silently turned a data change into a test
  // failure.
  //
  // The invariant that actually matters, and survives real data, is ORDER:
  // `eventTypesPresent` must return the present types in EVENT_TYPES order, because
  // that array is what a filter row renders in. Full-vocabulary coverage now lives
  // in the fixtures further down this file, which is where a property about the
  // vocabulary belongs.
  const present = eventTypesPresent(result.events).map((row) => row.type);
  const expectedOrder = EVENT_TYPES.filter((type) => present.includes(type));
  t.diagnostic(`types present in the real data: ${present.join(', ')}`);

  assert.ok(present.length > 0, 'positive control: the real data must exercise at least one type');
  assert.deepEqual(
    present,
    [...expectedOrder],
    `eventTypesPresent must return types in EVENT_TYPES order, got ${JSON.stringify(present)}`
  );
  assert.deepEqual(
    present.filter((type) => !EVENT_TYPES.includes(type)),
    [],
    'the data must not contain a type outside EVENT_TYPES'
  );
});

test('every image the dataset references exists on disk', async () => {
  // The schema is pure and cannot stat a file, so this is the one property only
  // the repository can guarantee: that a path in the data resolves to a real
  // image. A path that 404s is a broken row on a page about dates, which is the
  // class of defect this project treats as unacceptable.
  const result = validateEvents(REAL_DOC);
  assert.equal(result.ok, true, 'positive control: the dataset must validate before its images are checked');

  const images = await checkImages(result.events);

  assert.ok(images.length > 0, 'positive control: the dataset must reference at least one image');
  const missing = images.filter((row) => !row.exists).map((row) => row.path);
  assert.deepEqual(missing, [], `referenced images that do not exist under public/: ${missing.join(', ')}`);
});

test('every DATE in the dataset has a selection rule in the page', async (t) => {
  // THE TEST THAT CATCHES THE EXPENSIVE MISTAKE, restated for the calendar.
  //
  // THE SELECTION UNIT IS A DAY, not an event. A calendar cell is a date and two
  // events can share one, so the radio group is over DISTINCT DATES and the page
  // carries three hand-written selector blocks per date:
  //
  //     html:has(#day-<key>:checked)   :global([data-panel='<key>'])   -> show the panel
  //     html:has(#day-<key>:checked)   :global([data-day='<key>'])     -> mark it selected
  //     html:has(#day-<key>:focus-visible) :global([data-day='<key>']) -> ring the focus
  //
  // CSS cannot relate a label to a control it merely names, so these cannot be
  // generated from the data. Adding a date WITHOUT adding its selectors produces a
  // page where the cell is clickable and nothing happens - the radio checks, the
  // panel stays hidden, and no error is raised anywhere. A green build, a
  // working-looking page, and a feature that silently does nothing.
  //
  // All THREE blocks are checked, not just the visibility one. A missing focus
  // rule is exactly the defect this page already shipped once.
  const page = await readFile(EVENTS_PAGE, 'utf8');
  const result = validateEvents(REAL_DOC);
  assert.ok(result.events.length > 0, 'positive control: the dataset must yield events to check');

  // Distinct dates, which is the real unit. Derived from the validated events
  // rather than hardcoded, so the test follows the data.
  const keys = [...new Set(result.events.map((event) => event.startsAt.slice(0, 10)))].sort();

  // The per-day selectors are no longer hand-written in events.astro: they are
  // GENERATED from the same `days` array into an `is:inline` block. So this test
  // asserts against the BUILT page, not the source, which is both stronger (it
  // sees what a browser receives) and correct about the new design.
  //
  // It is asserted on the built HTML rather than by running Astro, because the
  // build is a separate step; when dist is absent the test builds nothing and says
  // so rather than passing silently. See the skip note below.
  const builtPath = resolve(dirname(EVENTS_PAGE), '..', '..', 'dist', 'events', 'index.html');
  const built = await readFile(builtPath, 'utf8').catch(() => null);

  assert.ok(
    built !== null,
    `positive control: the built page must exist at ${builtPath}. Run \`npm run build\` before this suite; a source-only check cannot see generated CSS.`
  );

  // The inline block is unscoped, so the selectors appear WITHOUT `:global()`.
  // That difference is the whole reason this assertion had to move: the source
  // form is `html:has(#day-X:checked) [data-panel='X']` and the old string, with
  // its `:global(...)` wrapper, no longer exists anywhere.
  const missing = { panel: [], checked: [], focus: [] };
  for (const key of keys) {
    if (!built.includes(`#day-${key}:checked) [data-panel='${key}']`)) missing.panel.push(key);
    if (!built.includes(`#day-${key}:checked) [data-day='${key}']`)) missing.checked.push(key);
    if (!built.includes(`#day-${key}:focus-visible) [data-day='${key}']`)) missing.focus.push(key);
  }

  t.diagnostic(`checked ${keys.length} distinct date(s) against the BUILT page's generated selection CSS`);
  assert.ok(keys.length > 0, 'positive control: at least one date must be derived from the data');

  assert.deepEqual(
    missing.panel,
    [],
    `these dates have no "html:has(#day-<key>:checked) [data-panel='<key>']" rule in the built page, ` +
      `so selecting them can never show a panel: ${missing.panel.join(', ')}`
  );
  assert.deepEqual(
    missing.checked,
    [],
    `these dates are never marked as selected anywhere: ${missing.checked.join(', ')}`
  );
  assert.deepEqual(
    missing.focus,
    [],
    `these dates have no focus rule, so a keyboard user selecting them gets NO visible focus indicator: ${missing.focus.join(', ')}`
  );
});

test('the page derives its day radios from the data, one per distinct date', async (t) => {
  // The radio group is rendered ONCE in the page, from the distinct dates, and BOTH
  // views point at it with `label for`. If the count ever drifts from the data - a
  // date duplicated, or a date missing - the calendar and the list can silently
  // disagree, and there is no script to catch it.
  //
  // Asserted on the GENERATOR rather than one literal per date. The page renders the
  // group in a `.map()`, so its source contains a single id template, not one line
  // per date; asserting per-date literals here would be asserting the absence of the
  // very loop that makes this maintainable. The per-DATE coverage is proved
  // separately by the test above, which checks all three selector blocks.
  const page = await readFile(EVENTS_PAGE, 'utf8');
  const live = stripAstroComments(page);
  const result = validateEvents(REAL_DOC);
  assert.ok(result.events.length > 0, 'positive control: the dataset must yield events');

  const keys = [...new Set(result.events.map((event) => event.startsAt.slice(0, 10)))].sort();
  assert.ok(keys.length > 0, 'positive control: at least one date must be derived from the data');

  // The generated selectors live in the BUILT page, not the source.
  const builtPath = resolve(PROJECT_ROOT, 'dist', 'events', 'index.html');
  const built = await readFile(builtPath, 'utf8').catch(() => null);
  assert.ok(
    built !== null,
    `positive control: the built page must exist at ${builtPath}. Run \`npm run build\` before this suite.`
  );

  // The radios are generated from the day list, in one map, not hand-listed.
  assert.ok(
    live.includes('id={`day-${day.key}`}'),
    'the page must generate each day radio as id={`day-${day.key}`} from the day list'
  );
  assert.ok(
    live.includes('aria-controls={`panel-${day.key}`}'),
    'each day radio must point at its own panel with aria-controls={`panel-${day.key}`}'
  );

  // Exactly one checked, or the CSS would try to show two panels at once.
  assert.equal(
    (live.match(/checked=\{day\.key === selectedKey\}/g) || []).length,
    1,
    'the page must mark exactly one day as checked on first paint'
  );

  // And the generated selectors must be EXACTLY the set the data implies: one per
  // date in each of the two :checked blocks, one per date in the :focus-visible
  // block, and not one more. This catches a STALE date left behind after an event
  // is removed, which the missing-line check above cannot see - that one only
  // fails on absence.
  //
  // Counted in the BUILT page because that is where the selectors now live.
  const checkedCount = (built.match(/#day-\d{4}-\d{2}-\d{2}:checked\)/g) || []).length;
  const focusCount = (built.match(/#day-\d{4}-\d{2}-\d{2}:focus-visible\)/g) || []).length;

  t.diagnostic(`dates in data: ${keys.length}; :checked selectors: ${checkedCount}; :focus-visible selectors: ${focusCount}`);
  assert.equal(
    checkedCount,
    keys.length * 2,
    `the two :checked selector blocks must hold one selector per date (${keys.length} dates, so ${keys.length * 2}), got ${checkedCount}`
  );
  assert.equal(
    focusCount,
    keys.length,
    `the :focus-visible block must hold one selector per date (${keys.length}), got ${focusCount}`
  );

  // No selector may name a date the data does not contain. GENERATED CSS cannot go
  // stale this way, so this is now near-vacuous by construction - which is the
  // point of generating it. Kept anyway, as a cheap guard against someone
  // reintroducing a hand-written block with a frozen date in it.
  const stale = [...built.matchAll(/#day-(\d{4}-\d{2}-\d{2})[:)]/g)]
    .map((match) => match[1])
    .filter((key) => !keys.includes(key));
  assert.deepEqual(
    [...new Set(stale)],
    [],
    `these selectors name dates that are not in data/events.json, so they are dead CSS left behind by a removed event: ${[...new Set(stale)].join(', ')}`
  );
});

// ---------------------------------------------------------------------------
// The offset trap: the mistake an AI assistant is most likely to make
// ---------------------------------------------------------------------------

test('a timestamp carrying a UTC offset is REJECTED, not converted', () => {
  // The single most important rule in the schema, so it gets the most explicit
  // test. Accepting "2026-11-14T18:30:00-05:00" and rendering it through
  // getUTCHours would print 11:30 pm: a correct instant, the wrong event time,
  // and no error anywhere. Rejecting it costs the author one edit.
  for (const bad of ['2026-11-14T18:30:00-05:00', '2026-11-14T18:30:00Z', '2026-11-14T18:30Z', '2026-11-14T18:30+0530']) {
    const result = expectReason(goodDoc({ startsAt: bad }), 'timestamp-has-offset', `offset in ${bad}`);
    assert.match(
      result.problems.find((p) => p.reason === 'timestamp-has-offset').detail,
      /local/i,
      'the error must say the value is wrong, not merely that it is invalid'
    );
  }
});

test('a plain local wall clock is accepted, with no offset', () => {
  // The positive control for the rule above. Without it, a validator that
  // rejected EVERY timestamp would pass every test in the previous block.
  expectValid(goodDoc({ startsAt: '2026-11-14T18:30' }), 'plain local time');
  expectValid(goodDoc({ startsAt: '2026-11-14T18:30:00' }), 'local time with seconds');
});

test('a real date is required, not merely a well-shaped one', () => {
  // The regex accepts 30 February and hour 25. Shape is not validity.
  for (const bad of ['2026-02-30', '2026-13-01', '2026-11-14T25:00', '2026-11-14T18:99', '2026-00-10']) {
    expectReason(goodDoc({ startsAt: bad }), 'bad-timestamp-format', `impossible date ${bad}`);
  }
  // And 29 February in a leap year is real, so it must be accepted - otherwise
  // the rule above is "reject anything interesting" rather than "reject nonsense".
  expectValid(goodDoc({ startsAt: '2024-02-29T09:00' }), 'leap day');
  expectReason(goodDoc({ startsAt: '2026-02-29T09:00' }), 'bad-timestamp-format', '29 Feb in a common year');
});

test('parseWallClock round-trips the components and rejects the impossible', () => {
  const parsed = parseWallClock('2026-11-14T18:30');
  assert.deepEqual(
    parsed,
    { year: 2026, month: 11, day: 14, hour: 18, minute: 30, allDay: false },
    'a valid wall clock must return its own components unchanged'
  );
  assert.equal(parseWallClock('2026-11-14').allDay, true, 'a bare date is an all-day value');
  assert.equal(parseWallClock('2026-02-30'), null, '30 February is not a date');
  assert.equal(parseWallClock('14 November 2026'), null, 'a prose date is not a wall clock');
});

// ---------------------------------------------------------------------------
// Type vocabulary
// ---------------------------------------------------------------------------

test('an unknown type is rejected and the error names the allowed list', () => {
  // A closed vocabulary is only worth anything if the failure is loud AND tells
  // the author what the options are. An AI assistant inventing "Keynote Address"
  // must not be able to do it quietly.
  const result = expectReason(goodDoc({ type: 'Keynote Address' }), 'bad-type', 'invented type');
  const detail = result.problems.find((p) => p.reason === 'bad-type').detail;
  for (const type of EVENT_TYPES) {
    assert.ok(detail.includes(type), `the error must list "${type}" so the author can pick one, got: ${detail}`);
  }
  // Case matters too: "forum" is not "Forum", because a lowercase type would
  // become its own chip and silently halve a filter.
  expectReason(goodDoc({ type: 'forum' }), 'bad-type', 'lowercase type');
});

test('every type in EVENT_TYPES validates, and none is a duplicate', () => {
  for (const type of EVENT_TYPES) {
    expectValid(goodDoc({ type }), `type ${type}`);
    assert.ok(isEventType(type), `${type} must be recognised by isEventType`);
  }
  assert.equal(new Set(EVENT_TYPES).size, EVENT_TYPES.length, 'EVENT_TYPES contains a duplicate, which would make two chips identical');
  assert.equal(isEventType('nope'), false, 'isEventType must reject a value that is not in the list');
  assert.equal(isEventType(null), false, 'isEventType must reject null rather than throwing');
});

// ---------------------------------------------------------------------------
// Required fields, and the one that is conditional
// ---------------------------------------------------------------------------

test('every required field is genuinely required', () => {
  for (const field of EVENT_FIELDS.filter((f) => f.required)) {
    const doc = goodDoc();
    delete doc.events[0][field.key];
    const result = validateEvents(doc);
    assert.equal(
      result.ok,
      false,
      `deleting the required field "${field.key}" must be rejected, but the file validated clean`
    );
    assert.ok(
      result.problems.some((p) => p.reason === 'missing-field'),
      `deleting "${field.key}" should report missing-field, got ${JSON.stringify(result.problems)}`
    );
  }
});

test('a timed event with no timezone is rejected, and an all-day one without is fine', () => {
  // A clock time with no stated zone is a missing answer wearing a row's clothes.
  expectReason(goodDoc({ timezone: null }), 'missing-field', 'timed event with no zone');

  const allDay = goodDoc({ allDay: true, startsAt: '2026-11-03', endsAt: null, timezone: null });
  const result = expectValid(allDay, 'all-day event with no zone');
  assert.equal(result.events[0].allDay, true, 'allDay must survive validation');
  assert.equal(result.events[0].timezone, null, 'an absent zone must stay null, not become an empty string');
});

test('allDay and the shape of startsAt must agree', () => {
  expectReason(goodDoc({ allDay: true, startsAt: '2026-11-14T18:30' }), 'bad-timestamp-format', 'allDay with a clock time');
  expectReason(goodDoc({ allDay: false, startsAt: '2026-11-03', endsAt: null }), 'bad-timestamp-format', 'timed event with a bare date');
  expectReason(goodDoc({ allDay: 'yes' }), 'not-a-boolean', 'allDay as a string');
});

test('an end before the start is rejected', () => {
  expectReason(goodDoc({ endsAt: '2026-11-14T17:00' }), 'ends-before-starts', 'end before start');
  // Equal is not before: a zero-length event is odd but it is not incoherent.
  expectValid(goodDoc({ endsAt: '2026-11-14T18:30' }), 'end equal to start');
});

test('the end-before-start rule applies to an all-day event, not only a timed one', () => {
  // THE BUG THIS TEST EXISTS FOR. The comparison used to build an ISO string and
  // call Date.parse. For a TIMED value that works. For a DATE-ONLY value it does
  // not: "2026-11-03" became "2026-11-03:00Z", Date.parse returned NaN for it, and
  // `NaN < NaN` is FALSE. So the rule was INERT for every all-day event - the entire
  // election-day shape of row, the one a transcription is most likely to get
  // backwards, had no end-before-start check at all. The build stayed green and the
  // row rendered an end date before its start date.
  //
  // The existing test above cannot see this: it only ever built a timed fixture.
  //
  // POSITIVE CONTROL FIRST, on the same shape, because a rule that rejected ALL
  // all-day events with an end would pass the negative assertion below while
  // forbidding a legitimate one-day event.
  const control = expectValid(
    goodDoc({ allDay: true, startsAt: '2026-11-03', endsAt: null, timezone: null }),
    'all-day event with no end at all'
  );
  assert.equal(control.events[0].allDay, true, 'positive control: the fixture is genuinely all-day');

  const result = expectReason(
    goodDoc({ allDay: true, startsAt: '2026-11-03', endsAt: '2026-10-01', timezone: null }),
    'ends-before-starts',
    'all-day event whose end precedes its start'
  );
  assert.match(
    result.problems.find((p) => p.reason === 'ends-before-starts').detail,
    /2026-10-01/,
    'the error must name the end value actually written, or the author cannot see which row is wrong'
  );

  // And the timed case is re-asserted here so this test fails loudly if someone
  // narrows the rule to all-day values only, which would be the opposite of a fix.
  expectReason(
    goodDoc({ startsAt: '2026-11-14T18:30', endsAt: '2026-11-14T17:00' }),
    'ends-before-starts',
    'timed event whose end precedes its start'
  );

  // EQUAL is accepted for an all-day pair. A same-day range is the one real way a
  // transcription writes "that day" twice, and rejecting it would push an author
  // to invent a fake midnight-to-midnight range that then renders as a clock time.
  expectValid(
    goodDoc({ allDay: true, startsAt: '2026-11-03', endsAt: '2026-11-03', timezone: null }),
    'all-day event whose end is the same day as its start'
  );

  // A later all-day end is accepted too, so the rule is a real ordering check and
  // not "any second all-day value is a problem".
  expectValid(
    goodDoc({ allDay: true, startsAt: '2026-11-03', endsAt: '2026-11-05', timezone: null }),
    'all-day event spanning three days'
  );
});

test('a sortable value is always the same width, whatever the timestamp shape', () => {
  // THE BUG THIS TEST EXISTS FOR. wallClockToSortable used to strip the colons off
  // the time part and append whatever was left, so "18:30" contributed 4 digits and
  // "18:30:00" contributed 6. Those are not comparable integers:
  //
  //     20261114183000 > 202611142000
  //
  // because 14 digits outranks 12. So an event running 18:30:00 to 20:00 was
  // reported as ENDING BEFORE IT STARTED - the validator rejecting correct data,
  // which is the most expensive kind of false positive this suite can produce.
  //
  // It stayed hidden until the end-before-start rule was rewritten to call this
  // function, which is the ordinary way a latent bug gets found: by giving it a
  // second caller.
  //
  // Asserted DIRECTLY on the function, not only through the validator, because the
  // validator path would still pass if the widths were wrong in a combination this
  // file happens not to generate.
  const withSeconds = wallClockToSortable('2026-11-14T18:30:00');
  const withoutSeconds = wallClockToSortable('2026-11-14T20:00');

  assert.equal(
    withSeconds,
    20261114183000,
    'a timestamp with a seconds part must sort as YYYYMMDDHHMMSS, zero-padded'
  );
  assert.equal(
    withoutSeconds,
    20261114200000,
    'a timestamp without a seconds part must sort as the SAME width, padded with zeros'
  );
  assert.ok(
    withSeconds < withoutSeconds,
    `18:30:00 must sort before 20:00 on the same day, got ${withSeconds} and ${withoutSeconds}`
  );

  // And the validator consequence, which is the part a reader would actually file
  // a bug about. POSITIVE CONTROL: the same event with a minute-width start and end
  // has always validated, so this is not a rule that was never enforced at all.
  expectValid(
    goodDoc({ startsAt: '2026-11-14T18:30', endsAt: '2026-11-14T20:00' }),
    'minute-width start and end'
  );
  expectValid(
    goodDoc({ startsAt: '2026-11-14T18:30:00', endsAt: '2026-11-14T20:00' }),
    'seconds-width start, minute-width end'
  );
  expectValid(
    goodDoc({ startsAt: '2026-11-14T18:30:00', endsAt: '2026-11-14T20:00:00' }),
    'seconds-width start and end'
  );
  expectReason(
    goodDoc({ startsAt: '2026-11-14T20:00:00', endsAt: '2026-11-14T18:30' }),
    'ends-before-starts',
    'seconds-width end genuinely before a minute-width start'
  );
});

// ---------------------------------------------------------------------------
// Typos: the reason the unknown-key rule exists
// ---------------------------------------------------------------------------

test('an unknown key is rejected and a near-miss is suggested', () => {
  // THE CASE THIS PROJECT ACTUALLY FEARS. `loction` is not a field, so the venue
  // silently does not render, the build is green, and the calendar shows a row
  // with a missing location. Rejecting the key turns a silent lie into a red build.
  const doc = goodDoc();
  doc.events[0].loction = 'Somewhere';
  const result = expectReason(doc, 'unknown-key', 'misspelled key');
  assert.match(
    result.problems.find((p) => p.reason === 'unknown-key').detail,
    /Did you mean "location"\?/,
    `a near-miss must be suggested, got: ${JSON.stringify(result.problems)}`
  );

  // A key that is nothing like a real one still fails, just without a suggestion.
  const odd = goodDoc();
  odd.events[0].zzzz = 1;
  expectReason(odd, 'unknown-key', 'key resembling nothing');
});

test('an unknown key at the top level is rejected too', () => {
  // A misspelled `reviewedOn` would otherwise be ignored, and the page would
  // silently stop splitting past from upcoming.
  const result = expectReason(goodDoc({}, { reviewedAon: '2026-10-05' }), 'unknown-key', 'misspelled root key');
  assert.match(result.problems[0].detail, /reviewedOn/, 'the error must suggest reviewedOn');
});

test('a root key one edit from reviewedOn is suggested, and one resembling an event field is not', () => {
  // THE BUG THIS TEST EXISTS FOR. suggestKey takes the list of legal keys as a
  // parameter, and the root-level caller used to pass the EVENT field list. At the
  // top level that is simply the wrong vocabulary, and it failed in both directions
  // at once:
  //
  //   - "reviewedAon" got NO suggestion, despite being one deleted character from
  //     "reviewedOn", because the comparator was searching a list that did not
  //     contain the answer. The author is told the key is illegal and nothing else.
  //   - "event" - a perfectly good EVENT field, and not a legal ROOT key - was
  //     suggested back to ITSELF: `Did you mean "event"?` A suggestion that names
  //     the key that was just rejected is worse than no suggestion, because it looks
  //     like an answer.
  //
  // The existing test above asserts only /reviewedOn/, which matches the error
  // sentence's own boilerplate - the string "the top level accepts only \"events\"
  // and \"reviewedOn\"" contains it. So that test passes whether or not a suggestion
  // was produced. This one asserts the WHOLE PHRASE, so it cannot pass on boilerplate.
  const result = expectReason(goodDoc({}, { reviewedAon: '2026-10-05' }), 'unknown-key', 'misspelled root key');
  assert.match(
    result.problems.find((p) => p.reason === 'unknown-key').detail,
    /Did you mean "reviewedOn"\?/,
    `a one-edit root typo must be suggested with the full phrase, got: ${JSON.stringify(result.problems.map((p) => p.detail))}`
  );

  // A root key that resembles an EVENT field gets NO suggestion, because the root
  // vocabulary is `events` and `reviewedOn` and nothing else. "note" is one edit
  // from "notes", which is a field - suggesting it would send the author to the
  // wrong level entirely.
  const notAField = expectReason(goodDoc({}, { note: 'x' }), 'unknown-key', 'root key resembling an event field');
  const detail = notAField.problems.find((p) => p.reason === 'unknown-key').detail;
  assert.equal(
    /Did you mean/.test(detail),
    false,
    `"note" is not a legal ROOT key and must not be suggested anything, got: ${detail}`
  );
  // The legal-root-key list is now GENERATED from ROOT_KEYS rather than typed into
  // the message, so it cannot fall out of step when a key is added - which is how
  // this assertion was worded before "pageNote" existed and it started failing on a
  // correct message. Asserting each legal key appears is the durable form.
  for (const legal of ['events', 'reviewedOn', 'pageNote']) {
    assert.ok(
      detail.includes(`"${legal}"`),
      `the error must state that "${legal}" is a legal root key, got: ${detail}`
    );
  }

  // And the other direction, named explicitly: "event" must be sent to "events",
  // which is legal, and must never be suggested back to itself.
  const collidesWithField = expectReason(goodDoc({}, { event: 'x' }), 'unknown-key', 'root key that is also an event field');
  const collideDetail = collidesWithField.problems.find((p) => p.reason === 'unknown-key').detail;
  assert.equal(
    collideDetail.includes('Did you mean "event"?'),
    false,
    `the validator suggested the rejected key back to itself, which is not a suggestion, got: ${collideDetail}`
  );

  // POSITIVE CONTROL on the instrument itself: the two legal root keys must produce
  // NO unknown-key problem at all, or every assertion above would be passing because
  // every root key is rejected, and the suggestion machinery never ran.
  const clean = expectValid(goodDoc(), 'a document with no stray root key');
  assert.equal(
    clean.problems.length,
    0,
    `positive control: an untouched document must produce no problems, got ${JSON.stringify(clean.problems)}`
  );
});

test('ALLOWED_EVENT_KEYS and the field table cannot disagree', () => {
  assert.deepEqual(
    [...ALLOWED_EVENT_KEYS].sort(),
    EVENT_FIELDS.map((f) => f.key).sort(),
    'the exported key list is derived from EVENT_FIELDS and must match it exactly'
  );
});

// ---------------------------------------------------------------------------
// Shape of the verdict
// ---------------------------------------------------------------------------

test('every problem is reported in one pass, and a partial list is never returned', () => {
  // The deliberate departure from scripts/lib/validate.mjs, which short-circuits
  // on the first problem. Somebody fixing a 40-row hand-written file wants all of
  // them at once. Tested here because a "helpful" refactor back to short-circuiting
  // would be invisible on the happy path and would only bite during an edit.
  const doc = {
    reviewedOn: '2026-10-05',
    events: [
      goodEvent({ id: 'first-bad', type: 'Keynote' }),
      goodEvent({ id: 'second-bad', startsAt: '2026-11-14T18:30:00Z' }),
      goodEvent({ id: 'third-bad', loction: 'x' })
    ]
  };
  const result = validateEvents(doc);

  assert.equal(result.ok, false, 'the document must be rejected');
  assert.equal(result.problems.length, 3, `expected 3 problems reported together, got ${result.problems.length}`);
  assert.deepEqual(
    result.events,
    [],
    'a rejected document must return NO events, never the subset that happened to be clean'
  );

  // And the path locator must point at the offending row, or it is not actionable.
  assert.ok(
    result.problems.some((p) => p.path.includes('events[0]')),
    `problems must carry an events[n] path, got ${JSON.stringify(result.problems.map((p) => p.path))}`
  );
});

test('a document that is not a usable file is rejected with a reason, not a crash', () => {
  for (const bad of [null, undefined, 42, 'a string', [], true]) {
    const result = validateEvents(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} must be rejected`);
    assert.equal(result.problems[0].reason, 'root-not-object', `${JSON.stringify(bad)} must report root-not-object`);
  }
  assert.equal(validateEvents({}).problems[0].reason, 'events-missing', 'an object with no events must say so');
  assert.equal(validateEvents({ events: {} }).problems[0].reason, 'events-not-array', 'events must be an array');
  assert.equal(
    validateEvents({ events: [] }).problems[0].reason,
    'events-empty',
    'an empty array is rejected, because an events page with no events renders a lie'
  );
});

test('the validator never throws on hostile input', () => {
  // Every one of these is something a JSON file can legitimately contain.
  const hostile = [
    { events: [null] },
    { events: [[]] },
    { events: ['a string'] },
    { events: [goodEvent({ name: 123 })] },
    { events: [goodEvent({ name: null })] },
    { events: [goodEvent({ name: '' })] },
    { events: [goodEvent({ location: 'x'.repeat(500) })] },
    { events: [goodEvent({ thumbnail: 'https://example.com/x.png' })] },
    { events: [goodEvent({ thumbnail: '/img/../secret' })] },
    { events: [goodEvent({ url: 'javascript:alert(1)' })] },
    { events: [goodEvent({ url: 'not a url' })] },
    { events: [goodEvent({ id: 'Not Kebab-Case' })] },
    { events: [goodEvent({ id: 'UPPER' })] },
    { reviewedOn: '2026-02-30', events: [goodEvent()] }
  ];

  for (const doc of hostile) {
    let result;
    assert.doesNotThrow(() => {
      result = validateEvents(doc);
    }, `validator threw on ${JSON.stringify(doc).slice(0, 90)}`);
    assert.equal(
      result.ok,
      false,
      `this document should be REJECTED, not accepted: ${JSON.stringify(doc).slice(0, 120)}`
    );
  }
});

test('maxLength is enforced for id, thumbnail and url, and only those string kinds', () => {
  // THE BUG THIS TEST EXISTS FOR. The length check lived inside the text/longtext
  // branch, so it covered 4 of 13 field kinds. `id`, `thumbnail`, `banner` and
  // `url` were UNBOUNDED, and the visible symptom is a whole paragraph of prose
  // pasted into a link field validating clean - the single most likely accident
  // when an AI assistant fills in 40 rows from a written description, and one that
  // renders as a page about dates that looks finished.
  //
  // The check is now in one place, keyed on the field KIND, so a new kind cannot
  // forget it.
  const control = expectValid(
    goodDoc({
      id: 'riverside-water-forum',
      thumbnail: '/img/events/riverside-water-forum-thumb.svg',
      url: 'https://example.org/events/riverside-water-forum'
    }),
    'a legal-length id, thumbnail and url'
  );
  assert.equal(control.events[0].id, 'riverside-water-forum', 'positive control: the fixture is the one under test');

  const longUrl = 'https://example.org/' + 'x'.repeat(600);
  const longThumb = '/img/events/' + 'x'.repeat(300) + '.svg';
  const longBanner = '/img/events/' + 'x'.repeat(300) + '-banner.svg';

  const urlResult = expectReason(goodDoc({ url: longUrl }), 'too-long', 'a 4000-character URL');
  assert.match(
    urlResult.problems.find((p) => p.reason === 'too-long').detail,
    /over the 500 limit for url/,
    'the error must name the field and the limit, so the author knows what to cut'
  );

  expectReason(goodDoc({ thumbnail: longThumb }), 'too-long', 'an over-long thumbnail');
  expectReason(goodDoc({ banner: longBanner }), 'too-long', 'an over-long banner');
  expectReason(goodDoc({ id: 'x'.repeat(80) }), 'too-long', 'an over-long id');

  // And the length check must run BEFORE the per-kind format check, or an
  // over-long url reports "not an absolute http URL" and sends the author looking
  // for a scheme problem they do not have. Exactly one problem, about the url.
  const urlProblems = validateEvents(goodDoc({ url: longUrl })).problems;
  assert.deepEqual(
    urlProblems.map((p) => p.reason),
    ['too-long'],
    `an over-long url must report only too-long, got ${JSON.stringify(urlProblems)}`
  );
  assert.match(
    urlProblems[0].detail,
    /\.url is/,
    'the problem must be located on the url field, so the author knows which value to shorten'
  );

  // TIMESTAMPS ARE DELIBERATELY EXEMPT, and this assertion exists to stop a future
  // reader "fixing" that. A legal HH:MM:SS timestamp is 19 characters against a
  // declared limit of 16, and it is CORRECT DATA that the file accepts by design.
  //
  // Why exempt rather than raising the limit to 19: applying the length check to
  // timestamps masked the far more valuable diagnostic. "2026-11-14T18:30:00-05:00"
  // is 25 characters, so it failed the length check first and was reported as "too
  // long" - sending the author to shorten a value whose actual problem is that it
  // carries a UTC offset, which is the mistake this project most fears. A field
  // whose format is fully determined by a regular expression does not need a
  // length limit as well: the format check is the stricter one and gives the
  // better message. Keep it that way.
  assert.equal(
    '2026-11-14T18:30:00'.length,
    19,
    'positive control: this fixture must be the longest legal timestamp, or the exemption proves nothing'
  );
  expectValid(
    goodDoc({ startsAt: '2026-11-14T18:30:00', endsAt: '2026-11-14T20:00:00' }),
    'a 19-character legal timestamp, correctly accepted'
  );
  // The declared number must be the TRUE longest legal value, not a smaller one
  // that the exemption then renders unenforceable.
  //
  // It read 16 while "2026-11-14T18:30:00" was accepted, and this table is what
  // data/events.schema.md states as the field's maximum. That is a number smaller
  // than a valid value, published to exactly the reader least able to check it -
  // an AI assistant told "max 16" would truncate a legal timestamp or reject it
  // out of caution. Corrected to 19; the exemption itself is unchanged, because
  // raising the limit and enforcing it is what masked `timestamp-has-offset`.
  assert.equal(
    EVENT_FIELDS.find((f) => f.key === 'startsAt').maxLength,
    19,
    'the declared maximum for a timestamp must equal the longest legal value, so the documentation is not a lie'
  );
  assert.equal(
    EVENT_FIELDS.find((f) => f.key === 'endsAt').maxLength,
    19,
    'endsAt must declare the same true maximum as startsAt'
  );
  // ...and the exemption must not have cost the offset rule its teeth.
  expectReason(
    goodDoc({ startsAt: '2026-11-14T18:30:00-05:00' }),
    'timestamp-has-offset',
    'an over-length timestamp with an offset must still report the offset, not "too long"'
  );
});

test('an event id may not begin with input-, because it would steal another row\'s radio id', () => {
  // THE BUG THIS TEST EXISTS FOR. The page derives THREE ids from one event id:
  // the radio is `event-input-<id>`, the panel is `event-<id>`, and the selection
  // selector keys off both. An event whose id is `input-x` therefore produces the
  // PANEL id `event-input-x` - which is exactly the RADIO id of an event called
  // `x`. Two elements, one DOM id, and an aria-controls pointing at the wrong thing.
  //
  // The duplicate-id check cannot catch this, and that is the point worth recording:
  // it only ever compares an id against other IDS. Two ids in the file - `input-x`
  // and `x` - are different strings, so the collision exists only after the page
  // prefixes them. A check at the data layer cannot see a defect the data layer
  // does not contain, so the invariant is enforced where the ids are built.
  //
  // POSITIVE CONTROL FIRST: a plain id must still validate, or this test would pass
  // on a rule that rejects every id.
  const control = expectValid(goodDoc({ id: 'x' }), 'a plain single-segment id');
  assert.equal(control.events[0].id, 'x', 'positive control: the plain id is the fixture the negative case varies');

  const result = expectReason(goodDoc({ id: 'input-x' }), 'reserved-id-prefix', 'an id beginning with input-');
  assert.match(
    result.problems.find((p) => p.reason === 'reserved-id-prefix').detail,
    /event-input-<id>/,
    'the error must explain WHY the prefix is reserved, or the author will rename the event to satisfy a rule they cannot see the reason for'
  );

  // The rule is a PREFIX, not a substring. `water-input-x` contains "input-" and
  // starts with it in no position that matters, so it must be allowed.
  expectValid(goodDoc({ id: 'water-input-x' }), 'input- appearing inside an id, not at the front');

  // And the second boundary: the reserved string is "input-" WITH its hyphen, so
  // an id that merely begins with those letters is not affected. The colliding DOM
  // id is produced by an id that literally starts `input-`; nothing else can produce
  // it, because a panel id is always `event-` + the id.
  expectValid(goodDoc({ id: 'inputs-and-outputs-town-hall' }), 'an id starting with "inputs", not "input-"');
});

test('a path traversal or a remote URL cannot be smuggled in as an image', () => {
  // The CLI joins an accepted path onto public/ and stats it. IMAGE_PATH_RE is the
  // only thing standing between a hand-edited data file and the filesystem, so it
  // is worth asserting that it actually rejects what it is there to reject.
  const escapes = ['/img/../secrets.svg', '/etc/passwd', '/img/../../x', 'img/events/a.svg', '/assets/a.svg', 'https://cdn.example.com/a.png'];
  for (const path of escapes) {
    const result = validateEvents(goodDoc({ thumbnail: path }));
    assert.equal(result.ok, false, `image path "${path}" must be rejected`);
    assert.ok(
      result.problems.some((p) => p.reason === 'bad-image-path'),
      `"${path}" should report bad-image-path, got ${JSON.stringify(result.problems.map((p) => p.reason))}`
    );
  }
});

// ---------------------------------------------------------------------------
// Ordering, grouping, splitting
// ---------------------------------------------------------------------------

test('events sort ASCENDING by date, with a stable tiebreak', () => {
  const result = expectValid(goodDoc(), 'fixture for sorting');
  assert.equal(result.events.length, 1, 'positive control: one event');

  const input = [
    goodEvent({ id: 'c-later', startsAt: '2026-12-02T19:00' }),
    goodEvent({ id: 'a-earlier', startsAt: '2026-09-24T19:00' }),
    goodEvent({ id: 'b-tie', startsAt: '2026-11-14T18:30' }),
    goodEvent({ id: 'd-tie', startsAt: '2026-11-14T18:30' })
  ];
  const sorted = sortEvents(input).map((e) => e.id);

  // Ascending, unlike the article feed: a calendar reads forward in time, and
  // "newest first" would put the furthest-future event at the top.
  assert.deepEqual(sorted, ['a-earlier', 'b-tie', 'd-tie', 'c-later'], 'events must sort ascending with an id tiebreak');
  assert.equal(sorted.indexOf('b-tie') < sorted.indexOf('d-tie'), true, 'equal timestamps must break the tie on id, reproducibly');
  assert.deepEqual(sortEvents([...input].reverse()).map((e) => e.id), sorted, 'input order must not affect the output');
});

test('a same-day all-day event sorts before a timed one that morning', () => {
  assert.ok(
    wallClockToSortable('2026-11-14') < wallClockToSortable('2026-11-14T09:00'),
    'a bare date must sort before a clock time on the same day'
  );
  assert.ok(
    wallClockToSortable('2026-11-13T23:59') < wallClockToSortable('2026-11-14'),
    'and yesterday must sort before today'
  );
});

test('a comparator can never return NaN, whatever the timestamp looks like', (t) => {
  // THE NaN THIS EXISTS TO KILL. wallClockToSortable splits on 'T' and on ':' and
  // hands the pieces to Number(). An offset-bearing wall clock splits into a third
  // time field of `00-05`, so the whole string is refused and the function returned
  // NaN:
  //
  //     wallClockToSortable('2026-11-14T18:30:00-05:00')  //  NaN, before
  //
  // That is not "sorts badly". sortEvents is EXPORTED from src/lib/events.ts and
  // feeds the value straight into a comparator as `a - b`, and a NaN comparator
  // result is UNSPECIFIED: the engine keeps whatever order it had. The built HTML
  // then depends on the sort implementation and the input order rather than on the
  // data, which is ROADMAP design rule 8 broken in the one place the page would
  // look correct while being wrong.
  //
  // Upstream validation rejects offsets, so this is not reachable from
  // data/events.json today. That is not a guard: this function and sortEvents are
  // public API, and "the input cannot currently happen" is how the next caller
  // finds out the hard way.
  const hostile = [
    '2026-11-14T18:30:00-05:00',
    '2026-11-14T18:30:00+0530',
    '2026-11-14T18:30:00Z',
    '2026-11-14',
    '2026-11-14T18:30',
    '2026-11-14T18:30:00',
    '',
    'nonsense',
    '2026-13-45T99:99',
    '2026-11-14T',
    '2026-11-14T18:'
  ];

  for (const value of hostile) {
    const sortable = wallClockToSortable(value);
    assert.ok(
      Number.isFinite(sortable),
      `wallClockToSortable(${JSON.stringify(value)}) returned ${sortable}; a comparator must never produce NaN`
    );
    // POSITIVE CONTROL on the control: a real timestamp must still sort as it
    // always did, so "always returns 0" cannot pass this.
    assert.equal(wallClockToSortable('2026-11-14T18:30:00'), 20261114183000, 'a real wall clock is unchanged');
    assert.equal(wallClockToSortable('2026-11-14T20:00'), 20261114200000, 'and a minute-width one too');
  }
  t.diagnostic(`checked ${hostile.length} timestamp shapes; none produced a non-finite sort key`);

  // And the comparator itself, which is where a NaN would actually do damage.
  // Deliberately NOT going through expectValid: these events are invalid on
  // purpose, and sortEvents is exported public API that must survive being called
  // with them.
  const mixed = [
    goodEvent({ id: 'z-offset', startsAt: '2026-11-14T18:30:00-05:00' }),
    goodEvent({ id: 'y-plain', startsAt: '2026-11-14T18:30' }),
    goodEvent({ id: 'x-early', startsAt: '2026-09-01T09:00' })
  ];

  let sorted;
  assert.doesNotThrow(
    () => {
      sorted = sortEvents(mixed);
    },
    'sortEvents must not throw on an offset-bearing startsAt'
  );

  assert.ok(Array.isArray(sorted), 'sortEvents must return an array');
  assert.equal(sorted.length, 3, 'positive control: every event survives the sort - nothing is dropped');

  // Reproducible, and independent of the input order. With a NaN in the
  // comparator this is the property that fails, and it fails SILENTLY: the array
  // is still three events long and still looks like a list.
  assert.deepEqual(
    sortEvents([...mixed].reverse()).map((e) => e.id),
    sorted.map((e) => e.id),
    'the sort order must not depend on the input order'
  );
  assert.deepEqual(
    sortEvents(mixed).map((e) => e.id),
    sorted.map((e) => e.id),
    'sorting the same input twice must give the same order'
  );

  // And the guard did not turn into "everything is equal". The two REAL events keep
  // their own chronological order, and the unusable one lands where the documented
  // 0 puts it: before every real date, because 0 is smaller than any YYYYMMDDHHMMSS.
  //
  // Which end it lands on is arbitrary and the doc says so. What is not arbitrary
  // is that it lands on the SAME end every time, on every engine - which is the
  // property the NaN was destroying.
  assert.deepEqual(
    sorted.slice(0, 2).map((e) => e.id),
    ['z-offset', 'x-early'],
    'an unusable value sorts as 0, i.e. before every real date, and the two real events keep their own order'
  );
  assert.equal(sorted[2].id, 'y-plain', 'the later real event must still sort after the earlier one');
  assert.equal(
    wallClockToSortable('2026-11-14T18:30:00-05:00'),
    0,
    'the guard is documented as 0, so the offset-bearing value must sort first rather than being dropped'
  );
});

test('groupByMonth derives its headings from the data', () => {
  const groups = groupByMonth([
    goodEvent({ id: 'dec', startsAt: '2026-12-02T19:00' }),
    goodEvent({ id: 'nov-b', startsAt: '2026-11-21T14:00' }),
    goodEvent({ id: 'nov-a', startsAt: '2026-11-07T12:00' })
  ]);

  assert.deepEqual(
    groups.map((g) => g.key),
    ['2026-11', '2026-12'],
    'months must be derived and sorted ascending, with no hardcoded list'
  );
  assert.deepEqual(groups.map((g) => g.label), ['November 2026', 'December 2026'], 'labels come from the month table');
  assert.deepEqual(groups[0].events.map((e) => e.id), ['nov-a', 'nov-b'], 'events within a month are ascending');
  assert.equal(monthKey('2026-11-07T12:00'), '2026-11', 'monthKey must key on the month only');
  assert.equal(monthLabel('2026-01'), 'January 2026', 'monthLabel must render a YYYY-MM key');
});

test('the past/upcoming split is decided by reviewedOn, never by the clock', () => {
  // The whole point: a build that renders "today" differently depending on the
  // day it ran is design rule 8 broken in the most literal way available.
  // isPast therefore takes the date from the data.
  const pastEvent = goodEvent({ id: 'past-one', startsAt: '2026-09-24T19:00' });
  const futureEvent = goodEvent({ id: 'future-one', startsAt: '2026-11-14T18:30' });
  const todayEvent = goodEvent({ id: 'today-one', startsAt: '2026-10-05T09:00' });

  assert.equal(isPast(pastEvent, '2026-10-05'), true, 'an event before the review date is past');
  assert.equal(isPast(futureEvent, '2026-10-05'), false, 'an event after the review date is upcoming');
  assert.equal(
    isPast(todayEvent, '2026-10-05'),
    false,
    'an event ON the review date is upcoming, because today has not finished'
  );
  assert.equal(isPast(futureEvent, null), false, 'with no reviewedOn there is no line to draw, so nothing is past');
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

test('dates and times render in the venue local time, with no machine dependence', () => {
  assert.equal(formatEventDate('2026-11-14T18:30'), '14 November 2026', 'date rendering');
  assert.equal(formatEventDate('2026-01-05T09:00'), '5 January 2026', 'a single-digit day must not be zero-padded');
  assert.equal(formatEventDate('2026-12-31'), '31 December 2026', 'an all-day date renders the same way');
  assert.equal(formatEventDate('nonsense'), '', 'an unparseable value degrades to empty, never to "Invalid Date"');

  assert.equal(formatEventTime('2026-11-14T18:30', null), '6:30 pm', 'no end time');
  assert.equal(formatEventTime('2026-11-14T18:30', '2026-11-14T20:00'), '6:30 pm - 8:00 pm', 'a range');
  assert.equal(formatEventTime('2026-11-03', null), '', 'an all-day event has no clock time and must print none');
  assert.equal(formatEventTime('2026-11-14T00:15', null), '12:15 am', 'midnight is 12, not 0');
  assert.equal(formatEventTime('2026-11-14T12:00', null), '12:00 pm', 'noon is 12 pm');
  assert.equal(formatEventTime('2026-11-14T09:05', null), '9:05 am', 'minutes are zero-padded');

  assert.equal(formatEventZone('Eastern Time (ET)'), 'Eastern Time (ET)', 'the zone label is shown');
  assert.equal(formatEventZone(null), '', 'no zone label renders nothing');
  assert.equal(formatEventZone('   '), '', 'a whitespace-only zone renders nothing');
});

test('the time machine attribute carries no offset it cannot justify', () => {
  // The instant is deliberately NOT in the file, so the attribute must not claim
  // one. A local date-and-time string is valid HTML and is read as local time.
  assert.equal(machineDateTime('2026-11-14T18:30'), '2026-11-14T18:30', 'unchanged');
  assert.equal(machineDateTime('2026-11-14T18:30:00'), '2026-11-14T18:30', 'a zero seconds part is stripped');
  assert.equal(
    machineDateTime('2026-11-14T18:30:00'),
    machineDateTime('2026-11-14T18:30'),
    'two spellings of one moment must produce byte-identical HTML, or every diff is unreviewable'
  );
  assert.equal(machineDateTime('2026-11-03'), '2026-11-03', 'an all-day value stays a date');
  assert.equal(machineDateTime('nope'), '', 'an unparseable value yields no attribute');
});

test('the rendered dates do not change with the machine timezone', () => {
  // DESIGN RULE 8, MEASURED RATHER THAN ASSUMED. "It renders in UTC" is a claim
  // about code, and code claims are exactly what looks true and is false on a
  // build machine in a different zone - which is the GH Pages runner. So the same
  // formatter is run in child processes with different TZ values and the OUTPUT IS
  // COMPARED.
  //
  // ---------------------------------------------------------------------------
  // WHAT THIS PROVES, AND WHAT IT DOES NOT
  // ---------------------------------------------------------------------------
  //
  // An earlier version of this comment overclaimed. It said a failure would mean
  // "a formatter that reached for a local-time accessor (getHours,
  // toLocaleDateString)". A review showed that is not true: an implementation using
  // getHours would still PASS this comparison, because every fixture here is a WALL
  // CLOCK string. There is no UTC instant anywhere in the input for the machine's
  // zone to bite on, so TZ has nothing to shift and all three runs agree whether
  // the accessors are local or not. The comment described a check the test does not
  // perform, which is worse than no comment.
  //
  // So, precisely: THIS proves the output does not vary with the machine timezone.
  // That is the requirement - ROADMAP design rule 8 is about the built HTML being
  // identical on this machine and on the GH Pages runner, and nothing less would
  // satisfy it. It does NOT prove the formatters are correct. It is an invariance
  // test, not an oracle test.
  //
  // That is not a reason to delete it, and here is the argument, because "it cannot
  // fail" is the kind of thing that should be argued rather than assumed:
  //
  //   - The failure it is aimed at is not "the formatter picks the wrong month". It
  //     is "the built page differs between two machines from one commit". That is a
  //     property of the WHOLE OUTPUT, not of any one fixture, so comparing whole
  //     outputs is the right granularity and an expected-string oracle cannot
  //     express it at all. You would need to run the whole build twice to check it
  //     that way.
  //   - It is cheap (three short child processes) and it fails LOUDLY on a real
  //     regression: if someone later "simplifies" parseWallClock to `new Date()`,
  //     or formats with toLocaleDateString, this goes red on the runner's zone even
  //     though the same change passes every other test in this file, because every
  //     other test runs on ONE machine's zone.
  //   - It catches the mistake at the point of the change, in the test a reader is
  //     already looking at.
  //
  // The reason it can pass a wrong implementation is also the reason the FIX below
  // is needed rather than optional: an invariance test says "these agree", never
  // "these are right". So the expected strings are asserted HERE, in this same
  // process, against what the digits in the file say they should be.
  const FIXTURES = [
    {
      value: '2026-11-14T18:30',
      date: '14 November 2026',
      time: '6:30 pm',
      machine: '2026-11-14T18:30'
    },
    { value: '2026-01-05T09:00', date: '5 January 2026', time: '9:00 am', machine: '2026-01-05T09:00' },
    // An all-day value has no clock time, so the time column is deliberately empty
    // and the machine form stays a bare date.
    { value: '2026-12-31', date: '31 December 2026', time: '', machine: '2026-12-31' },
    // Midnight must print 12 am, not 0 am - the one piece of arithmetic the whole
    // formatter rests on.
    { value: '2026-07-04T00:30', date: '4 July 2026', time: '12:30 am', machine: '2026-07-04T00:30' }
  ];

  const script = `
    import { formatEventDate, formatEventTime, machineDateTime } from ${JSON.stringify(
      pathToFileURL(resolve(PROJECT_ROOT, 'src', 'lib', 'events-schema.ts')).href
    )};
    const out = [];
    for (const v of ${JSON.stringify(FIXTURES.map((f) => f.value))}) {
      out.push([v, formatEventDate(v), formatEventTime(v, null), machineDateTime(v)].join('|'));
    }
    process.stdout.write(out.join('\\n'));
  `;

  const run = (tz) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8'
    });

  const utc = run('UTC');
  const kathmandu = run('Asia/Kathmandu');
  const losAngeles = run('America/Los_Angeles');

  // POSITIVE CONTROL on the instrument, part 1: if the formatter were doing nothing
  // at all, all three would be identical for the wrong reason. Prove it moves by
  // showing the run actually produced the expected non-empty text.
  assert.match(utc, /14 November 2026\|6:30 pm/, `positive control: the child must actually format, got: ${utc}`);

  // PART 2, AND THE TEETH: every row, checked against an explicitly expected
  // string. A single regex over one row proved the child produced text; it did not
  // prove the text was RIGHT, so a formatter that returned a consistently wrong
  // answer passed the whole test. These are the oracle, and they are why the
  // invariance comparison above is not the only thing standing here.
  //
  // Split into rows first, so a failure names WHICH fixture drifted and prints the
  // whole output rather than a substring position.
  const rows = utc.split('\n');
  assert.equal(
    rows.length,
    FIXTURES.length,
    `positive control: the child must emit one row per fixture, got ${rows.length}: ${JSON.stringify(utc)}`
  );
  for (let i = 0; i < FIXTURES.length; i += 1) {
    const expected = [FIXTURES[i].value, FIXTURES[i].date, FIXTURES[i].time, FIXTURES[i].machine].join('|');
    assert.equal(rows[i], expected, `row ${i} of the TZ=UTC run is wrong for ${FIXTURES[i].value}: expected "${expected}", got "${rows[i]}"`);
  }

  assert.equal(kathmandu, utc, 'rendering must not shift in Asia/Kathmandu (UTC+5:45), the nastiest offset there is');
  assert.equal(losAngeles, utc, 'rendering must not shift in America/Los_Angeles');
});

test('the events page styles no class that belongs to another component', async (t) => {
  // THE MOST IMPORTANT TEST IN THIS BATCH, and the defect it exists for was the
  // most expensive one found in review: a rule that matched ZERO elements while
  // every assertion in this file stayed green.
  //
  // src/pages/events.astro used to carry:
  //
  //     :global(.events__item:has(.events__radio:checked)) .row { ... }
  //
  // Astro's scope id is per COMPONENT, and `:global()` un-scopes only what is to
  // its LEFT - Astro still appends the page's own scope id to the last compound.
  // So that compiled to `.row[data-astro-cid-<events.astro>]`. But `.row` is
  // rendered by EventRow.astro, which carries a DIFFERENT scope id. The selector
  // matched nothing, silently, and what it was styling was the focus ring on the
  // selected row. The result was a calendar where selecting an event gave no focus
  // ring anywhere on the page, which is not a broken build and not a broken test -
  // just a page that had lost part of itself.
  //
  // WHY A SUBSTRING CHECK IS THE RIGHT SHAPE HERE, stated so nobody improves it:
  // no assertion in a unit test can see a scope id, because scope ids are assigned
  // at COMPILE time by Astro's CSS transform, and this suite never runs the Astro
  // compiler. Reading the compiled stylesheet out of dist/ would couple the test to
  // a build artifact that may be stale, which is worse than the defect. A substring
  // check on the page's OWN source is the closest a unit test can get: it cannot
  // prove the rule compiles to a matching selector, but it does prove the page never
  // NAMES a class owned by another component, which is the only way that bug was
  // introduced and the only way it can be reintroduced.
  //
  // The class list below is not a style preference. Each of these three is rendered
  // by src/components/EventRow.astro; anything this page wrote against them would
  // compile with the wrong scope id. `.row` is the trap specifically because a
  // substring of `.events__list` and `.events__month` shares none of its letters -
  // it is the shortest of the three and the easiest to type without noticing.
  const page = await readFile(EVENTS_PAGE, 'utf8');
  const css = styleBlockOf(page);

  // POSITIVE CONTROL ON THE EXTRACTION, in three parts, because a check that reads
  // the wrong text passes for the wrong reason:
  //   1. the <style> block exists and is substantial, so we are not matching "" ;
  //   2. it still contains the rules that DO belong to this page;
  //   3. the RAW block DOES contain the forbidden names, inside the explanatory
  //      comment, which proves the comment-stripping is doing real work and that
  //      this test is not passing merely because the file was scrubbed.
  assert.ok(css.length > 500, `positive control: the extracted <style> block should be substantial, got ${css.length} characters`);
  // `.events__layout` is this page's own class, so it must survive extraction.
  // `html:has(#day-` used to be checked here too, but the per-day selectors moved
  // to a separate `is:inline` block when they were generated from the data, and
  // `styleBlockOf` reads the scoped block only. Their presence is asserted against
  // the BUILT page in the selector tests above, which is the right place for them.
  assert.ok(
    css.includes('.events__layout'),
    'positive control: the extracted CSS must still contain this page\'s own rules, or the extraction is wrong'
  );
  const rawStyle = page.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(
    rawStyle.includes('.row') || rawStyle.includes(':global('),
    'positive control: the RAW block is expected to mention these names in the comment that explains this rule; if it no longer does, this test may be checking nothing'
  );

  t.diagnostic(`style block after comment-stripping: ${css.length} characters (raw ${rawStyle.length})`);

  // The class list below is not a style preference. Each entry is a class prefix
  // owned by a DIFFERENT component, and anything this page wrote against one would
  // compile with the wrong scope id.
  //
  //   .row      src/components/EventRow.astro     (also .row-item, .row__*)
  //   .cal      src/components/EventCalendar.astro (also .cal__*)
  //   .detail   src/components/EventDetail.astro  (also .detail__*)
  //
  // `.row` is the trap specifically because it is the shortest and shares no letters
  // with `.events__list` or `.events__month` - it is the easiest to type without
  // noticing.
  const foreignClasses = [
    ['.row', 'src/components/EventRow.astro'],
    ['.cal', 'src/components/EventCalendar.astro'],
    ['.detail', 'src/components/EventDetail.astro']
  ];
  for (const [foreign, owner] of foreignClasses) {
    assert.equal(
      css.includes(foreign),
      false,
      `src/pages/events.astro's <style> block names "${foreign}", which belongs to ${owner}. ` +
        'Astro appends THIS component\'s scope id to the last compound of a selector, so the rule would compile to ' +
        `${foreign}[data-astro-cid-<events.astro>] and match nothing. Style it from that component's own scoped block instead.`
    );
  }

  // The other half of the same class of mistake: a `:global()` CLASS selector here is
  // a hand-written bet against the scope id, and it is a losing bet. A `:global()`
  // ATTRIBUTE selector is a different thing entirely and is REQUIRED by the page -
  // see the test on the noscript fallback, which explains why the two forms are
  // treated differently rather than one being banned outright.
  assert.equal(
    /:global\(\s*\./.test(css),
    false,
    'src/pages/events.astro uses a :global() CLASS selector. `:global()` un-scopes only what is to its LEFT; Astro still ' +
      'appends this component\'s scope id to the last compound, so the rule silently matches nothing.'
  );

  // `:has()` IS allowed, and must be: it is how the page selects a panel and how it
  // switches views, and it says nothing about scope. Stated so the assertion above
  // cannot be satisfied by deleting the selection mechanism, which would break the
  // page to pass a test.
  assert.ok(
    css.includes(':has('),
    'positive control: the page must still use :has() to show the selected panel; if that changed, update this test rather than deleting it'
  );
});

test('the events page ships no <noscript> fallback, and no :global() CLASS selector', async (t) => {
  // A DEAD FALLBACK SHIPPED HERE ONCE. Every row carried a "Details for X" anchor
  // inside a <noscript>, plus a page-level one telling the reader to use those links
  // when scripting is off. Both did nothing:
  //
  //   - THE PREMISE WAS FALSE. Radios are not scripting. `:checked` is a CSS
  //     pseudo-class and `:has()` is a CSS selector, so the entire selection
  //     mechanism works with scripting disabled - which was the whole design goal,
  //     not an accident.
  //   - AND THE ANCHOR POINTED AT A HIDDEN ELEMENT. The panel is `display: none`
  //     unless its radio is checked, and there was no `:target` rule anywhere in
  //     the file, so the link scrolled the reader to something they could not see
  //     and changed nothing. It was described in a comment as "a link that works,
  //     not a disabled control". It was not a link that worked.
  //
  // So there is no fallback, and this test is what keeps it that way.
  //
  // THE :global() HALF IS NOW A DISTINCTION, NOT A BAN, AND THE REASON IS WORTH
  // RECORDING. The page now legitimately uses `:global([data-day='...'])` and
  // `:global([data-panel='...'])`, because a calendar cell and a list row are
  // rendered by DIFFERENT components from the radio they select. CSS cannot relate
  // a label to a control it merely names, so marking a selected date requires one
  // selector per date, and the whole trailing compound must be unscoped for it to
  // match. Written that way it works, and is verified working in a browser.
  //
  // What must stay banned is `:global(.` - a CLASS selector. That is the exact
  // shape of the bug that shipped with no focus ring: `:global(.events__item ...)
  // .row` un-scopes only what is to its LEFT, so Astro still appended the page's
  // scope id to `.row`, which is rendered by EventRow with a different one, and the
  // rule matched NOTHING. Silently. Attribute selectors have no such trap, which is
  // why one form is banned and the other is required.
  const page = await readFile(EVENTS_PAGE, 'utf8');
  const live = stripAstroComments(page);

  // POSITIVE CONTROL ON THE STRIPPER, in three parts. A stripper that removed too
  // much would make every assertion below pass vacuously, and a stripper that
  // removed too little would make them fail on prose.
  assert.ok(
    live.length > 2000,
    `positive control: the stripped page should still be substantial, got ${live.length} characters`
  );
  assert.ok(
    live.includes('id="events-calendar"') && live.includes('data-panel={day.key}'),
    "positive control: the stripped text must still contain the page's live markup, or the comment stripper ate the template"
  );
  // Positive control on the control below. `:global()` is the thing being asserted
  // ABSENT, so the check needs positive evidence that the stripper is working -
  // otherwise a stripper that ate the entire file would make this test pass.
  assert.ok(
    stripAstroComments(page).length < page.length,
    'positive control: comment-stripping must actually remove something, or the :global() check below is vacuous'
  );

  t.diagnostic(`page after comment-stripping: ${live.length} characters (raw ${page.length})`);

  assert.equal(
    live.includes('<noscript'),
    false,
    'src/pages/events.astro renders a <noscript> element. The selection mechanism is pure CSS (:checked and :has()), so ' +
      'it works with scripting OFF and needs no fallback; and the previous fallback pointed at a display:none panel with no ' +
      ':target rule, so it did nothing while a comment described it as a working link.'
  );
  assert.equal(
    /:global\(\s*\./.test(live),
    false,
    "src/pages/events.astro uses a :global() CLASS selector, which cannot reach another component's elements: Astro " +
      'still appends the page scope id to the last compound, so the rule matches nothing and fails SILENTLY. That is how ' +
      'this page shipped with no keyboard focus ring at all. Attribute selectors (:global([...])) are fine and are required ' +
      'for the per-day selection rules.'
  );

  // And the selection mechanism really is present, because a test that only bans
  // things would happily pass on a page where the mechanism had been deleted
  // outright along with the :global() calls.
  //
  // The per-day selectors are no longer in the page SOURCE: they are generated
  // into an `is:inline` block, which is why this reads the BUILT page. Asserted
  // here as the positive control for the :global()-class ban above, and
  // exhaustively in the selector tests near the top of this file.
  const builtHtml = await readFile(
    resolve(PROJECT_ROOT, 'dist', 'events', 'index.html'),
    'utf8'
  ).catch(() => null);
  assert.ok(
    builtHtml !== null,
    'positive control: the built page must exist. Run `npm run build` before this suite.'
  );
  assert.ok(
    /html:has\(#day-\d{4}-\d{2}-\d{2}:checked\)\s*\[data-panel=/.test(builtHtml),
    'positive control on the rule above: the built page is expected to carry the generated per-day panel selectors, ' +
      'so the calendar CAN mark a selected date. If they are missing, the selection mechanism was deleted, not merely ' +
      'cleaned up.'
  );

  // And the dependency is still stated in the markup rather than left implicit, so
  // the honest caveat is visible to a reader. This asserts a claim in PROSE is
  // present, which is a weaker kind of assertion - it is here to stop the note
  // being deleted silently, not to prove behaviour.
  assert.ok(
    live.includes('events-note'),
    'the page must keep its prose note about selecting an event; deleting the only stated dependency to make this ' +
      'section quieter is the same class of silent removal this test exists for'
  );
});

test('no calendar cell claims to be aria-current, and the state is carried twice instead', async (t) => {
  // THE ATTRIBUTE THAT WAS LYING. EventCalendar.astro rendered
  //
  //     aria-current={cell.day.key === selectedKey ? 'true' : undefined}
  //
  // on each event-day cell, from a `selectedKey` prop. That prop is a BUILD-TIME
  // constant: events.astro picks the first upcoming day ONCE, while rendering, and
  // hands the same string to every cell. The attribute is therefore baked into the
  // HTML and can never change. Select a different date and the CSS `:checked`
  // styling moves - while the accessibility tree goes on reporting the OLD cell as
  // current. A cell that is not current, marked as current, in the document a
  // screen reader is reading, is worse than no signal at all.
  //
  // It is invisible in review because the markup is correct as written. The
  // attribute only becomes false after the reader acts, which no reviewer and no
  // snapshot test does.
  //
  // There is no fix inside a no-JS design. CSS cannot write an ARIA attribute, and
  // an attribute's value cannot be a selector. Maintaining it needs script, and
  // this page has none by design - which is the whole reason the removal is
  // correct rather than a loss.
  const component = await readFile(resolve(PROJECT_ROOT, 'src', 'components', 'EventCalendar.astro'), 'utf8');
  const page = await readFile(EVENTS_PAGE, 'utf8');
  const liveComponent = stripAstroComments(component);
  const livePage = stripAstroComments(page);

  assert.equal(
    /aria-current/.test(liveComponent),
    false,
    'src/components/EventCalendar.astro renders aria-current again. It is rendered from a build-time constant, so it ' +
      'reports the wrong cell as current after the reader selects another. The selected cell is marked by the page\'s ' +
      'generated per-day selectors and announced by the radio and the aria-live panel.'
  );
  assert.equal(
    /aria-current/.test(livePage),
    false,
    'src/pages/events.astro renders aria-current again, with the same defect: no script on this page can update it.'
  );

  // The prop that fed it is gone too, rather than left in the interface where the
  // next person reconnects it. events.astro computes selectedKey for the RADIO's
  // `checked`, which is real platform state, and that use is asserted elsewhere.
  assert.equal(
    /selectedKey/.test(liveComponent),
    false,
    'EventCalendar.astro still takes a `selectedKey` prop. Nothing in the calendar can act on it: the only thing it ' +
      'ever fed was the aria-current attribute. Pass it to the radio in events.astro, which uses it for `checked`.'
  );
  assert.equal(
    /selectedKey=\{selectedKey\}/.test(livePage),
    false,
    'events.astro still passes selectedKey to <EventCalendar>. Remove the prop rather than leave a constant wired to ' +
      'a component that cannot keep it true.'
  );

  // THE CLAIM THE REMOVAL RESTS ON, verified in the markup rather than asserted in
  // a comment. If either of these were false the removal would cost a real
  // announcement, and the honest response would be to keep the attribute and say
  // so rather than to delete it silently.
  //
  // 1. The day radios: real inputs, named, one of them checked on first paint.
  const builtPath = resolve(PROJECT_ROOT, 'dist', 'events', 'index.html');
  const built = await readFile(builtPath, 'utf8').catch(() => null);
  assert.ok(
    built !== null,
    `positive control: the built page must exist at ${builtPath}. Run \`npm run build\` before this suite.`
  );

  const radios = [...built.matchAll(/<input[^>]*class="events__day"[^>]*>/g)].map((m) => m[0]);
  assert.ok(radios.length > 0, 'positive control: the built page must render the day radios');
  assert.equal(
    radios.filter((tag) => /\schecked/.test(tag)).length,
    1,
    'exactly one day radio is checked on first paint'
  );
  for (const tag of radios) {
    assert.match(tag, /aria-label="[^"]+,\s*\d+\s+events?"/, `every day radio must carry an aria-label naming the date and its count: ${tag}`);
    assert.match(tag, /aria-controls="panel-/, `every day radio must point at its own panel: ${tag}`);
  }
  t.diagnostic(`day radios in the built page: ${radios.length}, each with an aria-label and aria-controls`);

  // 2. The panel: an aria-live region, so a change of what is visible inside it is
  // announced.
  assert.match(
    built,
    /<aside[^>]*class="events__panel"[^>]*aria-live="polite"/,
    'the panel must be an aria-live region; without it, removing aria-current would remove the only announcement of a change'
  );

  // 3. And no cell carries a current-state attribute of any kind, in the built
  // HTML rather than the source.
  assert.equal(
    /aria-current/.test(built),
    false,
    'the built page still contains aria-current. It is a build-time constant baked into the HTML and cannot track the selection.'
  );
});

test('the page meta description makes no per-row claim about every row', async (t) => {
  // A LIE IN PROSE, WHICH IS HARDER TO NOTICE THAN A LIE IN A FIELD.
  //
  // The description used to read "Each row carries a thumbnail; select one to see
  // its details and banner". A review checked it against the data: `election-day`
  // has no thumbnail, and both it and `winter-open-lecture` have no banner. So
  // THREE OF SEVEN ROWS contradicted the page's own metadata - in a sentence that
  // was in the HTML of every shared link, every search result and every browser
  // tab title preview.
  //
  // This is the same defect this project exists to prevent, expressed in English
  // instead of in a field, so it gets the same treatment.
  //
  // Deliberately LOOSE, and here is why: it asserts on two specific phrases rather
  // than on the sentence as written. The point is to stop a per-row claim creeping
  // BACK into a sentence about every row; pinning the exact wording would fail on
  // any future edit to a description that is otherwise honest, and a test that has
  // to be rewritten on every copy tweak is a test that gets deleted.
  const page = await readFile(EVENTS_PAGE, 'utf8');
  const live = stripAstroComments(page);
  const match = live.match(/const description\s*=([\s\S]*?)\n---/);
  assert.ok(match, 'could not find the `const description` assignment in src/pages/events.astro; if it moved, update this test rather than deleting it');
  const description = match[1];

  // POSITIVE CONTROL ON THE EXTRACTION, so a match that captured the wrong span
  // cannot pass both negative assertions by being empty.
  assert.ok(description.length > 40, `positive control: the extracted description should be a real sentence, got ${description.length} characters`);
  assert.ok(
    description.includes('eventCount'),
    'positive control: the extracted span must be the description template itself, since it interpolates the event count'
  );
  t.diagnostic(`description template: ${description.replace(/\s+/g, ' ').trim()}`);

  for (const forbidden of ['Each row carries a thumbnail', 'its details and banner']) {
    assert.equal(
      description.includes(forbidden),
      false,
      `the meta description contains the phrase "${forbidden}", which is false for 3 of the 7 sample events ` +
        '(election-day has no thumbnail; election-day and winter-open-lecture have no banner). A per-row claim must ' +
        'not sit in a sentence about every row.'
    );
  }

  // POSITIVE CONTROL, REWRITTEN, following its own failure message.
  //
  // It used to assert that SOME events lacked artwork, because that is what made
  // "each row carries a thumbnail" a lie. Every one of the six real events now has
  // both a thumbnail and a banner, so that condition is gone - and the control said
  // in its own message: "update the test to assert the data rather than the prose".
  // This is that update.
  //
  // The durable property is not "some rows are missing something". It is that the
  // description is DERIVED FROM THE DATA, so it cannot go stale when the data
  // changes - which is the actual cause of the defect this test exists for. A
  // hand-typed sentence about a calendar is a lie the moment the calendar changes,
  // whether or not every row happens to have artwork today.
  const literals = description
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  t.diagnostic(`description literals once interpolations are removed: ${literals}`);

  // Every interpolating slot is present, so "derived" means derived rather than
  // "happens to mention a number".
  for (const slot of ['eventCount', 'firstDate', 'lastDate', 'days.length']) {
    assert.ok(
      description.includes(slot),
      `positive control: the description must interpolate ${slot}, or it is not derived from the data. Got: ${description}`
    );
  }

  // And it names no individual event. A description that hard-codes one event's
  // title is per-row prose in the same sense the original defect was: true of that
  // row and quietly wrong about the rest.
  const namedInProse = REAL_DOC.events.map((event) => event.name).filter((name) => literals.includes(name));
  assert.deepEqual(
    namedInProse,
    [],
    `the description's literal text names individual events, which makes it a per-row claim: ${namedInProse.join(', ')}`
  );
});

test('articles.ts imports the month table rather than declaring its own', async () => {
  // THIS REPLACED A TEST THAT COMPARED THE TWO TABLES, and the old one is worth
  // remembering. articles.ts carried a private MONTHS array identical to the one in
  // months.ts, and the guard against drift was a test that extracted both arrays
  // with a regex and compared them. That test could only ever fail after somebody
  // had already edited one table and not the other - which is a red suite at the
  // END of the change rather than a reason not to make it. Two copies of the same
  // twelve strings, held in step by a test that reads both, is one import.
  //
  // So the assertion is now on the STRUCTURE: articles.ts must not declare a
  // MONTHS array, and must import MONTHS from months.ts. If someone re-adds a local
  // table this fails at the moment of the edit, which is the whole point.
  //
  // POSITIVE CONTROL FIRST: months.ts must actually still HAVE the table. Without
  // it, a stub months.ts that exported nothing would satisfy "articles.ts declares
  // no table" and every date on the site would render as "undefined".
  const monthsSource = await readFile(MONTHS_MODULE, 'utf8');
  const monthsMatch = monthsSource.match(/MONTHS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(monthsMatch, 'positive control: src/lib/months.ts must declare the MONTHS table');
  const months = monthsMatch[1].match(/'([^']+)'/g).map((quoted) => quoted.slice(1, -1));
  assert.equal(months.length, 12, `positive control: the table must hold twelve month names, got ${months.length}`);
  assert.equal(months[0], 'January', 'positive control: the table must start at January');
  assert.equal(months[11], 'December', 'positive control: the table must end at December');

  const articlesSource = await readFile(resolve(PROJECT_ROOT, 'src', 'lib', 'articles.ts'), 'utf8');
  const live = stripAstroComments(articlesSource);

  assert.equal(
    /MONTHS\s*=\s*\[/.test(live),
    false,
    'src/lib/articles.ts declares its own MONTHS array again. It must import MONTHS from src/lib/months.ts: ' +
      'one table for the site, not two copies held in step by a test.'
  );
  assert.match(
    live,
    /import\s*\{\s*MONTHS\s*\}\s*from\s*'\.\/months\.ts'/,
    "src/lib/articles.ts must import MONTHS from './months.ts'. The specifier carries the extension because " +
      'bare Node - which `node --test` uses - cannot resolve an extensionless relative import.'
  );

  // And the zero-padding rule is the same story: one implementation, in months.ts.
  // `monthKeyPart` used to take a ZERO-based index while the private twoDigits in
  // calendar.ts took the value as given, and the difference between them was an
  // off-by-one month that renders as a plausible wrong date rather than an error.
  assert.match(
    monthsSource,
    /export function twoDigits\(/,
    'src/lib/months.ts must export twoDigits(), the single zero-padding implementation'
  );
  assert.equal(
    /padStart\(/.test(stripAstroComments(await readFile(resolve(PROJECT_ROOT, 'src', 'lib', 'calendar.ts'), 'utf8'))),
    false,
    'src/lib/calendar.ts calls padStart directly again. It must use twoDigits() from src/lib/months.ts, so ' +
      'there is one place that decides how a number is padded.'
  );
});

test('an event day and an empty day differ by a NON-COLOUR property', async (t) => {
  // A COLOUR-ONLY DIFFERENCE IS A SIGNAL THAT DISAPPEARS WHERE IT IS NEEDED.
  //
  // The unselected calendar cell had exactly one thing telling an event day from an
  // empty one: the numeral's text colour, `var(--text-muted)` on an empty day and
  // `var(--text)` on a day with something on. No background, no weight, no shape.
  // A hue is the one thing forced-colours mode, greyscale print and every colour
  // vision deficiency remove, so the distinction a reader most needs - "which
  // dates are worth selecting" - was carried by the one channel that cannot be
  // relied on to carry it.
  //
  // The fix is a SHAPE: a small ring rendered beside the numeral on event days only.
  // Drawn with a BORDER rather than a background, because forced-colours mode
  // overrides `background-color` to the canvas colour - a dot painted that way is
  // invisible exactly where it was added to help - while border-width and
  // border-style are not overridden, so the ring keeps its shape and its size.
  //
  // The test asserts on the BUILT page, not the source, so it checks what a
  // browser receives. It reads the compiled CSS out of the built HTML rather than
  // trying to resolve styles, and it asserts the PRESENCE of a non-colour property
  // on the marker rather than a particular value, so restyling the ring to a
  // different size or weight does not fail a test about colour-independence.
  const builtPath = resolve(PROJECT_ROOT, 'dist', 'events', 'index.html');
  const built = await readFile(builtPath, 'utf8').catch(() => null);
  assert.ok(
    built !== null,
    `positive control: the built page must exist at ${builtPath}. Run \`npm run build\` before this suite.`
  );

  // POSITIVE CONTROL 1: the built page really does contain both kinds of cell, so a
  // page that had somehow stopped rendering event days could not pass the "they
  // differ" assertions below by having nothing to compare.
  const eventCells = [...built.matchAll(/<label[^>]*class="cal__day"[^>]*>/g)].map((m) => m[0]);
  const bareCells = [...built.matchAll(/<span[^>]*class="cal__day cal__day--bare"[^>]*>/g)].map((m) => m[0]);
  assert.ok(eventCells.length > 0, 'positive control: the built page must render at least one event day');
  assert.ok(bareCells.length > 0, 'positive control: the built page must render at least one empty day');
  t.diagnostic(`built page: ${eventCells.length} event day(s), ${bareCells.length} empty day(s)`);

  // The marker element. Presence of the ELEMENT is the signal, so it cannot be
  // lost to a palette, and an empty day simply does not have one.
  // The compiled rules for this component are NOT in the HTML: Astro extracts them
  // into an external stylesheet under dist/_astro/. So the marker rule is read out
  // of the stylesheet the built page actually links to, found by following the
  // <link rel="stylesheet"> rather than by guessing the hashed filename - a
  // guessed name would break on every unrelated build and teach people to ignore
  // the failure.
  const hrefs = [...built.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 0, 'positive control: the built page must link at least one stylesheet');
  t.diagnostic(`stylesheets linked by the built page: ${hrefs.join(', ')}`);

  const sheets = [];
  for (const href of hrefs) {
    // dist/events/index.html is the page, so a root-relative href resolves against
    // dist/ - which is where _astro/ lives. No filesystem assumptions beyond that.
    const rel = href.replace(/^\//, '');
    sheets.push(await readFile(resolve(PROJECT_ROOT, 'dist', rel), 'utf8').catch(() => ''));
  }
  const css = sheets.join('\n');
  assert.ok(css.length > 500, `positive control: the linked stylesheets must be readable and substantial, got ${css.length} characters`);

  const markerRule = css.match(/\.cal__mark[^{]*\{([^}]*)\}/);
  assert.ok(
    markerRule,
    'positive control: the built page\'s stylesheet must carry a compiled rule for .cal__mark, or the marker is unstyled ' +
      'and the assertions below would be checking a selector that matches nothing'
  );

  const declarations = markerRule[1]
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
  t.diagnostic(`.cal__mark declarations: ${declarations.join(' | ')}`);

  // Properties whose PRESENCE is a non-colour signal: the ring's geometry and its
  // stroke. `color` and `background` are excluded deliberately - those are exactly
  // what forced-colours mode overrides.
  const NON_COLOUR = /^(width|height|border|border-width|border-style|border-color|border-radius|outline|box-shadow|font-weight|text-decoration|text-underline-offset)\s*:/;
  const nonColour = declarations.filter((d) => NON_COLOUR.test(d));
  assert.ok(
    nonColour.length > 0,
    `.cal__mark must be given at least one NON-COLOUR property (width, height, border, outline, weight). ` +
      `Got only: ${declarations.join('; ')} - a marker defined purely in colour is invisible in forced-colours mode.`
  );

  // And the geometry has to be real: a marker with no size is a marker with no
  // shape, which is the original defect wearing a new class name.
  assert.match(
    markerRule[1],
    /width\s*:\s*\d/,
    `the ring needs a real width to be a shape at all, got: ${markerRule[1].trim()}`
  );
  assert.match(
    markerRule[1],
    /height\s*:\s*\d/,
    `the ring needs a real height to be a shape at all, got: ${markerRule[1].trim()}`
  );

  // POSITIVE CONTROL 2, and the half that is easy to get wrong: it must NOT be
  // `background`. A dot painted with `background: currentColor` is overridden to
  // the canvas colour in forced-colours mode, so it disappears exactly where it
  // was added. Asserting its absence here is what stops somebody "simplifying" the
  // ring into a filled dot later.
  assert.equal(
    /background(-color)?\s*:/.test(markerRule[1]),
    false,
    '.cal__mark must be drawn with a border, not a background. Forced-colours mode overrides background-color to the ' +
      'canvas colour, so a background-painted marker is invisible in the mode it exists for. Border-width and ' +
      'border-style survive the override.'
  );

  // The last link in the chain, counted rather than pattern-matched on one cell:
  // there must be EXACTLY as many markers in the built HTML as there are event
  // days, and no more. One per event day is the signal; one per empty day, or one
  // on every cell, would make it meaningless.
  const markerCount = (built.match(/class="cal__mark"/g) || []).length;
  assert.equal(
    markerCount,
    eventCells.length,
    `every event day must carry exactly one marker and no empty day may carry one: ${markerCount} marker(s) for ` +
      `${eventCells.length} event day(s) and ${bareCells.length} empty day(s)`
  );
  assert.ok(markerCount > 0, 'positive control: at least one marker must be rendered');
});

test('data/events.schema.md documents every field the code validates, at the lengths the code enforces', async (t) => {
  // THE CLAIM THIS TEST EXISTS TO BACK UP. The comment on EVENT_FIELDS in
  // src/lib/events-schema.ts says:
  //
  //     "One table means the doc cannot drift from the code without the drift being
  //      visible in the same file."
  //
  // "Visible in the same file" is not the same as "caught". One table in CODE is a
  // single source of truth for the validator, the exported key list and whoever
  // reads the source - but data/events.schema.md is a SEPARATE FILE, maintained by
  // hand, and nothing connected it to the table. The comment therefore overclaimed:
  // it described a property the arrangement did not have.
  //
  // The doc matters more than usual here. There is no program that writes
  // data/events.json, so an AI assistant working from a written description is going
  // to read this document rather than the TypeScript. A doc that lists four fields
  // and a code that validates thirteen produces exactly the class of failure this
  // project calls unacceptable: a row that renders, looks finished, and is wrong.
  //
  // MISMATCHES ARE REPORTED, NOT REPAIRED HERE. If this fails, the fix is a decision
  // about which side is authoritative, and making that decision silently inside a
  // test would hide it. Neither file is edited by this test.
  const doc = await readFile(resolve(PROJECT_ROOT, 'data', 'events.schema.md'), 'utf8');

  // The doc's field table is the markdown table whose rows are `| \`key\` | ... |`.
  // Parsed rather than regex-matched whole so a prose mention of a key elsewhere in
  // the document cannot satisfy the check - a doc that discusses `notes` in a
  // sentence while omitting it from the table would otherwise pass.
  const declared = new Map();
  for (const line of doc.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const key = /`([A-Za-z][A-Za-z0-9]*)`/.exec(cells[0] ?? '');
    const max = /^\d+$/.test(cells[2] ?? '') ? Number(cells[2]) : null;
    if (key && max !== null) declared.set(key[1], { max, cells });
  }

  t.diagnostic(`rows parsed from the doc's field table: ${declared.size}`);
  assert.equal(
    declared.size,
    EVENT_FIELDS.length,
    `the doc's field table must have one row per EVENT_FIELDS entry: parsed ${declared.size}, code has ${EVENT_FIELDS.length}. ` +
      'Neither file should be edited by this test - report which one is authoritative.'
  );

  const missingKeys = [];
  const lengthMismatches = [];
  for (const field of EVENT_FIELDS) {
    const row = declared.get(field.key);
    if (row === undefined) {
      missingKeys.push(field.key);
      continue;
    }
    if (row.max !== field.maxLength) {
      lengthMismatches.push(`${field.key}: doc says ${row.max}, code says ${field.maxLength}`);
    }
  }
  // And the reverse direction: a row the code does not know about is a doc
  // promising a field that is not validated, which is worse than the reverse.
  const extraKeys = [...declared.keys()].filter((key) => !EVENT_FIELDS.some((f) => f.key === key));

  assert.deepEqual(missingKeys, [], `EVENT_FIELDS entries with no row in data/events.schema.md: ${missingKeys.join(', ')}`);
  assert.deepEqual(
    lengthMismatches,
    [],
    `declared maximum lengths that disagree between data/events.schema.md and EVENT_FIELDS: ${lengthMismatches.join('; ')}`
  );
  assert.deepEqual(
    extraKeys,
    [],
    `rows in data/events.schema.md's table that EVENT_FIELDS does not validate: ${extraKeys.join(', ')}. ` +
      'The document promises a field the code would reject, or ignore.'
  );

  // POSITIVE CONTROL, and it is the important one: the check above can pass on a
  // parser that matched nothing and produced two empty arrays. So the parser is
  // proven against the table it is supposed to be reading - one known row, with a
  // known key and a known number, read out of the doc rather than out of the code.
  assert.equal(
    declared.get('id')?.max,
    60,
    'positive control: the parser must read the `id` row\'s Max column (expected 60) out of the document itself'
  );
  assert.equal(
    declared.get('notes')?.max,
    600,
    'positive control: the parser must read the `notes` row\'s Max column (expected 600) out of the document itself'
  );
  assert.match(
    declared.get('startsAt')?.cells.join(' ') ?? '',
    /local wall clock/i,
    'positive control: the parsed cells must be the row\'s prose, so the Max column is being read from the right cell'
  );
});

// ---------------------------------------------------------------------------
// Authoring invariants on the files this feature added
// ---------------------------------------------------------------------------

test('every file this feature added is pure ASCII, and the dataset has no BOM', async () => {
  // ROADMAP design rule 9, enforced rather than trusted. This is not fussiness:
  // an em dash or a no-break space surviving into a data file is the documented
  // way this machine silently corrupts source, and these are exactly the files
  // an AI assistant will rewrite.
  //
  // ASCII is checked against the code points themselves, not by eyeballing, and
  // the diagnostic prints the actual offset so a failure is actionable.
  const authored = [
    'data/events.json',
    'data/events.schema.md',
    'src/lib/events.ts',
    'src/lib/events-schema.ts',
    'src/lib/months.ts',
    'src/lib/calendar.ts',
    'src/lib/articles.ts',
    'src/pages/events.astro',
    'src/components/EventRow.astro',
    'src/components/EventCalendar.astro',
    'src/components/EventDetail.astro',
    'scripts/check-events.mjs',
    'scripts/lib/bom.mjs',
    'scripts/make-placeholders.mjs',
    'test/events.test.mjs',
    'test/calendar.test.mjs'
  ];

  const offenders = [];
  for (const rel of authored) {
    const text = await readFile(resolve(PROJECT_ROOT, rel), 'utf8');
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) > 127) {
        const code = text.charCodeAt(i);
        offenders.push(
          `${rel}: offset ${i} is U+${code.toString(16).toUpperCase().padStart(4, '0')} (not ASCII)`
        );
        break;
      }
    }
  }

  assert.deepEqual(offenders, [], `non-ASCII characters in authored files:\n  ${offenders.join('\n  ')}`);
});

test('a byte order mark in the dataset is rejected with a diagnosis, not a mystery', async (t) => {
  // Found by a probe that happened to write its scratch file with PowerShell's
  // `Out-File -Encoding utf8`, which adds a BOM on this machine. Notepad does the
  // same. The raw symptom is `Unexpected token ''` pointing at the opening brace,
  // which sends an author looking for a JSON syntax error that is not there.
  //
  // The CLI strips it and names the cause. That behaviour is asserted here rather
  // than assumed, because the alternative - a validator that "handles" the BOM by
  // accident, via some layer further down - is exactly the kind of fix that works
  // on the machine it was written on.
  const { stripBomForTest } = await import('../scripts/check-events.mjs');
  const BOM = String.fromCharCode(0xfeff);

  t.diagnostic(`BOM built from code point U+FEFF, length ${BOM.length}`);
  assert.equal(BOM.length, 1, 'positive control: the BOM must be exactly one character');
  assert.notEqual(BOM, ' ', 'positive control: a BOM that degraded to a space would make this test vacuous');

  assert.equal(stripBomForTest(BOM + '{"a":1}'), '{"a":1}', 'a leading BOM must be removed');
  assert.equal(stripBomForTest('{"a":1}'), '{"a":1}', 'a file with no BOM must be untouched');
  assert.doesNotThrow(() => JSON.parse(stripBomForTest(BOM + '{"a":1}')), 'the stripped text must be parseable');

  // And the committed file itself must not carry one, since a BOM there is a
  // footgun waiting for the next person to edit the file in a Windows editor.
  const bytes = await readFile(EVENTS_JSON);
  assert.notEqual(
    bytes[0],
    0xef,
    `data/events.json starts with the bytes ${[...bytes.slice(0, 3)].map((b) => b.toString(16)).join(' ')}, ` +
      'which is a UTF-8 BOM. Save the dataset as UTF-8 without one.'
  );
  assert.equal(bytes[0], 0x7b, `data/events.json must start with "{" (0x7b), got 0x${bytes[0].toString(16)}`);
});

// ---------------------------------------------------------------------------
// The multi-day span, added when early voting arrived
// ---------------------------------------------------------------------------

test('a multi-day all-day event renders as a SPAN, not as its start date', () => {
  // THE GAP THIS CLOSED, AND WHY NO TEST CAUGHT IT BEFORE.
  //
  // The schema has always accepted an all-day `endsAt` - and the `ends-before-starts`
  // check was specifically repaired to work for all-day pairs - but the RENDERER only
  // ever printed `startsAt`. Every sample event had been a single day, so the code
  // path was correct for all of them and wrong for none.
  //
  // Then early voting arrived: a two-week window ending 31 October. With the old
  // renderer the panel would have said the start date alone - true, and missing
  // the only number a voter actually needs. A fortnight of voting announced as a
  // single day.
  //
  // The dates here are a FIXTURE, chosen by this test and unrelated to what any
  // real event says. The real early-voting window is checked against the dataset
  // below; keeping the two apart is what stops a correction to the real data from
  // breaking an unrelated formatter test, which is exactly what happened when this
  // assertion was written against the then-current real dates.
  assert.equal(
    formatEventDateSpan('2026-10-15', '2026-10-31'),
    '15 - 31 October 2026',
    'a multi-day all-day span must render both ends'
  );

  // POSITIVE CONTROL on the fixture: the same start with NO end must collapse to the
  // single date, or the function could pass for the wrong reason - for example by
  // always printing something range-shaped.
  assert.equal(
    formatEventDateSpan('2026-10-15', null),
    '15 October 2026',
    'positive control: with no endsAt the span must collapse to one date'
  );

  // And the real data goes through the same formatter, because the real data is the
  // thing that has to work.
  const earlyVoting = REAL_DOC.events.find((event) => event.id === 'early-voting');
  assert.ok(earlyVoting, 'positive control: the real dataset must contain early-voting');
  // The expectation is DERIVED from the dataset rather than written out. The
  // literal used to be spelled here as '15 - 31 October 2026', so correcting the
  // start date to the real one (19 October, per scvotes.gov - the data had said
  // the 15th) failed a test that was asserting the old, wrong value. The
  // invariant worth protecting is that it renders as a SPAN of the right length;
  // whether the dates themselves are correct is a question about the world, and
  // it is recorded in data/events.schema.md, not pinned here.
  const earlyStartDay = Number(earlyVoting.startsAt.slice(8, 10));
  const earlyEndDay = Number(earlyVoting.endsAt.slice(8, 10));
  assert.equal(
    formatEventDateSpan(earlyVoting.startsAt, earlyVoting.endsAt),
    `${earlyStartDay} - ${earlyEndDay} October 2026`,
    'the real early-voting entry must render as a span naming the start and end day'
  );
  assert.ok(
    earlyEndDay > earlyStartDay,
    'early voting must end after it starts; a one-day early-voting window would be a serious civic error'
  );
});

test('a span covers a month and a year boundary without inventing a month', () => {
  assert.equal(
    formatEventDateSpan('2026-10-30', '2026-11-02'),
    '30 October - 2 November 2026',
    'a span crossing a month boundary must name both months'
  );
  assert.equal(
    formatEventDateSpan('2026-12-28', '2027-01-03'),
    '28 December 2026 - 3 January 2027',
    'a span crossing a year boundary must name both years'
  );

  // POSITIVE CONTROL: the same-month case really is shorter, so the branches are
  // distinguishable and the assertion above is not passing for free.
  const sameMonth = formatEventDateSpan('2026-10-15', '2026-10-31');
  const crossMonth = formatEventDateSpan('2026-10-30', '2026-11-02');
  assert.ok(
    sameMonth.length < crossMonth.length,
    `positive control: a same-month span must be shorter than a cross-month one, got "${sameMonth}" and "${crossMonth}"`
  );
});

test('a TIMED pair never becomes a span', () => {
  // THE CASE THAT WOULD READ AS NONSENSE. A debate running 7:00 pm to 9:00 pm on
  // one day must not be rendered by the month-crossing branch as
  // "18:30 - 31 October 2026". So a span exists only between two ALL-DAY dates, and
  // `formatEventTime` prints the clock range separately.
  assert.equal(
    formatEventDateSpan('2026-10-06T19:00', '2026-10-06T21:00'),
    '6 October 2026',
    'a same-day timed pair must render one date'
  );
  assert.equal(
    formatEventTime('2026-10-06T19:00', '2026-10-06T21:00'),
    '7:00 pm - 9:00 pm',
    'positive control: the clock range is still printed, by formatEventTime'
  );

  // The mixed pair - an all-day start with a timed end - must degrade to the start
  // date rather than produce an inverted range.
  assert.equal(
    formatEventDateSpan('2026-10-15', '2026-10-31T17:00'),
    '15 October 2026',
    'a mixed all-day/timed pair must degrade to the start date, not print an inverted range'
  );
});

test('an unparseable span degrades to an empty string rather than printing nonsense', () => {
  assert.equal(formatEventDateSpan('not-a-date', '2026-10-31'), '', 'a bad start must yield the empty string');
  assert.equal(
    formatEventDateSpan('2026-10-15', 'not-a-date'),
    '15 October 2026',
    'a bad end must fall back to the start date'
  );
  // POSITIVE CONTROL: the empty string is a decision about bad input, not the
  // function returning nothing for everything.
  assert.notEqual(
    formatEventDateSpan('2026-10-15', null),
    '',
    'positive control: a good value must still render'
  );
});

// ---------------------------------------------------------------------------
// pageNote: the optional closing block of prose
// ---------------------------------------------------------------------------

test('a well-formed pageNote is validated, read back, and survives to the result', () => {
  const doc = goodDoc(
    {},
    { pageNote: { heading: 'Ongoing campaign activity', paragraphs: ['First paragraph.', 'Second paragraph.'] } }
  );
  const result = validateEvents(doc);

  assert.equal(result.ok, true, `fixture must validate, got ${JSON.stringify(result.problems)}`);
  assert.deepEqual(
    result.pageNote,
    { heading: 'Ongoing campaign activity', paragraphs: ['First paragraph.', 'Second paragraph.'] },
    'the note block must be read back exactly'
  );
});

test('pageNote is genuinely optional, and absent means null rather than an empty section', () => {
  // A page with no note is the ordinary case. It must validate clean AND yield null,
  // so the page renders nothing at all instead of a heading over nothing.
  const absent = validateEvents(goodDoc());
  assert.equal(absent.ok, true, 'a document with no pageNote must be valid');
  assert.equal(absent.pageNote, null, 'an absent pageNote must read back as null');

  // Explicit null is the same thing, not a mistake.
  const explicitNull = validateEvents(goodDoc({}, { pageNote: null }));
  assert.equal(explicitNull.ok, true, 'pageNote: null must be valid');
  assert.equal(explicitNull.pageNote, null, 'pageNote: null must read back as null');
});

test('a misspelled key inside pageNote is rejected with a suggestion, not ignored', () => {
  // THE REASON THIS BLOCK IS VALIDATED AT ALL. `paragraph` instead of `paragraphs`
  // would otherwise render a heading and a rule with no words under them, which on a
  // finished-looking page reads as a decision rather than as a typo.
  const result = expectReason(
    goodDoc({}, { pageNote: { heading: 'A heading', paragraph: 'One string, not a list.' } }),
    'unknown-key',
    'a misspelled pageNote key'
  );
  const detail = result.problems.find((problem) => problem.reason === 'unknown-key').detail;
  assert.match(detail, /paragraphs/, `the error must name the legal key, got: ${detail}`);
  assert.match(detail, /Did you mean "paragraphs"\?/, `a one-edit typo must be suggested, got: ${detail}`);
});

test('a pageNote with a heading and no paragraphs is REJECTED, not rendered empty', () => {
  // This is the case that matters: the validator accepts an absent block silently, so
  // "no note at all" and "a note containing nothing" must not be expressible the same
  // way. Otherwise the page grows a section header with an empty body.
  const result = expectReason(
    goodDoc({}, { pageNote: { heading: 'A heading', paragraphs: [] } }),
    'pageNote-paragraphs-empty',
    'a heading with an empty paragraphs array'
  );
  assert.match(
    result.problems.find((problem) => problem.reason === 'pageNote-paragraphs-empty').detail,
    /Delete the whole pageNote block/,
    'the error must tell the author how to express "no note at all"'
  );

  // POSITIVE CONTROL: a one-paragraph block is fine, so this is not a rule against
  // short notes.
  assert.equal(
    validateEvents(goodDoc({}, { pageNote: { heading: 'H', paragraphs: ['One.'] } })).ok,
    true,
    'positive control: a single paragraph must be accepted'
  );
});

test('a pageNote problem fails the whole file and never leaves a partial block', () => {
  // Two problems at once, COLLECTED rather than short-circuited - consistent with the
  // event loop, and for the same reason: an assistant fixing this file should see
  // everything that is wrong in one run, not one build at a time.
  const result = expectReason(
    goodDoc({}, { pageNote: { heading: '', paragraphs: ['Real text.', ''] } }),
    'pageNote-heading-empty',
    'an empty heading plus an empty paragraph'
  );

  const reasons = result.problems.map((problem) => problem.reason);
  assert.ok(
    reasons.includes('pageNote-paragraph-empty'),
    `both problems must be reported in one run, got ${JSON.stringify(reasons)}`
  );

  // The partial-object guard: one paragraph was valid, but the whole block is null,
  // so a caller that forgets to check `ok` cannot render a heading with a hole in it.
  assert.equal(result.pageNote, null, 'a rejected pageNote must never come back partially filled');
  assert.deepEqual(result.events, [], 'positive control: a rejected document yields no events either');
});

test('the real dataset carries the campaign note, and the page reads it from the data', async () => {
  assert.ok(REAL_DOC.pageNote, 'positive control: the committed dataset must carry a pageNote');
  assert.ok(REAL_DOC.pageNote.heading.length > 0, 'positive control: its heading must be non-empty');
  assert.ok(REAL_DOC.pageNote.paragraphs.length > 0, 'positive control: it must have paragraphs');

  // The page consumes the exported value rather than hardcoding the prose, which is
  // the entire reason this block lives in the data file.
  const page = await readFile(EVENTS_PAGE, 'utf8');
  const live = stripAstroComments(page);
  assert.ok(live.includes('pageNote'), 'src/pages/events.astro must read the note from the data');
  assert.ok(live.includes('closing__heading'), 'src/pages/events.astro must render the note heading');
  assert.equal(
    live.includes('Ongoing campaign activity'),
    false,
    'the campaign prose must NOT be hardcoded in the page: it belongs in data/events.json so one file holds it all'
  );
});

test('Meeting is in the vocabulary, and it is not an alias for Forum', () => {
  // The type was added when the real events replaced the placeholders, because a party
  // quarterly meeting is a scheduled gathering rather than a moderated Q&A - and the
  // chip is the first thing a reader scans. Filing it under Forum would make a filter
  // lie about its contents.
  assert.ok(EVENT_TYPES.includes('Meeting'), 'Meeting must be a legal event type');

  // POSITIVE CONTROL: the vocabulary is non-empty and every entry is distinct, so
  // "includes" above is not passing on a one-element array.
  assert.ok(EVENT_TYPES.length >= 8, `positive control: expected at least 8 types, got ${EVENT_TYPES.length}`);
  assert.equal(
    new Set(EVENT_TYPES).size,
    EVENT_TYPES.length,
    'the type vocabulary must not contain duplicates'
  );

  // And the closed set still holds: an invented type is rejected with the list.
  assert.equal(isEventType('Meeting'), true, 'Meeting must be accepted by isEventType');
  assert.equal(isEventType('meeting'), false, 'the check must stay case-sensitive');
  assert.equal(
    isEventType('Committee meeting'),
    false,
    'an invented type must still be rejected'
  );
});
