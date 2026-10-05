#!/usr/bin/env node
// scripts/check-events.mjs - validate data/events.json and print a readable
// report. VALIDATE -> REPORT -> EXIT CODE.
//
// WHY THIS EXISTS ALONGSIDE THE BUILD-TIME CHECK. src/lib/events.ts throws during
// `npm run build`, which is the guarantee that a malformed file cannot ship. But
// a build error is a poor way to edit a data file: it is one problem at a time,
// buried in a stack trace, and it arrives after the slow part of the build.
//
// This script runs the SAME validator (src/lib/events-schema.ts) with no Astro in
// the path, prints every problem at once with its JSON path, and also checks that
// every referenced image actually exists on disk - which the schema cannot do,
// because the schema is pure and takes no filesystem.
//
// The two are deliberately the same rules from the same module. A checker that
// disagreed with the build would be worse than no checker, because it would be
// trusted.
//
// EXIT CODES, matching scripts/fetch-feeds.mjs so they are learnable once:
//   0  the file is valid
//   1  the file is invalid, or an image is missing
//   2  bad arguments, or the file is missing / unreadable / not JSON
//
// Design rule 7 applies: with no --data argument this reads the real committed
// file and WRITES NOTHING. There is no write path in this script at all.

import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateEvents, EVENT_TYPES } from '../src/lib/events-schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const DEFAULT_DATA_PATH = resolve(PROJECT_ROOT, 'data', 'events.json');
// public/ is Astro's default static directory, so a path like /img/events/x.svg
// is served from public/img/events/x.svg.
const PUBLIC_DIR = resolve(PROJECT_ROOT, 'public');

