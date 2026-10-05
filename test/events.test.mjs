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
  assert.ok(result.events.length >= 7, `positive control: expected at least 7 events, got ${result.events.length}`);
  assert.equal(result.events.length, REAL_DOC.events.length, 'every event must survive validation');
  assert.equal(result.reviewedOn, '2026-10-05', 'reviewedOn must be read back from the file');

  // And every one of the seven closed types is exercised, so the sample dataset
  // actually documents the vocabulary rather than three of it.
  const present = eventTypesPresent(result.events).map((row) => row.type);
  assert.deepEqual(
    present,
    [...EVENT_TYPES],
    `the sample data should cover every type exactly as EVENT_TYPES orders them, got ${JSON.stringify(present)}`
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

test('the events page has a selection rule for every event in the data', async (t) => {
  // THE TEST THAT CATCHES THE EXPENSIVE MISTAKE.
  //
  // The panel for an event is shown by a hand-written `html:has(#event-input-<id>:checked)`
  // selector, because Astro scopes component CSS and there is no way to generate one from
  // the data. So adding an event to data/events.json WITHOUT adding its selector produces
  // a page where the row is selectable and nothing happens - the radio checks, the panel
  // stays hidden, and no error is raised anywhere. A green build, a working-looking page,
  // and a feature that silently does nothing.
  //
  // This test is the answer to "if this were broken, how would I find out?".
  const page = await readFile(EVENTS_PAGE, 'utf8');
  const result = validateEvents(REAL_DOC);
  assert.ok(result.events.length > 0, 'positive control: the dataset must yield events to check');

  const missingSelector = [];
  const missingPanel = [];
  for (const event of result.events) {
    if (!page.includes(`#event-input-${event.id}:checked`)) missingSelector.push(event.id);
    if (!page.includes(`[data-panel='${event.id}']`)) missingPanel.push(event.id);
  }

  t.diagnostic(`checked ${result.events.length} event(s) against the page's selection CSS`);
  assert.deepEqual(
    missingSelector,
    [],
    `these events have no "html:has(#event-input-<id>:checked)" rule in src/pages/events.astro, so their panel can never be shown: ${missingSelector.join(', ')}`
  );
  assert.deepEqual(
    missingPanel,
    [],
    `these events have no [data-panel='<id>'] selector in src/pages/events.astro: ${missingPanel.join(', ')}`
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
  assert.match(detail, /accepts only "events" and "reviewedOn"/, 'the error must still state the legal root keys');

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
  assert.ok(
    css.includes('.calendar') && css.includes('html:has(#event-input-'),
    'positive control: the extracted CSS must still contain this page\'s own rules, or the extraction is wrong'
  );
  const rawStyle = page.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(
    rawStyle.includes('.row') || rawStyle.includes(':global('),
    'positive control: the RAW block is expected to mention these names in the comment that explains this rule; if it no longer does, this test may be checking nothing'
  );

  t.diagnostic(`style block after comment-stripping: ${css.length} characters (raw ${rawStyle.length})`);
  for (const foreign of ['.row', '.events__item', '.events__radio']) {
    assert.equal(
      css.includes(foreign),
      false,
      `src/pages/events.astro's <style> block names "${foreign}", which belongs to src/components/EventRow.astro. ` +
        'Astro appends THIS component\'s scope id to the last compound of a selector, so the rule would compile to ' +
        `${foreign}[data-astro-cid-<events.astro>] and match nothing. Style the row from EventRow.astro's own scoped block instead.`
    );
  }

  // The other half of the same class of mistake: any `:global()` at all in this
  // page is a hand-written bet against the scope id, and every one of them so far
  // has been a losing bet.
  assert.equal(
    css.includes(':global('),
    false,
    'src/pages/events.astro uses a :global() selector. `:global()` un-scopes only what is to its LEFT; Astro still ' +
      'appends this component\'s scope id to the last compound, so the rule silently matches nothing.'
  );

  // `:has()` IS allowed, and must be: it is how the page selects a panel, and it
  // says nothing about scope. Stated so the assertion above cannot be satisfied by
  // deleting the selection mechanism, which would break the page to pass a test.
  assert.ok(
    css.includes(':has('),
    'positive control: the page must still use :has() to show the selected panel; if that changed, update this test rather than deleting it'
  );
});

test('the events page ships no <noscript> fallback and no :global() escape hatch', async (t) => {
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
  // So there is no fallback, and this test is what keeps it that way. It asserts
  // on the MARKUP, not on the comments: this file's header comment legitimately
  // mentions <noscript> at length when explaining the removal, so the text is
  // stripped of comments first. Asserting on the raw file would fail on the
  // explanation of the rule.
  const page = await readFile(EVENTS_PAGE, 'utf8');
  const live = stripAstroComments(page);

  // POSITIVE CONTROL ON THE STRIPPER, in three parts. A stripper that removed too
  // much would make every assertion below pass vacuously, and a stripper that
  // removed too little would make them fail on prose.
  assert.ok(live.length > 2000, `positive control: the stripped page should still be substantial, got ${live.length} characters`);
  assert.ok(
    live.includes('id="events-list"') && live.includes('data-panel={event.id}'),
    'positive control: the stripped text must still contain the page\'s live markup, or the comment stripper ate the template'
  );
  assert.ok(
    page.includes('<noscript') || page.includes(':global('),
    'positive control: the RAW page is expected to mention at least one of these inside its explanatory comments; ' +
      'if it no longer does, this test may be checking nothing'
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
    live.includes(':global('),
    false,
    'src/pages/events.astro uses :global() in its style block, which cannot reach another component\'s elements. ' +
      'See the test above for the full explanation; this one exists so the escape hatch is also caught at the markup level.'
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

  // POSITIVE CONTROL ON THE CLAIM ITSELF, from the data rather than from the prose:
  // it is only a lie because those rows really lack the fields, so the absence is
  // asserted against the committed dataset. If every event gained an artwork field
  // tomorrow this test would still pass, which is correct - the sentence would
  // then be true.
  const withArtwork = REAL_DOC.events.filter((e) => e.thumbnail).length;
  const withBanner = REAL_DOC.events.filter((e) => e.banner).length;
  t.diagnostic(`events with a thumbnail: ${withArtwork}/${REAL_DOC.events.length}; with a banner: ${withBanner}/${REAL_DOC.events.length}`);
  assert.ok(
    withArtwork < REAL_DOC.events.length && withBanner < REAL_DOC.events.length,
    'positive control: this test is only meaningful while some rows lack artwork; if every row now has both, update the test to assert the data rather than the prose'
  );
});

test('months.ts and articles.ts carry the same month table', async () => {
  // src/lib/months.ts documents that articles.ts still has its own copy, and that a
  // refactor of articles.ts is a one-line change left to whoever owns that file. Two
  // copies of a table that decides how every date on the site reads WILL drift unless
  // something fails when they do. This is that something.
  const monthsSource = await readFile(MONTHS_MODULE, 'utf8');
  const articlesSource = await readFile(resolve(PROJECT_ROOT, 'src', 'lib', 'articles.ts'), 'utf8');

  const extract = (source) => {
    const match = source.match(/MONTHS\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(match, 'could not find a MONTHS array; if it moved, update this test rather than deleting it');
    return match[1].match(/'([^']+)'/g).map((quoted) => quoted.slice(1, -1));
  };

  assert.deepEqual(
    extract(monthsSource),
    extract(articlesSource),
    'the two MONTHS tables have drifted apart; a date would render differently on the events page than on the reading room'
  );
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
    'src/pages/events.astro',
    'src/components/EventRow.astro',
    'scripts/check-events.mjs',
    'test/events.test.mjs'
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
