// test/placeholders.test.mjs - the generated placeholder artwork, proven rather
// than eyeballed.
//
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS FOR
// ---------------------------------------------------------------------------
//
// scripts/make-placeholders.mjs draws one image per event. Almost everything it
// draws is a matter of taste and none of it can break a build, so what is
// asserted here is not the picture. It is the five properties that decide whether
// the script is safe to run again next month:
//
//   1. IT NEVER DESTROYS ARTWORK. A real photograph dropped into
//      public/img/events/ must survive someone re-running the generator. This is
//      the only assertion in the file that would cost real work if it broke, and
//      it is the reason the script has a --force flag instead of just overwriting.
//
//   2. IT ONLY TOUCHES .svg. A .jpg in the data is a photograph somebody took.
//
//   3. IT IS DETERMINISTIC. Twelve files that change every time the script runs
//      are twelve files nobody can review in a diff, which means twelve files
//      nobody will review at all.
//
//   4. EVERY BANNER SAYS PLACEHOLDER. This is the one that stops the page looking
//      finished when it is not, and it is therefore the one most likely to be
//      "tidied up" by somebody who thinks it is noise.
//
//   5. THE SIZES ARE THE COMPONENTS' SIZES. EventDetail.astro declares
//      1600x600 and EventRow.astro declares 480x320. A plate at the wrong
//      dimensions is scaled by the browser and the type comes out soft.
//
// Design rule 7: this suite writes ONLY into a throwaway directory under the
// system temp directory. It reads the committed dataset and the committed
// public/ files, and it never writes to public/, to data/, or to any real image.
// ---------------------------------------------------------------------------

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A REAL XML PARSER, not a regex. fast-xml-parser is already a dependency of this
// project (package.json lists it for the feed reader), so using it here adds
// nothing to install and gives a real grammar check rather than a structural
// approximation. See the note above the XML test for why a structural check was
// considered and rejected.
import { XMLValidator } from 'fast-xml-parser';

import {
  BANNER,
  THUMB,
  bannerDateLine,
  decideTarget,
  escapeXml,
  generate,
  parseArgs,
  renderBanner,
  renderThumb,
  resolveInside,
  thumbDateLine,
  writeImage
} from '../scripts/make-placeholders.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const PUBLIC_DIR = resolve(PROJECT_ROOT, 'public');

/**
 * The throwaway root for every write this suite makes.
 *
 * Under the system temp directory, never under public/. A test that writes into
 * public/ is a test that can delete a committed photograph, and this suite has a
 * whole test about not doing exactly that - it would be poor form for the test
 * enforcing it to be the thing that does it.
 */
const SANDBOX = join(tmpdir(), 'opencode', 'placeholders-test');

after(async () => {
  await rm(SANDBOX, { recursive: true, force: true });
});