const RULES = '='.repeat(72);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { data: DEFAULT_DATA_PATH, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    const long = arg.startsWith('--');
    const eq = arg.indexOf('=');
    if (long && eq !== -1) {
      const key = arg.slice(0, eq);
      const value = arg.slice(eq + 1);
      if (key === '--data') {
        opts.data = resolve(value);
        continue;
      }
      throw new Error(`unknown argument: ${key}`);
    }
    if (arg === '--data' || arg === '-d') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--data needs a path');
      opts.data = resolve(value);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

const HELP = `check-events - validate the events dataset

USAGE
  node scripts/check-events.mjs [--data <path>]

OPTIONS
  -d, --data <path>   the file to check. Default: data/events.json
  -h, --help          print this and exit 0

EXIT CODES
  0  valid
  1  invalid data, or an image referenced by the data does not exist
  2  bad arguments, or the file is missing / unreadable / not JSON

NOTES
  This script never writes anything. Run \`npm run build\` to prove the site
  still renders; the build applies the same rules and fails loudly.`;

/**
 * Remove a leading UTF-8 byte order mark, decoded as U+FEFF.
 *
 * FOUND BY A PROBE, NOT BY THEORY. Windows PowerShell 5.1's `Out-File -Encoding
 * utf8` and Notepad both write a BOM by default, so a hand-edited events.json on
 * this machine very plausibly arrives with one. JSON.parse rejects it outright,
 * and the resulting error - "Unexpected token ''" pointing at the opening brace -
 * says nothing about the actual cause, which is the worst shape a data error can
 * take: the author goes looking for a syntax error in their JSON.
 *
 * The character is BUILT FROM ITS CODE POINT rather than typed, because U+FEFF is
 * invisible and this project is ASCII-only in authored files. Nothing is trimmed
 * beyond the mark itself: leading whitespace before it would still fail, and
 * hiding that would be dishonest.
 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The same function, exported for the test that asserts this behaviour.
 *
 * Exported rather than reimplemented in the test on purpose: a test with its own
 * copy of the stripping logic would keep passing after the real one was deleted,
 * which is the shape of an assertion that has quietly stopped testing anything.
 */
export function stripBomForTest(text) {
  return stripBom(text);
}

// ---------------------------------------------------------------------------
// Image existence
// ---------------------------------------------------------------------------

/**
 * Do every referenced image actually exist under public/?
 *
 * Separate from the schema on purpose. The schema is pure, so it can be unit
 * tested with no filesystem and shared by the build; this needs the disk and is
 * therefore a property of the REPO rather than of the JSON.
 *
 * Returns one row per referenced path. Duplicates are reported once, because two
 * events legitimately sharing one banner is not a defect worth two lines.
 */
export async function checkImages(events) {
  const seen = new Map();
  for (const event of events) {
    for (const [field, value] of [
      ['thumbnail', event.thumbnail],
      ['banner', event.banner]
    ]) {
      if (!value) continue;
      if (seen.has(value)) continue;
      seen.set(value, []);
      seen.get(value).push(`${event.id}.${field}`);
    }
  }

  const rows = [];
  for (const [value, owners] of seen) {
    // The schema already proved the path is root-relative under /img/, so this
    // join cannot escape public/: a leading slash plus a rejected ".."-shaped
    // segment is the only way out, and IMAGE_PATH_RE allows neither.
    const relative = value.replace(/^\/+/, '');
    const full = resolve(join(PUBLIC_DIR, relative));
    let exists = false;
    try {
      const info = await stat(full);
      exists = info.isFile();
    } catch {
      exists = false;
    }
    rows.push({ path: value, owners, exists, full });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * The problem lines, as an array to be PUSHED INTO THE REPORT.
 *
 * It collects rather than writes, and that is a bug fix rather than a style
 * choice. The first version wrote straight to stdout, so the problems appeared
 * ABOVE the "events: <path>" header that says which file they belong to - the
 * report opened with its findings and buried its subject. Found by running the
 * tool on a deliberately broken file, which is the only way to see it: the tests
 * assert behaviour, not the order a human reads.
 */
function problemLines(problems) {
  return problems.map((item) => `  [${item.reason}] ${item.detail}`);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`fatal: ${error.message}\n`);
    process.stderr.write(`\n${HELP}\n`);
    return 2;
  }

  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  // ---- read ----
  let text;
  try {
    text = await readFile(opts.data, 'utf8');
  } catch (error) {
    process.stderr.write(`fatal: cannot read ${opts.data}: ${error.code ?? error.message}\n`);
    return 2;
  }

  let parsed;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch (error) {
    process.stderr.write(`fatal: ${opts.data} is not valid JSON: ${error.message}\n`);
    process.stderr.write(
      'If the error mentions an unexpected token at the very start of the file, it is a byte order mark.\n' +
        'Save the file as UTF-8 WITHOUT a BOM - Windows PowerShell\'s Out-File -Encoding utf8 and Notepad\n' +
        'both add one by default, and JSON.parse rejects it.\n'
    );
    return 2;
  }

  // ---- validate ----
  const result = validateEvents(parsed);

  const lines = [];
  lines.push(RULES);
  lines.push(`events: ${opts.data}`);
  lines.push(
    result.reviewedOn === null
      ? 'reviewedOn: (absent, so the page renders one chronological list)'
      : `reviewedOn: ${result.reviewedOn}`
  );
  lines.push(`allowed types: ${EVENT_TYPES.join(', ')}`);

  if (!result.ok) {
    lines.push('');
    lines.push(`[ FAIL ] ${result.problems.length} problem(s):`);
    lines.push(...problemLines(result.problems));
    lines.push(RULES);
    process.stdout.write(`${lines.join('\n')}\n`);
    return 1;
  }

  // ---- images ----
  // Only meaningful once the data parsed: an invalid file may name images that
  // were never really in the data, and reporting those would be noise.
  const images = await checkImages(result.events);
  const missing = images.filter((row) => !row.exists);
  const onDisk = sep === '\\' ? 'public\\' : 'public/';

  if (missing.length > 0) {
    lines.push('');
    lines.push(`[ FAIL ] ${missing.length} referenced image(s) do not exist:`);
    for (const row of missing) {
      lines.push(`  missing-image  ${row.path}`);
      lines.push(`      referenced by: ${row.owners.join(', ')}`);
      lines.push(`      expected at:   ${onDisk}${row.path.replace(/^\/+/, '')}`);
    }
  }

  lines.push('');
  lines.push(`  events: ${result.events.length}`);
  for (const event of result.events) {
    const flags = [
      event.allDay ? 'all-day' : null,
      event.thumbnail ? null : 'no thumbnail',
      event.banner ? null : 'no banner'
    ].filter(Boolean);
    const suffix = flags.length > 0 ? `  (${flags.join(', ')})` : '';
    lines.push(`  [ OK ] ${event.id.padEnd(26)} ${event.type.padEnd(11)} ${event.startsAt}${suffix}`);
  }
  lines.push('');
  lines.push(`  images referenced: ${images.length}`);
  lines.push(`  images found:      ${images.length - missing.length}`);
  lines.push(`  images missing:    ${missing.length}`);
  lines.push(RULES);
  process.stdout.write(`${lines.join('\n')}\n`);

  return missing.length > 0 ? 1 : 0;
}

// Direct-invocation guard, so a test can import this module without running it.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`fatal: ${error && error.stack ? error.stack : error}\n`);
      process.exitCode = 1;
    });
}