/** A fresh empty sandbox directory, unique per test, so tests cannot collide. */
async function sandbox(name) {
  const dir = join(SANDBOX, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The real committed dataset, so the tests use events an author would write. */
const REAL_DOC = JSON.parse(await readFile(resolve(PROJECT_ROOT, 'data', 'events.json'), 'utf8'));
const REAL_EVENTS = REAL_DOC.events;

/** Every image path the committed data declares, with the field that declared it. */
function declaredPaths(events) {
  const out = [];
  for (const event of events) {
    for (const field of ['thumbnail', 'banner']) {
      const value = event[field];
      if (value === null || value === undefined || value === '') continue;
      out.push({ id: event.id, field, declared: value, full: resolveInside(PUBLIC_DIR, value) });
    }
  }
  return out;
}

/**
 * An event that is complete, so a test can break exactly one field.
 *
 * The id is deliberately the shape of a real one, and startsAt is a plain
 * all-day date, which is the case the whole events dataset is built from.
 */
function goodEvent(overrides = {}) {
  return {
    id: 'test-event',
    name: 'A Test Event',
    startsAt: '2026-11-14',
    endsAt: null,
    thumbnail: '/img/events/test-event-thumb.svg',
    banner: '/img/events/test-event-banner.svg',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// The positive control for the whole suite
// ---------------------------------------------------------------------------

test('the committed dataset yields twelve declared images, all present and non-empty', async (t) => {
  // POSITIVE CONTROL, and it comes first on purpose. Almost every test below is a
  // negative one: a .jpg must be skipped, a null must be skipped, an existing file
  // must be left alone. An implementation that skipped EVERYTHING would pass all
  // of them, and the page would render no artwork at all while the suite is green.
  // So this asserts that the real run really did produce all twelve, at the sizes
  // the components declare, before any of the refusal logic is trusted.
  const publicDir = await sandbox('positive-control');
  const result = await generate(REAL_EVENTS, { publicDir });

  t.diagnostic(`events: ${REAL_EVENTS.length}, declared images: ${declaredPaths(REAL_EVENTS).length}`);

  assert.ok(
    Array.isArray(REAL_EVENTS) && REAL_EVENTS.length > 0,
    'positive control: the committed dataset must hold at least one event'
  );
  assert.equal(
    declaredPaths(REAL_EVENTS).length,
    REAL_EVENTS.length * 2,
    'positive control: every committed event must declare both a thumbnail and a banner, or the "twelve images" claim below is wrong'
  );

  const wrote = result.rows.filter((row) => row.action === 'wrote');
  assert.equal(
    wrote.length,
    REAL_EVENTS.length * 2,
    `positive control: a fresh sandbox run must write one image per declared path, got ${wrote.length}`
  );
  assert.deepEqual(
    result.problems,
    [],
    `positive control: a fresh run over the committed data must report no problems, got ${JSON.stringify(result.problems)}`
  );

  // And the files it wrote are really on disk, and really non-empty. Asserted
  // here rather than only in the dedicated test so that the negative tests below
  // are known to be running against a generator that does produce artwork.
  for (const row of wrote) {
    const info = await stat(row.full);
    assert.ok(info.isFile(), `positive control: ${row.path} must have been written as a file`);
    assert.ok(info.size > 0, `positive control: ${row.path} must not be an empty file, got ${info.size} bytes`);
  }
});

// ---------------------------------------------------------------------------
// 1. Every declared path exists, and every generated file is non-empty
// ---------------------------------------------------------------------------

test('every image path the data declares exists on disk and is not empty', async () => {
  const declared = declaredPaths(REAL_EVENTS);

  // POSITIVE CONTROL: the walk found the paths, so a loop that matched nothing
  // cannot pass vacuously by iterating over an empty list.
  assert.ok(declared.length > 0, `positive control: the committed data must declare at least one image path, got ${declared.length}`);
  assert.ok(
    declared.every((row) => row.full !== null),
    `positive control: every declared path must resolve inside public/, and these did not: ${JSON.stringify(declared.filter((r) => r.full === null))}`
  );

  for (const row of declared) {
    const info = await stat(row.full);
    assert.ok(info.isFile(), `${row.id}.${row.field}: ${row.declared} must exist as a file, not a directory`);
    assert.ok(
      info.size > 0,
      `${row.id}.${row.field}: ${row.declared} exists but is empty at ${info.size} bytes. An empty image file is a broken image icon, which is the exact thing this script exists to prevent.`
    );
  }

  // Counted, but DERIVED from the dataset rather than hardcoded. The previous
  // form asserted the literal 12 with the message "6 events x 2", so adding a
  // legitimate seventh event failed a suite that was otherwise correct. The
  // invariant worth protecting is that every event declares BOTH a thumbnail and
  // a banner, not how many events there happen to be today.
  assert.equal(
    declared.length,
    REAL_EVENTS.length * 2,
    `every event must declare a thumbnail and a banner (${REAL_EVENTS.length} events x 2), got ${declared.length}`
  );

  // The written files are the ONLY .svg files this script is responsible for. The
  // directory also holds older placeholders for events that have since been
  // removed from the data, and they are deliberately left in place: the orphan
  // cleanup belongs to whoever owns the data, not to a generator.
  const onDisk = await readdir(join(PUBLIC_DIR, 'img', 'events'));
  const svgCount = onDisk.filter((name) => name.endsWith('.svg')).length;
  assert.ok(
    svgCount >= declared.length,
    `positive control: public/img/events must hold at least the ${declared.length} declared images, got ${svgCount}`
  );
});

// ---------------------------------------------------------------------------
// 2. ASCII, and valid XML
// ---------------------------------------------------------------------------

test('every generated file is pure ASCII and parses as XML', async (t) => {
  // WHY A REAL PARSER. fast-xml-parser is already a dependency (package.json), so
  // a hand-rolled tag-balance check would have added nothing but a second, worse
  // opinion about what valid XML is. XMLValidator is a real SAX parser: it fails
  // on an unclosed tag, a mismatched close, a bad attribute, an unescaped ampersand
  // and a stray "<" in text content, all of which are ways this script could emit a
  // document that no browser will render.
  //
  // ASCII is checked against the BYTES, not by eyeballing the text. The failure
  // this guards against is not a style rule: an em dash or a no-break space that
  // reaches a generated image is invisible in a diff preview and is the documented
  // way files get silently corrupted on this machine. The diagnostic prints the
  // file and the byte offset so a failure is actionable.

  // POSITIVE CONTROL ON THE PARSER, FIRST AND EXPLICIT. A validator that returned
  // true for everything would make every assertion below meaningless, so it is
  // given two documents it MUST reject. An unclosed tag, and a raw ampersand.
  const mustReject = {
    '<svg><text>oops</svg>': 'an unclosed <text> element',
    '<svg><title>A & B</title></svg>': 'an unescaped ampersand in text content'
  };
  for (const [document, why] of Object.entries(mustReject)) {
    const verdict = XMLValidator.validate(document);
    assert.notEqual(
      verdict,
      true,
      `positive control: the XML parser must REJECT ${why}. It accepted ${JSON.stringify(document)}, so the validity check below would prove nothing.`
    );
  }

  // And it must accept something shaped exactly like what we generate, or the
  // negative control above is only showing that it rejects everything.
  const shapedLike = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>ok</title><rect width="10" height="10"/></svg>';
  assert.equal(
    XMLValidator.validate(shapedLike),
    true,
    'positive control: the parser must ACCEPT a well-formed SVG of the same shape this script emits'
  );
  t.diagnostic('parser proven: rejects an unclosed tag and a raw ampersand, accepts a well-formed SVG');

  const declared = declaredPaths(REAL_EVENTS);
  assert.ok(declared.length > 0, 'positive control: the walk must find the declared paths');

  for (const row of declared) {
    const bytes = await readFile(row.full);

    // ---- ASCII, checked on the bytes ----
    const offenders = [];
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] > 127) {
        offenders.push(`byte ${i} is 0x${bytes[i].toString(16).toUpperCase().padStart(2, '0')}`);
        break;
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `${row.declared} must be pure ASCII. Non-ASCII bytes:\n  ${offenders.join('\n  ')}`
    );

    // And on the code points as well, because a UTF-8 multi-byte sequence is
    // several bytes and the byte check above finds only the first of them. Two
    // checks that sound redundant are not: they fail on different corruption.
    const text = bytes.toString('utf8');
    const wide = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) > 127) {
        wide.push(`offset ${i} is U+${text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`);
        break;
      }
    }
    assert.deepEqual(wide, [], `${row.declared} must decode to pure ASCII code points:\n  ${wide.join('\n  ')}`);

    // ---- valid XML ----
    const verdict = XMLValidator.validate(text);
    assert.equal(
      verdict,
      true,
      `${row.declared} must be well-formed XML. The parser said: ${JSON.stringify(verdict)}`
    );

    // And the two things a parser will happily accept that a browser will not
    // render, which are the actual failure modes of a generated SVG.
    assert.ok(text.startsWith('<svg '), `${row.declared} must begin with an <svg> element`);
    assert.ok(text.trimEnd().endsWith('</svg>'), `${row.declared} must end with </svg>`);
    assert.equal(
      text.includes('foreignObject'),
      false,
      `${row.declared} must not use <foreignObject>. An SVG loaded through <img> runs in a restricted mode where it will not render.`
    );
    assert.equal(
      text.includes('textLength'),
      false,
      `${row.declared} must not use textLength with lengthAdjust: stretching glyphs to fill a width distorts them, and distorted type reads as a broken page rather than as a placeholder.`
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Determinism
// ---------------------------------------------------------------------------

test('rendering the same event twice produces byte-identical output, and different events do not', async (t) => {
  // The renderers are PURE, so this needs no disk and no ordering: it calls them.
  //
  // THE SECOND HALF MATTERS AS MUCH AS THE FIRST. A "deterministic" function that
  // returns a constant passes the first half perfectly while producing twelve
  // identical images, which would be worse than no artwork at all - every event on
  // the page would carry the same name. So a second, DIFFERENT event is asserted
  // to render DIFFERENT bytes.
  const event = REAL_EVENTS[0];

  const first = renderBanner(event);
  const second = renderBanner(event);
  assert.equal(
    first.svg,
    second.svg,
    'renderBanner must be pure: two calls on one event must produce identical strings'
  );
  assert.equal(
    Buffer.byteLength(first.svg, 'utf8'),
    Buffer.byteLength(second.svg, 'utf8'),
    'the two renders must also agree on length, which catches a trailing-newline difference a string compare would too easily forgive'
  );

  const thumbFirst = renderThumb(event);
  const thumbSecond = renderThumb(event);
  assert.equal(thumbFirst.svg, thumbSecond.svg, 'renderThumb must be pure in the same way');

  // A DIFFERENT event must produce different bytes, or determinism has been proved
  // by the cheapest possible means.
  const other = REAL_EVENTS.find((candidate) => candidate.name !== event.name);
  assert.ok(other !== undefined, 'positive control: the committed data must hold a second, differently named event');
  const otherBanner = renderBanner(other);
  assert.notEqual(
    otherBanner.svg,
    first.svg,
    `two different events must render different banners. Both rendered "${event.name}" as "${other.name}", so this proves nothing.`
  );
  assert.notEqual(
    renderThumb(other).svg,
    thumbFirst.svg,
    'two different events must render different thumbnails, for the same reason'
  );

  // And the committed files on disk must BE what the renderer produces, which is
  // the property that actually makes the files reviewable: if somebody edits a
  // generated SVG by hand, the next run must either rewrite it identically or say
  // it skipped it, and the committed bytes must be reproducible either way.
  const declared = declaredPaths(REAL_EVENTS);
  for (const row of declared) {
    const event2 = REAL_EVENTS.find((candidate) => candidate.id === row.id);
    const rendered = row.field === 'banner' ? renderBanner(event2) : renderThumb(event2);
    const onDisk = await readFile(row.full, 'utf8');
    assert.equal(
      onDisk,
      rendered.svg,
      `${row.declared} on disk must be byte-identical to a fresh render of ${row.id}. If this fails, either the file was hand-edited or the renderer is not deterministic.`
    );
  }
  t.diagnostic(`reproduced ${declared.length} committed files byte for byte from the renderer`);
});

// ---------------------------------------------------------------------------
// 4. PLACEHOLDER on every banner
// ---------------------------------------------------------------------------

test('every banner carries the word PLACEHOLDER, and no thumbnail claims to be artwork', async (t) => {
  // This is the property that stops the page looking finished when it is not. It
  // is asserted on the COMMITTED FILES and not only on fresh renders, because the
  // failure it guards against is somebody deleting the tag to "tidy up" a file that
  // the generator will not rewrite until it is deleted.
  const banners = declaredPaths(REAL_EVENTS).filter((row) => row.field === 'banner');
  const thumbs = declaredPaths(REAL_EVENTS).filter((row) => row.field === 'thumbnail');

  // POSITIVE CONTROL: both lists are non-empty, so the loop below is a real check.
  assert.ok(banners.length > 0, `positive control: the committed data must declare at least one banner, got ${banners.length}`);
  assert.ok(thumbs.length > 0, `positive control: the committed data must declare at least one thumbnail, got ${thumbs.length}`);

  for (const row of banners) {
    const text = await readFile(row.full, 'utf8');
    assert.ok(
      text.includes('>PLACEHOLDER</text>'),
      `${row.declared} must set the word PLACEHOLDER as its own text element. An event banner without it reads as finished artwork, which is the exact lie this file exists to prevent.`
    );
    // In letterspaced capitals, which is how it reads as a printed stamp rather
    // than as a label somebody added.
    assert.ok(
      /letter-spacing="[0-9.]+"[^>]*>PLACEHOLDER</.test(text),
      `${row.declared} must set PLACEHOLDER with letter-spacing, so it reads as a stamp`
    );
    // And it must be in the ACCENT colour, not in the body ink: a marker drawn in
    // the same colour as the headline is a caption, and a caption gets ignored.
    assert.ok(
      /fill="#[0-9a-f]{6}"[^>]*>PLACEHOLDER</.test(text),
      `${row.declared} must set PLACEHOLDER in its own colour`
    );
  }

  // A thumbnail is 72 pixels wide. The spec is that it carries the day and the
  // month and NOTHING ELSE, and the reason is worth stating: an event name set at
  // a size that fits 72 pixels is a size nobody can read, and illegible text is
  // worse than no text, because it looks like an attempt.
  for (const row of thumbs) {
    const text = await readFile(row.full, 'utf8');
    const event = REAL_EVENTS.find((candidate) => candidate.id === row.id);
    const texts = [...text.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1].trim());
    assert.equal(
      texts.length,
      1,
      `${row.declared} must set exactly one run of text, got ${texts.length}: ${JSON.stringify(texts)}`
    );
    assert.equal(
      texts[0],
      thumbDateLine(event),
      `${row.declared} must carry only the day and month, and the same spelling thumbDateLine produces`
    );
    assert.equal(
      texts[0].includes(event.name),
      false,
      `${row.declared} must not carry the event name at 72 pixels wide: "${texts[0]}" contains "${event.name}"`
    );
  }
  t.diagnostic(`${banners.length} banners stamped PLACEHOLDER, ${thumbs.length} thumbnails carrying day and month only`);
});

// ---------------------------------------------------------------------------
// 5. The refuse-to-overwrite property
// ---------------------------------------------------------------------------

test('an existing file is left byte-for-byte alone unless --force is given', async () => {
  // THE TEST THAT MATTERS MOST IN THIS FILE.
  //
  // The scenario: somebody replaces a placeholder with a real photograph, and
  // later runs `node scripts/make-placeholders.mjs` out of habit. If that run
  // overwrites the photograph, the work is gone and nothing said so.
  //
  // Every write in this test goes to a throwaway sandbox. A test that proved this
  // property by writing to public/ would be risking the thing it is proving.
  const publicDir = await sandbox('overwrite');
  const target = join(publicDir, 'img', 'events', 'a-real-photograph.svg');
  await mkdir(dirname(target), { recursive: true });

  // Content chosen so that ANY modification is visible, including a rewrite with
  // identical-looking type: it is not valid SVG and it is not what we generate.
  const PHOTOGRAPH = 'THIS IS A REAL PHOTOGRAPH, SUBMITTED BY A CONTRIBUTOR, AND IT MATTERS.\n';
  await writeFile(target, PHOTOGRAPH, 'utf8');

  const event = goodEvent({ id: 'a-real-event', banner: '/img/events/a-real-photograph.svg', thumbnail: null });

  // ---- the refusal ----
  const refused = await generate([event], { publicDir });
  const afterRefusal = await readFile(target, 'utf8');
  assert.equal(
    afterRefusal,
    PHOTOGRAPH,
    'the existing file must be UNCHANGED after a run with no --force. This is the property that protects real artwork.'
  );
  assert.notEqual(
    afterRefusal,
    renderBanner(event).svg,
    'positive control: the file on disk must NOT already be what the generator would write, or "unchanged" proves nothing'
  );

  // And the run must have REPORTED the skip, not silently done nothing. A refusal
  // nobody is told about is indistinguishable from a bug.
  const skipRow = refused.rows.find((row) => row.path === '/img/events/a-real-photograph.svg');
  assert.ok(skipRow !== undefined, `the run must report a row for the skipped path, got ${JSON.stringify(refused.rows)}`);
  assert.equal(skipRow.action, 'skipped', 'the row must be reported as a skip, not as a write');
  assert.equal(skipRow.reason, 'already-exists', 'the reason must name the existing file, so a reader knows a photograph is safe');
  assert.deepEqual(refused.problems, [], 'skipping an existing file is correct behaviour, not a problem');

  // ---- and the explicit override ----
  //
  // --force is tested for the opposite property: that it DOES replace the file.
  // A --force that quietly did nothing would leave somebody believing they had
  // regenerated the artwork when they had not.
  const forced = await generate([event], { publicDir, force: true });
  const afterForce = await readFile(target, 'utf8');
  assert.equal(afterForce, renderBanner(event).svg, '--force must replace the file with the rendered plate');
  assert.notEqual(afterForce, PHOTOGRAPH, '--force must have destroyed the previous content, which is exactly what the flag warns about');
  const forceRow = forced.rows.find((row) => row.path === '/img/events/a-real-photograph.svg');
  assert.equal(forceRow.action, 'forced', 'the report must distinguish a forced write from an ordinary one');

  // ---- writeImage directly, so the rule is proven at the unit that owns it ----
  await writeFile(target, PHOTOGRAPH, 'utf8');
  const direct = await writeImage(target, '<svg/>', {});
  assert.equal(direct.action, 'skipped', 'writeImage with no force must skip an existing file');
  assert.equal(await readFile(target, 'utf8'), PHOTOGRAPH, 'and must leave the bytes alone');
  const directForced = await writeImage(target, '<svg/>', { force: true });
  assert.equal(directForced.action, 'forced', 'writeImage with force must overwrite');

  // ---- and the flag is discoverable ----
  //
  // A destructive flag nobody can find is a destructive flag nobody will use
  // deliberately, and the header has to say what it costs.
  assert.deepEqual(parseArgs([]), { force: false, data: resolve(PROJECT_ROOT, 'data', 'events.json'), help: false }, 'no arguments must mean no force');
  assert.equal(parseArgs(['--force']).force, true, '--force must be accepted');
  assert.equal(parseArgs(['-f']).force, true, '-f must be accepted as the short form');
  assert.throws(() => parseArgs(['--nope']), /unknown argument/, 'an unknown argument must be refused rather than ignored');
});

// ---------------------------------------------------------------------------
// 6. Non-.svg and null paths
// ---------------------------------------------------------------------------

test('a .jpg is skipped as real artwork and a null is skipped as absent, and neither is confused with an absent .svg', async (t) => {
  // THREE CASES THAT MUST NOT COLLAPSE INTO ONE:
  //
  //   .jpg            a REAL PHOTOGRAPH. Overwriting it with a typographic plate
  //                   destroys work, and no error would be raised while it happened.
  //   null            a MEANINGFUL ABSENCE. The schema models it, the components
  //                   render around it, and inventing a file would destroy the
  //                   information that there is no artwork for this event.
  //   absent .svg     the ordinary case: this is exactly what the script is for,
  //                   and it must be the one that gets written.
  //
  // A test that only checked the first two would pass against a script that skips
  // everything. The absent .svg is the positive control that makes the two skips
  // mean something.

  // ---- the decisions, on the unit that owns them ----
  assert.deepEqual(
    decideTarget('banner', '/img/events/foo.jpg'),
    { action: 'skip', reason: 'not-svg' },
    'a .jpg must be skipped, and the reason must say it is not an SVG'
  );
  assert.deepEqual(
    decideTarget('banner', '/img/events/foo.png'),
    { action: 'skip', reason: 'not-svg' },
    'a .png is equally a real image'
  );
  assert.deepEqual(
    decideTarget('banner', '/img/events/foo.SVG'),
    { action: 'render', reason: null },
    'the extension test must not be case-sensitive: a .SVG is still a placeholder this script owns'
  );

  // ---- and the reasons must be DISTINGUISHABLE ----
  const reasons = new Set([
    decideTarget('banner', '/img/events/foo.jpg').reason,
    decideTarget('banner', null).reason,
    decideTarget('banner', '/img/events/foo.svg').reason
  ]);
  t.diagnostic(`reasons: ${[...reasons].map((r) => String(r)).join(', ')}`);
  assert.equal(
    reasons.size,
    3,
    `a .jpg, a null and an absent .svg must produce three DIFFERENT reasons, got ${JSON.stringify([...reasons])}. ` +
      'Two of them being the same is how a photograph and an absence get confused in the report.'
  );
  assert.equal(decideTarget('banner', '/img/events/foo.jpg').reason !== 'null-path', true, 'a .jpg must NOT be reported as a null path');

  // ---- null in all its forms ----
  for (const value of [null, undefined, '', '   ']) {
    assert.deepEqual(
      decideTarget('thumbnail', value),
      { action: 'skip', reason: 'null-path' },
      `${JSON.stringify(value)} must be skipped as a null path`
    );
  }

  // ---- end to end, on the run, in a sandbox ----
  const publicDir = await sandbox('skips');

  // An event with a real photograph for its banner and nothing for its thumbnail.
  const withPhoto = goodEvent({
    id: 'has-a-photograph',
    name: 'An Event With A Photograph',
    banner: '/img/events/winners/real-campaign-photo.jpg',
    thumbnail: null
  });
  const photoRun = await generate([withPhoto], { publicDir });
  const photoRows = photoRun.rows;
  assert.equal(photoRows.length, 2, 'both fields must produce a row, so neither is silently dropped');
  assert.deepEqual(
    photoRows.map((row) => `${row.field}:${row.reason}`).sort(),
    ['banner:not-svg', 'thumbnail:null-path'],
    `the report must distinguish a photograph from an absence, got ${JSON.stringify(photoRows.map((r) => [r.field, r.reason]))}`
  );
  assert.deepEqual(photoRun.problems, [], 'a photograph and an absence are both correct outcomes, not problems');
  // Nothing was created for either field. Asserted by asking the disk, because a
  // skip that still wrote a file would satisfy every assertion above.
  await assert.rejects(
    () => stat(join(publicDir, 'img', 'events', 'winners', 'real-campaign-photo.jpg')),
    'the .jpg must not have been created'
  );
  await assert.rejects(
    () => stat(join(publicDir, 'img', 'events', 'has-a-photograph-thumb.svg')),
    'the null thumbnail must not have been created'
  );

  // POSITIVE CONTROL, in the same run and the same report: an absent .svg IS
  // written. If this were skipped too, the two skip rules above would be
  // indistinguishable from "refuse everything".
  const control = goodEvent({ id: 'control', name: 'Control Event', banner: '/img/events/control-banner.svg', thumbnail: null });
  const controlRun = await generate([control], { publicDir });
  const controlRow = controlRun.rows.find((row) => row.path === '/img/events/control-banner.svg');
  assert.ok(controlRow !== undefined, 'the control event must produce a row');
  assert.equal(
    controlRow.action,
    'wrote',
    `an absent .svg MUST be written. If this is skipped, the null and .jpg skips above prove nothing.`
  );
  assert.equal(controlRow.reason, null, 'a written row must carry no skip reason');
  assert.ok(
    (await stat(controlRow.full)).size > 0,
    'and the file must actually be on disk and non-empty'
  );
});

// ---------------------------------------------------------------------------
// 7. The declared sizes
// ---------------------------------------------------------------------------

test('every banner is 1600x600 and every thumbnail is 480x320, as the components declare', async () => {
  // These are not preferences. EventDetail.astro has width="1600" height="600"
  // on .detail__image and EventRow.astro has width="480" height="320" on
  // .row__image. A plate at the wrong intrinsic size is rescaled by the browser,
  // and a 1600-wide plate rendered at 480 wide is soft type in a row of an
  // otherwise sharp page.
  //
  // Read back from the file's own viewBox, width and height - all three - rather
  // than from the renderer's own constants. Asserting against the constants would
  // pass even if the renderer emitted the wrong number into the SVG.
  const declared = declaredPaths(REAL_EVENTS);
  assert.ok(declared.length > 0, 'positive control: the walk must find the declared paths');

  assert.deepEqual(BANNER, { width: 1600, height: 600 }, 'the banner size must be 1600x600');
  assert.deepEqual(THUMB, { width: 480, height: 320 }, 'the thumbnail size must be 480x320');

  for (const row of declared) {
    const text = await readFile(row.full, 'utf8');
    const expected = row.field === 'banner' ? BANNER : THUMB;
    const label = row.field === 'banner' ? 'banner' : 'thumbnail';

    assert.ok(
      text.includes(`viewBox="0 0 ${expected.width} ${expected.height}"`),
      `${row.declared}: the ${label} viewBox must be "0 0 ${expected.width} ${expected.height}", got ${JSON.stringify(text.match(/viewBox="[^"]*"/))}`
    );
    assert.ok(
      text.includes(`width="${expected.width}" height="${expected.height}"`),
      `${row.declared}: the ${label} must declare width="${expected.width}" height="${expected.height}"`
    );

    // Negative control on the check: a wrong number must NOT satisfy it, or the
    // assertions above are matching a substring that appears in any size.
    assert.equal(
      text.includes(`viewBox="0 0 ${expected.width + 1} ${expected.height}"`),
      false,
      `${row.declared}: the ${label} must not carry the off-by-one viewBox, which would mean the check above matches any number`
    );
  }

  // And the renderer agrees with what it wrote, so a future change to one without
  // the other fails here rather than in a browser.
  for (const event of REAL_EVENTS) {
    assert.deepEqual(
      [renderBanner(event).width, renderBanner(event).height],
      [1600, 600],
      `renderBanner(${event.id}) must report 1600x600`
    );
    assert.deepEqual(
      [renderThumb(event).width, renderThumb(event).height],
      [480, 320],
      `renderThumb(${event.id}) must report 480x320`
    );
  }
});

// ---------------------------------------------------------------------------
// 8. The long name fits, and the span date is a span
// ---------------------------------------------------------------------------

test('the longest event name fits in three lines with no overflow, and a multi-day event gets a span', async (t) => {
  const LONGEST = 'Greenville County Republican Party Quarterly Meeting';

  // POSITIVE CONTROL: the committed data must actually contain that name, or the
  // test is asserting against a fixture the page never shows.
  const longest = REAL_EVENTS.find((event) => event.name === LONGEST);
  assert.ok(longest !== undefined, `the committed data must contain an event named "${LONGEST}", got ${JSON.stringify(REAL_EVENTS.map((e) => e.name))}`);

  const banner = renderBanner(longest);
  assert.ok(banner.nameLines.length > 0, 'positive control: the name must produce at least one line');
  assert.ok(
    banner.nameLines.join(' ').replace(/\s+/g, ' ').trim() === LONGEST,
    `positive control: the wrapped lines must reconstruct the name exactly, got ${JSON.stringify(banner.nameLines)}. ` +
      'A wrapper that drops or duplicates a word would otherwise pass a line-count check.'
  );
  assert.ok(
    banner.nameLines.length <= 3,
    `the longest name must wrap to at most 3 lines, got ${banner.nameLines.length}: ${JSON.stringify(banner.nameLines)}`
  );
  assert.equal(
    banner.overflow,
    false,
    `the longest name must not overflow: ${JSON.stringify({ size: banner.nameSize, lines: banner.nameLines })}`
  );

  // The overflow flag must be REAL, not hard-wired false. A flag that is always
  // false would satisfy every assertion in this section while the layout was
  // broken, which is the shape of an assertion that has stopped testing anything.
  //
  // The fixture has to be genuinely unrenderable, and the first attempt at this was
  // not: three 34-character words wrap to three lines at the 20px floor and fit the
  // 1376px column easily, so the layout was CORRECT to report no overflow and the
  // assertion was wrong rather than the code. What cannot fit is a single token
  // with no break opportunity in it, longer than the column even at the smallest
  // size the search will use - because the wrapper deliberately never hyphenates.
  const unbreakable = 'q'.repeat(400);
  const impossible = renderBanner(goodEvent({ id: 'impossible', name: unbreakable }));
  assert.equal(
    impossible.nameLines.length,
    1,
    'positive control: a single 400-character token must stay on one line, because the wrapper never hyphenates'
  );
  assert.equal(
    impossible.overflow,
    true,
    'positive control: a single token 400 characters long MUST be reported as overflowing, or the overflow flag is decorative'
  );
  assert.equal(
    impossible.nameSize,
    20,
    'positive control: and it must have fallen through to the floor size, so the overflow comes from the width check and not from some other path'
  );

  // ---- the run must report no overflow for the real data ----
  //
  // Asserted over generate() rather than only over the renderers, because the run
  // is what a person sees, and a warning that is computed and then dropped on the
  // floor is not a warning.
  const publicDir = await sandbox('long-name');
  const run = await generate(REAL_EVENTS, { publicDir });
  const overflowProblems = run.problems.filter((problem) => problem.reason.startsWith('text-overflow'));
  assert.deepEqual(
    overflowProblems,
    [],
    `no event's text may overflow. Offending events: ${JSON.stringify(overflowProblems)}`
  );

  // ---- the multi-day span ----
  // "Multi-day" means the two ends land on DIFFERENT DATES. Testing
  // `endsAt !== startsAt` is not the same condition: a timed event with a start
  // and an end on one day (18:30 to 20:30) satisfies it and is correctly rendered
  // as a single date, so that filter picked an event that could not and should not
  // print a span. Comparing the date part is the condition the renderer branches
  // on.
  const dayOf = (value) => value.slice(0, 10);
  const span = REAL_EVENTS.find(
    (event) => event.endsAt !== null && dayOf(event.endsAt) !== dayOf(event.startsAt)
  );
  assert.ok(span !== undefined, 'the committed data must contain an event spanning two or more days, or the span assertions below prove nothing');

  const dateLine = bannerDateLine(span);
  t.diagnostic(`${span.id}: ${span.startsAt} to ${span.endsAt} renders as "${dateLine}"`);

  assert.ok(dateLine.includes(' - '), `a multi-day event must print a span, got "${dateLine}"`);
  assert.ok(
    dateLine.includes(span.startsAt.slice(8, 10)),
    `the span must open with the start day, got "${dateLine}"`
  );
  assert.ok(
    dateLine.includes(span.endsAt.slice(8, 10)),
    `the span must carry the end day, got "${dateLine}"`
  );
  // The shape a same-month span takes: the month is printed ONCE, after the
  // range. This is an assertion about the REAL span in the data, and it is
  // correct for that span.
  //
  // It was previously the ONLY shape the function was allowed to produce, which
  // meant it also forbade the correct output for a span crossing a month or year
  // boundary - a test enforcing a bug. Those shapes are asserted separately below
  // against synthetic events, so the real-data assertion stays narrow and the
  // boundary cases stop being untested.
  assert.ok(
    /^[0-9]{1,2} - [0-9]{1,2} [A-Z]+ [0-9]{4}$/.test(dateLine),
    `a same-month span must read "D - D MONTH YEAR", month printed once. Got "${dateLine}".`
  );

  // The boundaries the committed data happens not to exercise. Synthetic on
  // purpose: no real event spans these, and the previous test let that gap hide a
  // bug that rendered `28 - 4 OCTOBER 2026` for a window ending in November.
  const boundaryCases = [
    { id: 'month', startsAt: '2026-10-28', endsAt: '2026-11-04', expect: '28 OCTOBER - 4 NOVEMBER 2026' },
    { id: 'year', startsAt: '2026-12-28', endsAt: '2027-01-04', expect: '28 DECEMBER 2026 - 4 JANUARY 2027' },
  ];
  for (const boundary of boundaryCases) {
    const got = bannerDateLine({ startsAt: boundary.startsAt, endsAt: boundary.endsAt, allDay: true });
    assert.equal(
      got,
      boundary.expect,
      `a span crossing a ${boundary.id} boundary must name both months and both years`
    );
  }
  assert.ok(
    renderBanner(span).svg.includes(dateLine),
    'the banner must carry that span as drawn text, not compute it and drop it'
  );

  // POSITIVE CONTROL on the span: a single-date event must NOT get a span. If it
  // did, the assertions above would pass for a function that always prints one.
  const single = REAL_EVENTS.find((event) => event.endsAt === null);
  assert.ok(single !== undefined, 'the committed data must contain an event with no end date');
  assert.equal(
    bannerDateLine(single).includes(' - '),
    false,
    `a single-date event must not print a span, got "${bannerDateLine(single)}"`
  );

  // ---- and every banner overflows nothing, checked one by one ----
  for (const event of REAL_EVENTS) {
    const rendered = renderBanner(event);
    assert.equal(
      rendered.overflow,
      false,
      `${event.id}: the banner must fit. Lines: ${JSON.stringify(rendered.nameLines)} at ${rendered.nameSize}px, date "${rendered.dateLine}"`
    );
    const thumb = renderThumb(event);
    assert.equal(thumb.overflow, false, `${event.id}: the thumbnail must fit, got the date "${thumb.dateLine}" at ${thumb.size}px`);
  }
});

// ---------------------------------------------------------------------------
// Small pure helpers, so their contracts are pinned too
// ---------------------------------------------------------------------------

test('escapeXml escapes the five metacharacters and leaves everything else alone', () => {
  // POSITIVE CONTROL first, so a function that escaped nothing could not pass the
  // negative assertions below by returning its input for every case.
  assert.equal(escapeXml('A & B'), 'A &amp; B', 'an ampersand is the one that actually breaks an SVG');
  assert.equal(escapeXml('Candidates <Unopposed>'), 'Candidates &lt;Unopposed&gt;', 'angle brackets in a title would end the element early');
  assert.equal(escapeXml('say "hi"'), 'say &quot;hi&quot;', 'a double quote inside a double-quoted attribute would end it early');
  assert.equal(escapeXml("it's"), 'it&apos;s', 'an apostrophe is legal unescaped in text but not in an attribute value');

  // The ampersand must be escaped FIRST. Doing it last turns "&amp;lt;" into
  // "&lt;", which is a different string and a wrong one - the classic double-escape
  // bug, and the only way to catch it is to assert on the exact output.
  assert.equal(escapeXml('&lt;'), '&amp;lt;', 'an already-escaped entity must not be unescaped by the escaper');
  assert.equal(escapeXml('&'), '&amp;', 'a bare ampersand is the common case and must not become a partial entity');

  // And what must NOT change.
  assert.equal(escapeXml('Greenville County Republican Party'), 'Greenville County Republican Party', 'plain ASCII text must pass through untouched');
  assert.equal(escapeXml(''), '', 'the empty string is still a string');
  assert.equal(escapeXml('3 NOV'), '3 NOV', 'a date line must pass through untouched');
});

test('resolveInside refuses a path that would escape public/', () => {
  // The generator does not gate on the dataset schema, so it cannot inherit the
  // schema's refusal of a ".."-shaped segment. It therefore has to check for
  // itself, or a hand-edited data file could make this harmless script write
  // anywhere on the disk.
  const inside = [
    '/img/events/foo.svg',
    '/img/events/2026/foo-bar-thumb.svg',
    '/img/foo.svg',
    // A ".." that climbs but does NOT escape is ALLOWED. Two of these were
    // asserted as escapes in the first version of this test, and in both cases the
    // TEST was wrong rather than the code:
    //
    //   /img/./../secrets.svg  ->  public/secrets.svg     (inside)
    //   /img/events/..         ->  public/img             (inside)
    //
    // Refusing a contained path because its SPELLING contains ".." would be
    // refusing a safe path on the strength of how it was typed. The property that
    // matters is where the path resolves, which is why the check runs after
    // normalisation.
    '/img/./../secrets.svg',
    '/img/events/..'
  ];
  for (const declared of inside) {
    const full = resolveInside(PUBLIC_DIR, declared);
    assert.ok(full !== null, `positive control: ${declared} must resolve inside public/, got ${JSON.stringify(full)}`);
    assert.ok(
      full.startsWith(PUBLIC_DIR),
      `positive control: ${declared} must resolve under public/, got ${full}`
    );
  }
  assert.equal(
    resolveInside(PUBLIC_DIR, '/img/./../secrets.svg'),
    resolve(PUBLIC_DIR, 'secrets.svg'),
    'a climbing-but-contained path must normalise to the contained location, not be refused and not be joined naively'
  );
  assert.equal(
    resolveInside(PUBLIC_DIR, '/img/events/..'),
    resolve(PUBLIC_DIR, 'img'),
    'a path that climbs back to a contained directory must resolve to that directory'
  );

  // The cases that must be refused are the ones whose RESOLVED location is
  // outside public/ - which is the actual property, and is why the check is done
  // after normalisation rather than by pattern-matching the spelling.
  const escapes = [
    '/img/../../etc/passwd',
    '/../outside.svg',
    '/img/events/../../../../Windows/System32/drivers/etc/hosts',
    // The bare parent. This is the one that was nearly in the ALLOWED list above,
    // on the reasoning that "a contained .. is fine". But `/..` resolves to the
    // PROJECT ROOT, which is one level ABOVE public/, and the distinction that
    // matters is not whether the path contains ".." - it is where it lands.
    '/..',
    '/img/../..'
  ];
  for (const declared of escapes) {
    assert.equal(
      resolveInside(PUBLIC_DIR, declared),
      null,
      `${declared} must be refused: it resolves outside public/. A generator that writes outside public/ is the one script in this project with a sharp edge.`
    );
  }
});