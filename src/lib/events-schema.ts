// src/lib/events-schema.ts - THE CONTRACT FOR data/events.json.
//
// ---------------------------------------------------------------------------
// WHY THE SCHEMA IS CODE AND NOT JUST PROSE IN A README
// ---------------------------------------------------------------------------
//
// data/events.json is the one dataset in this project that NO PROGRAM WRITES. It
// is going to be filled in by hand and, more importantly, by an AI assistant
// working from a written description. That changes the failure mode completely:
//
//   - articles.json is machine-written, so its shape is guaranteed by the code
//     that writes it. A typo there is a bug in the pipeline.
//   - events.json is AUTHOR-written, so its shape is a promise. A typo here is
//     silent: `loction` is not a field, so the location does not render, the
//     build is green, and the calendar shows a row with a missing venue.
//
// A green build that quietly dropped a field is exactly the "written but never
// read" defect, one level down: the site would look finished. So the rules live
// here, in one module, and three callers enforce them:
//
//   1. src/lib/events.ts   - throws at BUILD time, so `npm run build` goes red.
//   2. scripts/check-events.mjs - a readable report, for the human or the AI
//      assistant editing the file, BEFORE they try to build.
//   3. test/events.test.mjs - a rule that is not tested is a rule that erodes.
//
// This module is deliberately PURE: no dataset import, no Astro global, no
// filesystem. It takes an `unknown` and returns a verdict. That is what lets the
// three callers above share it - and it means the validator cannot be confused
// by the state of anything except its input.
//
// ---------------------------------------------------------------------------
// ONE DEPARTURE FROM THE PROJECT'S OTHER VALIDATOR, STATED ON PURPOSE
// ---------------------------------------------------------------------------
//
// scripts/lib/validate.mjs returns {ok, reason, detail} for the FIRST problem and
// stops. That is right for a feed: one HTTP response has one Content-Type, and
// the first thing wrong with it is the thing to fix.
//
// A hand-edited file with 40 events is not that. Somebody correcting a
// hand-written dataset wants every problem in one pass, not the first of eleven
// discovered by eleven separate runs. So `validateEvents` COLLECTS every problem
// into an array and the caller decides what to do with the list. The reason codes
// are still a closed set and still kebab-case, so a failure is greppable and a
// log line is stable.
//
// ---------------------------------------------------------------------------
// WHY `type` IS A CLOSED LIST
// ---------------------------------------------------------------------------
//
// The types are filter chips. Free text fragments them over time - "Keynote",
// "keynote", "Keynote Address", "KEYNOTE" - and a filter that offers four
// near-identical chips is worse than no filter, because it implies a distinction
// the data does not make. So the vocabulary is closed, and an unknown type is a
// loud failure that prints the allowed list.
//
// The escape hatch is deliberate and one line long: a human who genuinely needs a
// one-off adds it to EVENT_TYPES below and to the table in data/events.schema.md.
// Making that a conscious edit is the point. It must not be something an AI
// assistant can do by accident while filling in 40 rows.

// `.ts` ON THE SPECIFIER IS REQUIRED, and it is a deliberate divergence from the
// extensionless imports used elsewhere in src/.
//
// The extensionless form is a TypeScript-and-bundler convenience: tsconfig sets
// moduleResolution "Bundler", so Vite and Astro resolve `./months` happily. Bare
// Node does not. Its ESM resolver has no idea that "months" means "months.ts", so
// an extensionless import from a file that `node --test` or
// scripts/check-events.mjs must load fails with ERR_MODULE_NOT_FOUND - which is
// exactly what happened the first time this was run.
//
// tsconfig already sets allowImportingTsExtensions: true, so `./months.ts` is
// legal TypeScript here as well as legal ESM. Being loadable by a plain node
// process is the entire reason this module exists in src/ rather than inline in a
// page, so the specifier pays the small convention cost.
//
// Worth recording: this proved that the comment in src/lib/articles.ts claiming
// "node --test can import it directly" was never actually exercised - no test in
// the repo imports that module. The claim was plausible and untested. Test the
// claim next time, do not inherit it.
import { MONTHS, monthKeyPart } from './months.ts'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed set of event types, in the order they should appear in a filter.
 *
 * All are singular, including `Lecture`. That is a deliberate normalisation of
 * the client's list, which was given as "Lectures": six of the seven entries
 * were singular, and a chip reading "Lectures" in a filter row is a grammar
 * error that a reader sees. It is a one-word revert if that was not the intent,
 * and it is recorded in build-log.md rather than made silently.
 */
export const EVENT_TYPES = [
  'Election',
  'Debate',
  'Forum',
  'Rally',
  'Fundraiser',
  'Workshop',
  'Lecture'
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** Is this string one of the allowed types? Exported so the CLI and tests agree. */
export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One event, after validation.
 *
 * Optional fields are typed optional because they ARE optional in the sample
 * data, not merely in theory: the election event has no artwork at all, and one
 * lecture has a thumbnail but no banner. Every consumer must render around the
 * absence rather than assuming it away.
 */
export interface EventRecord {
  /** Stable, kebab-case, unique. Becomes a DOM id and an anchor fragment. */
  id: string
  /** The event's name. This is the headline of the row. */
  name: string
  /** What the event IS: a sentence of description. Required, never optional. */
  event: string
  /**
   * A LOCAL WALL CLOCK time: `YYYY-MM-DDTHH:MM`, or `YYYY-MM-DD` when
   * `allDay` is true.
   *
   * NOT a UTC instant, and a `Z` or a `+05:00` offset is REJECTED rather than
   * converted. That is the single most important rule in this file; see the
   * section headed "WHY WALL CLOCK AND NOT UTC" below.
   */
  startsAt: string
  /** Optional end, same format as startsAt. Must not precede it. */
  endsAt: string | null
  /** True when the event runs all day: no clock time is shown at all. */
  allDay: boolean
  /**
   * The venue's own zone, as a human label: "Eastern Time (ET)".
   *
   * A label and NOT an IANA identifier, deliberately. `America/New_York` would
   * be the machine form, and it is not used here because turning a wall clock
   * into a UTC instant in a named zone is DST arithmetic - a spring-forward gap
   * where 2:30am does not exist, an autumn fold where it happens twice. That is
   * bug-prone code, and the calendar does not need it: a venue's local clock time
   * is the information a reader actually wants.
   */
  timezone: string | null
  /** Free text. A venue, or "Online", or a street address. */
  location: string
  type: EventType
  /** Root-relative path to a small image, e.g. `/img/events/foo-thumb.svg`. */
  thumbnail: string | null
  /** Root-relative path to a large image, e.g. `/img/events/foo-banner.svg`. */
  banner: string | null
  /** Optional outbound link, e.g. a registration page. Must be http(s). */
  url: string | null
  /** Optional extra detail for the highlighted panel. */
  notes: string | null
}

/** The whole dataset file. */
export interface EventDataset {
  /**
   * The date a human last reviewed this list: `YYYY-MM-DD`.
   *
   * THIS IS WHY THE PAGE DOES NOT CALL `new Date()`. Splitting a calendar into
   * "past" and "upcoming" at build time would make the built HTML depend on the
   * day the build ran, which is ROADMAP design rule 8 (reproducible output)
   * broken in the most literal way available: commit once, build twice on
   * different days, get two different pages. Stating the split date in the data
   * keeps it reproducible AND lets a human say "this list is current as of the
   * 5th", which is the fact that makes the split honest.
   *
   * Optional. When absent, every event is rendered in one chronological list and
   * no past/upcoming split is made - because a split needs a line to draw.
   */
  reviewedOn: string | null
  events: EventRecord[]
}

/**
 * A problem found in the file.
 *
 * `path` is a JSON-pointer-ish locator an editor can jump to ("events[3].startsAt").
 * `reason` is a closed-set slug, for logs and for grep. `detail` is the sentence
 * to print, and it always names the value actually observed - never "invalid
 * input", which tells the author nothing they did not already know.
 */
export interface ValidationProblem {
  path: string
  reason: string
  detail: string
}

export interface ValidationResult {
  ok: boolean
  problems: ValidationProblem[]
  /**
   * The validated events, or an EMPTY ARRAY when `ok` is false.
   *
   * Never a partial list. A validator that returns the 38 good rows out of 40
   * invites a caller to ship a calendar that is missing two events and looks
   * fine - which is the failure this whole module exists to prevent.
   */
  events: EventRecord[]
  reviewedOn: string | null
}

// ---------------------------------------------------------------------------
// Field specification
// ---------------------------------------------------------------------------

type FieldKind =
  | 'id'
  | 'text'
  | 'longtext'
  | 'timestamp'
  | 'optionalTimestamp'
  | 'boolean'
  | 'eventType'
  | 'imagePath'
  | 'url'

interface FieldSpec {
  key: string
  kind: FieldKind
  required: boolean
  /** Rejected past this. Generous enough for real prose, short enough to catch a
   *  whole paragraph pasted into `location` by mistake. */
  maxLength: number
  /** One line, used in the "allowed keys" error and in the schema doc. */
  note: string
}

/**
 * The field table. Single source of truth for three things: what is validated,
 * what the "unknown key" error is allowed to suggest, and what
 * data/events.schema.md documents. One table means the doc cannot drift from the
 * code without the drift being visible in the same file.
 */
export const EVENT_FIELDS: readonly FieldSpec[] = [
  {
    key: 'id',
    kind: 'id',
    required: true,
    maxLength: 60,
    note: 'stable kebab-case slug, unique; becomes the row id and anchor'
  },
  {
    key: 'name',
    kind: 'text',
    required: true,
    maxLength: 120,
    note: "the event's name, shown as the row headline"
  },
  {
    key: 'event',
    kind: 'longtext',
    required: true,
    maxLength: 400,
    note: 'what the event is: one or two sentences of description'
  },
  {
    key: 'startsAt',
    kind: 'timestamp',
    required: true,
    // 19, not 16. The longest LEGAL value is "2026-11-14T18:30:00" at 19
    // characters, and this table is what data/events.schema.md is generated from
    // and what an AI assistant filling the file in reads - so a number smaller
    // than a valid value is a lie told to exactly the reader least able to check
    // it. It read 16 while HH:MM:SS was accepted, which a review flagged.
    //
    // It is also NOT ENFORCED, deliberately. Timestamps are exempt from the
    // length check (see LENGTH_LIMITED) because their format regex is the
    // stricter check and gives the better message: raising the limit instead
    // masked `timestamp-has-offset`, the far more valuable diagnostic. The
    // number is kept TRUE rather than deleted, so the documentation has
    // something accurate to state.
    maxLength: 19,
    note: 'local wall clock, no Z and no UTC offset'
  },
  {
    key: 'endsAt',
    kind: 'optionalTimestamp',
    required: false,
    maxLength: 19,
    note: 'optional local wall clock, must not precede startsAt'
  },
  {
    key: 'allDay',
    kind: 'boolean',
    required: false,
    maxLength: 5,
    note: 'true when there is no clock time; startsAt becomes a plain date'
  },
  {
    key: 'timezone',
    kind: 'text',
    required: false,
    maxLength: 40,
    note: "the venue's zone as a label, e.g. 'Eastern Time (ET)'; required unless allDay"
  },
  {
    key: 'location',
    kind: 'text',
    required: true,
    maxLength: 200,
    note: 'venue, or "Online", or a street address'
  },
  {
    key: 'type',
    kind: 'eventType',
    required: true,
    maxLength: 20,
    note: 'one of EVENT_TYPES; anything else is rejected with the allowed list'
  },
  {
    key: 'thumbnail',
    kind: 'imagePath',
    required: false,
    maxLength: 200,
    note: 'root-relative small image, e.g. /img/events/foo-thumb.svg'
  },
  {
    key: 'banner',
    kind: 'imagePath',
    required: false,
    maxLength: 200,
    note: 'root-relative large image, e.g. /img/events/foo-banner.svg'
  },
  {
    key: 'url',
    kind: 'url',
    required: false,
    maxLength: 500,
    note: 'optional outbound registration link, http or https only'
  },
  {
    key: 'notes',
    kind: 'longtext',
    required: false,
    maxLength: 600,
    note: 'optional extra detail for the highlighted panel'
  }
] as const

/** Every legal key on an event, for the unknown-key suggestion list. */
export const ALLOWED_EVENT_KEYS: readonly string[] = EVENT_FIELDS.map((field) => field.key)

const FIELD_BY_KEY = new Map(EVENT_FIELDS.map((field) => [field.key, field]))

// ---------------------------------------------------------------------------
// WHY WALL CLOCK AND NOT UTC - the one rule worth reading twice
// ---------------------------------------------------------------------------
//
// data/articles.json stores `publishedAt` as a UTC instant with a Z, and
// src/lib/articles.ts formats it with getUTCDate() so the build machine's
// timezone cannot shift it. That is the right model for an article: a post has
// one true publication instant, and every reader can convert it.
//
// A VENUE EVENT IS NOT LIKE THAT. "The debate starts at 6:30pm" means 6:30pm at
// the venue. That string is the fact. There is no additional truth to discover,
// and no reader wants it converted to whatever zone they happen to be in.
//
// So the file stores wall clock, and the renderer reads it back with getUTC*
// accessors. That looks like a contradiction and is not: the accessors are what
// guarantee no machine-timezone drift, and reading the same digits back means the
// digits printed are the digits in the file. The output is byte-identical on this
// machine and on the GH Pages runner, which is design rule 8, and it is also the
// time the reader needs.
//
// The consequence, stated rather than hidden: THE ABSOLUTE INSTANT IS NOT IN THE
// FILE. A reader in another zone has to apply the stated `timezone` label. That
// is why `timezone` is a required field for any timed event - without it the
// row is unanswerable - and it is why this file rejects an offset instead of
// accepting one. Accepting "2026-11-14T18:30:00-05:00" and then printing it
// through getUTCHours would show 11:30pm, which is a correct instant and a wrong
// event time. A loud rejection is cheaper than that.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const WALL_CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// SEGMENT BY SEGMENT, and that is the whole point.
//
// The first version of this was `/^\/img\/[A-Za-z0-9._\-/]+$/`, which reads
// correct and is not: the character class includes a literal `.`, so `/img/../secret`
// matched. The path is joined onto public/ and stat'ed by scripts/check-events.mjs,
// so a hand-edited data file could point the checker anywhere on the disk. A test
// caught it; the test is in test/events.test.mjs and is titled for exactly this.
//
// Each segment must therefore START with a letter, digit, underscore or hyphen,
// which makes ".." unrepresentable rather than merely unlikely, and a segment may
// carry one extension of alphanumerics so "foo-thumb.svg" still works.
const IMAGE_PATH_RE = /^\/img\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)*$/

/** Does this timestamp carry an explicit UTC marker or offset? */
export function hasUtcOffset(value: string): boolean {
  return /(?:Z|z|[+-]\d{2}:?\d{2})$/.test(value)
}

/**
 * Verify a wall-clock string is a REAL moment as well as a well-shaped one.
 *
 * The regexes above accept `2026-02-30` and `2026-11-14T25:00`, so shape alone
 * is not validity. This round-trips the components through Date.UTC and demands
 * every field come back unchanged, which rejects both of those and accepts every
 * real date including 29 February in a leap year.
 *
 * Date.UTC is used as a CALENDAR ARITHMETIC HELPER only. Nothing here is ever
 * formatted from the resulting Date, so no machine timezone is involved; the
 * caller gets the original string back, untouched.
 *
 * Returns the components, or null if the string is not a real moment.
 */
export function parseWallClock(value: string): {
  year: number
  month: number
  day: number
  hour: number | null
  minute: number | null
  allDay: boolean
} | null {
  const isDateOnly = DATE_RE.test(value)
  if (!isDateOnly && !WALL_CLOCK_RE.test(value)) return null

  const [datePart, timePart = ''] = value.split('T')
  const [yearText, monthText, dayText] = datePart.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  const stamp = Date.UTC(year, month - 1, day)
  const probe = new Date(stamp)
  // Date.UTC maps years 0-99 into the 20th century, which is never intended here
  // and would make the comparison below fail for a legitimate year.
  if (year >= 0 && year <= 99) return null
  if (probe.getUTCFullYear() !== year) return null
  if (probe.getUTCMonth() !== month - 1) return null
  if (probe.getUTCDate() !== day) return null

  if (isDateOnly) return { year, month, day, hour: null, minute: null, allDay: true }

  const [hourText, minuteText, secondText = '0'] = timePart.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (hour > 23 || minute > 59 || second > 59) return null

  return { year, month, day, hour, minute, allDay: false }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function problem(path: string, reason: string, detail: string): ValidationProblem {
  return { path, reason, detail }
}

/**
 * Levenshtein distance, for a typo suggestion.
 *
 * THE FIRST VERSION COUNTED MISMATCHED POSITIONS and it was quietly wrong in the
 * exact case it existed for. "loction" against "location" differs by ONE INSERTED
 * CHARACTER, so the distance is 1 - but a positional count also scores the four
 * characters after the insertion point as mismatches and returns 5, over the
 * threshold. The one typo an author is actually likely to make produced no
 * suggestion at all. A test caught it.
 *
 * Two-row dynamic programming: the full matrix would be correct and unreadable
 * for a one-line courtesy message.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  const current = new Array<number>(b.length + 1).fill(0)

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost)
    }
    previous = current.slice()
  }
  return previous[b.length]
}

/**
 * The closest legal key to what was written, or '' when nothing is close.
 *
 * The threshold is 2, which admits a single edit - inserted, dropped, substituted
 * or transposed - and rejects a word that merely resembles a field. That
 * distinction is deliberate and tested: "loction" and "startAt" get a suggestion,
 * "zzzz" does not, because a confident wrong suggestion is worse than none.
 *
 * `legalKeys` IS A PARAMETER, and it used to be hardcoded to the event-field list.
 * That was wrong at the top level, where the legal keys are `events` and
 * `reviewedOn`: `reviewedAon` got NO suggestion despite being one edit away,
 * because the comparator was searching a list that did not contain the answer,
 * while `event` - a perfectly good EVENT field, and not a legal ROOT key - got the
 * confident suggestion `Did you mean "event"?`. A review caught both. The fix is
 * to pass in the vocabulary that is actually legal for the level being checked,
 * so this function has no opinion about where it is being used.
 */
function suggestKey(typo: string, legalKeys: readonly string[]): string {
  const lowered = typo.toLowerCase();
  let best = '';
  let bestScore = Infinity;
  for (const key of legalKeys) {
    const score = levenshtein(lowered, key.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return bestScore <= 2 ? best : '';
}

/** The only two keys the top level of the file may carry. */
const ROOT_KEYS = ['events', 'reviewedOn'] as const;

function validateField(
  spec: FieldSpec,
  raw: Record<string, unknown>,
  path: string,
  allDay: boolean,
  problems: ValidationProblem[]
): unknown {
  const present = Object.prototype.hasOwnProperty.call(raw, spec.key)
  const value = raw[spec.key]

  if (!present || value === null || value === undefined) {
    if (spec.kind === 'optionalTimestamp') return null
    if (!spec.required) {
      // `allDay: false` and `endsAt: null` are meaningful absences; anything else
      // that is missing but required is an error.
      if (spec.key === 'allDay') return false
      if (spec.kind === 'imagePath' || spec.kind === 'url' || spec.kind === 'longtext' || spec.kind === 'text') return null
      return false
    }
    problems.push(
      problem(path, 'missing-field', `${path} is required but ${spec.key} is missing`)
    );
    return null
  }

  // maxLength is enforced HERE, once, for the kinds where an over-long value is a
  // real authoring error - rather than inside the text/longtext branch where it
  // originally lived.
  //
  // It was only checked in that one branch, so `id`, `thumbnail`, `banner` and
  // `url` were unbounded: a 4000-character URL validated clean, which is how a
  // whole paragraph of prose ends up pasted into a link field. One check here
  // cannot be forgotten by a new field kind, which is the point.
  //
  // TIMESTAMPS ARE DELIBERATELY EXCLUDED, and the first attempt at this check got
  // that wrong in a way worth recording. Applying it to `startsAt` rejected the
  // perfectly legal "2026-11-14T18:30:00" (19 characters against a 16 limit) AND
  // masked the far more valuable diagnostic: "2026-11-14T18:30:00-05:00" reported
  // "too long" instead of `timestamp-has-offset`, sending an author to shorten a
  // value whose actual problem is that it carries a UTC offset. A field whose
  // format is fully determined by a regular expression does not need a length
  // limit as well - the format check is the stricter one and gives the better
  // message.
  const LENGTH_LIMITED: readonly FieldKind[] = ['id', 'text', 'longtext', 'imagePath', 'url'];
  if (LENGTH_LIMITED.includes(spec.kind) && typeof value === 'string' && value.trim().length > spec.maxLength) {
    problems.push(
      problem(
        path,
        'too-long',
        `${path}.${spec.key} is ${value.trim().length} characters, over the ${spec.maxLength} limit for ${spec.key}`
      )
    );
    return null;
  }

  switch (spec.kind) {
    case 'id': {
      if (typeof value !== 'string') {
        problems.push(problem(path, 'not-a-string', `${path}.${spec.key} must be a string, got ${typeof value}`));
        return null;
      }
      const trimmed = value.trim();
      if (trimmed === '') {
        problems.push(problem(path, 'empty-string', `${path}.${spec.key} is empty`));
        return null;
      }
      if (!ID_RE.test(trimmed)) {
        problems.push(
          problem(
            path,
            'bad-id-format',
            `${path}.${spec.key} must be lowercase kebab-case (letters, digits and single hyphens), got "${value}"`
          )
        );
        return null;
      }
      // The page derives THREE ids from this one: the radio is
      // `event-input-<id>`, the panel is `event-<id>`, and the selector keys off
      // both. So the prefix `input-` is RESERVED: an event called `input-x`
      // produces the panel id `event-input-x`, which is exactly the RADIO id of
      // an event called `x`. Two elements, one DOM id, and an `aria-controls`
      // that points at the wrong thing - a collision the duplicate-id check
      // cannot see, because it only ever compares an id against other ids.
      if (/^input-/.test(trimmed)) {
        problems.push(
          problem(
            path,
            'reserved-id-prefix',
            `${path}.${spec.key} is "${trimmed}", but an id may not begin with "input-". The page derives the radio id ` +
              '"event-input-<id>", so an id of "input-x" would collide with the radio id of an event called "x".'
          )
        );
        return null;
      }
      return trimmed;
    }

    case 'text':
    case 'longtext': {
      if (typeof value !== 'string') {
        problems.push(problem(path, 'not-a-string', `${path}.${spec.key} must be a string, got ${typeof value}`));
        return null;
      }
      const trimmed = value.trim();
      if (trimmed === '') {
        problems.push(problem(path, 'empty-string', `${path}.${spec.key} is empty, and an empty value reads as a missing one`));
        return null;
      }
      // Length was already checked above, for every string kind at once.
      return trimmed;
    }

    case 'timestamp':
    case 'optionalTimestamp': {
      if (typeof value !== 'string') {
        problems.push(problem(path, 'not-a-string', `${path}.${spec.key} must be a string, got ${typeof value}`));
        return null;
      }
      const trimmed = value.trim();
      if (trimmed === '') {
        problems.push(problem(path, 'empty-string', `${path}.${spec.key} is empty`));
        return null;
      }
      // The offset check comes FIRST and on its own, because it is the mistake an
      // AI assistant is most likely to make and the one whose symptom is worst:
      // the row renders, with the wrong time on it, and nothing is red.
      if (hasUtcOffset(trimmed)) {
        problems.push(
          problem(
            path,
            'timestamp-has-offset',
            `${path}.${spec.key} must be a LOCAL wall clock with no "Z" and no +HH:MM offset, got "${trimmed}". ` +
              'A venue event is stored in the venue\'s own clock time; store the plain local time and put the zone in the timezone field.'
          )
        );
        return null;
      }
      const parsed = parseWallClock(trimmed);
      if (parsed === null) {
        problems.push(
          problem(
            path,
            'bad-timestamp-format',
            `${path}.${spec.key} is "${trimmed}", which is not a real date. ` +
              (allDay
                ? 'This event is allDay, so it must be YYYY-MM-DD.'
                : 'Expected YYYY-MM-DDTHH:MM in local time, e.g. 2026-11-14T18:30.')
          )
        );
        return null;
      }
      if (allDay && !parsed.allDay) {
        problems.push(
          problem(
            path,
            'bad-timestamp-format',
            `${path}.${spec.key} is "${trimmed}" but the event is allDay, so it must be a plain YYYY-MM-DD date with no time`
          )
        );
        return null;
      }
      if (!allDay && parsed.allDay) {
        problems.push(
          problem(
            path,
            'bad-timestamp-format',
            `${path}.${spec.key} is "${trimmed}" with no time, but the event is not allDay. ` +
              'Either give it a clock time, or set "allDay": true.'
          )
        );
        return null;
      }
      return trimmed;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        problems.push(
          problem(path, 'not-a-boolean', `${path}.${spec.key} must be true or false, got ${JSON.stringify(value)}`)
        );
        return null;
      }
      return value;
    }

    case 'eventType': {
      if (!isEventType(value)) {
        problems.push(
          problem(
            path,
            'bad-type',
            `${path}.${spec.key} is ${JSON.stringify(value)}, which is not one of the allowed types: ` +
              `${EVENT_TYPES.join(', ')}. To add a genuine one-off, add it to EVENT_TYPES in src/lib/events-schema.ts.`
          )
        );
        return null;
      }
      return value;
    }

    case 'imagePath': {
      if (typeof value !== 'string') {
        problems.push(problem(path, 'not-a-string', `${path}.${spec.key} must be a string path, got ${typeof value}`));
        return null;
      }
      const trimmed = value.trim();
      if (trimmed === '') return null;
      if (!IMAGE_PATH_RE.test(trimmed)) {
        problems.push(
          problem(
            path,
            'bad-image-path',
            `${path}.${spec.key} must be a root-relative path under /img/, e.g. /img/events/foo-thumb.svg, got "${trimmed}". ` +
              'Remote URLs and relative paths are not accepted: the base path is not known at authoring time and a remote image is not reviewable in this repo.'
          )
        );
        return null;
      }
      return trimmed;
    }

    case 'url': {
      if (typeof value !== 'string') {
        problems.push(problem(path, 'not-a-string', `${path}.${spec.key} must be a string URL, got ${typeof value}`));
        return null;
      }
      const trimmed = value.trim();
      if (trimmed === '') return null;
      let parsedUrl: URL | null = null;
      try {
        parsedUrl = new URL(trimmed);
      } catch {
        parsedUrl = null;
      }
      if (parsedUrl === null || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')) {
        problems.push(
          problem(path, 'bad-url', `${path}.${spec.key} must be an absolute http or https URL, got "${trimmed}"`)
        );
        return null;
      }
      return trimmed;
    }
  }
}

/**
 * Validate the whole file.
 *
 * @param raw - the parsed JSON, typed `unknown` because nothing about a hand
 *              written file can be assumed before it has been checked.
 * @returns every problem found, plus the validated events when there are none.
 */
export function validateEvents(raw: unknown): ValidationResult {
  const problems: ValidationProblem[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      problems: [
        problem('(root)', 'root-not-object', `the file must contain a JSON object at the top level, got ${Array.isArray(raw) ? 'an array' : typeof raw}`)
      ],
      events: [],
      reviewedOn: null
    };
  }

  const doc = raw as Record<string, unknown>;

  // Unknown keys at the ROOT, same rationale as at the event level: a typo in
  // `reviewedOn` would otherwise be silently ignored.
  for (const key of Object.keys(doc)) {
    if (key === 'events' || key === 'reviewedOn') continue;
    problems.push(
      problem(
        '(root)',
        'unknown-key',
        `the top level accepts only "events" and "reviewedOn", got "${key}". ${describeSuggestion(suggestKey(key, ROOT_KEYS))}`
      )
    );
  }

  let reviewedOn: string | null = null;
  if (doc.reviewedOn !== undefined && doc.reviewedOn !== null) {
    if (typeof doc.reviewedOn !== 'string' || parseWallClock(doc.reviewedOn) === null) {
      problems.push(
        problem(
          '(root).reviewedOn',
          'bad-timestamp-format',
          `(root).reviewedOn must be a real YYYY-MM-DD date, got ${JSON.stringify(doc.reviewedOn)}. ` +
            'This is the date a human last reviewed the list; it is what lets the page split past from upcoming without depending on the build date.'
        )
      );
    } else {
      reviewedOn = doc.reviewedOn.trim();
    }
  }

  if (!Array.isArray(doc.events)) {
    problems.push(
      problem(
        '(root).events',
        doc.events === undefined ? 'events-missing' : 'events-not-array',
        `(root).events must be an array of events, got ${doc.events === undefined ? 'nothing' : Array.isArray(doc.events) ? 'an array' : typeof doc.events}`
      )
    );
    return { ok: false, problems, events: [], reviewedOn };
  }

  if (doc.events.length === 0) {
    problems.push(
      problem(
        '(root).events',
        'events-empty',
        '(root).events is an empty array. An events page with no events is a page that renders a lie about a calendar; delete the page instead, or add at least one event.'
      )
    );
    return { ok: false, problems, events: [], reviewedOn };
  }

  const seenIds = new Map<string, number>();
  const events: EventRecord[] = [];

  doc.events.forEach((entry: unknown, index: number) => {
    const path = `events[${index}]`;

    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(problem(path, 'not-a-list', `${path} must be an object, got ${Array.isArray(entry) ? 'an array' : entry === null ? 'null' : typeof entry}`));
      return;
    }

    const raw = entry as Record<string, unknown>;

    for (const key of Object.keys(raw)) {
      if (FIELD_BY_KEY.has(key)) continue;
      problems.push(
        problem(
          `${path}.${key}`,
          'unknown-key',
          `"${key}" is not a field of an event. ${describeSuggestion(suggestKey(key, ALLOWED_EVENT_KEYS))}`
        )
      );
    }

    // `allDay` is read first because it decides which shape `startsAt` must have,
    // and validating the timestamp before knowing it would report the confusing
    // "not a real date" for what is really a missing time.
    const allDay = raw.allDay === true;
    const checked: Record<string, unknown> = {};

    for (const spec of EVENT_FIELDS) {
      checked[spec.key] = validateField(spec, raw, path, allDay, problems);
    }

    // Cross-field rule: a timed event with no stated zone prints a time the
    // reader cannot place. That is a missing answer wearing a row's clothes.
    if (!allDay && (checked.timezone === null || checked.timezone === undefined)) {
      problems.push(
        problem(
          `${path}.timezone`,
          'missing-field',
          `${path}.timezone is required unless the event is allDay, because a clock time with no stated zone cannot be placed by a reader`
        )
      );
    }

    // Cross-field rule: an end before the start is a data error, not a rendering
    // preference, and it is exactly the kind of thing a transcription gets wrong.
    //
    // COMPARED AS SORTABLE INTEGERS, NOT DATES. The first version built an ISO
    // string and called Date.parse, which was correct for a timed event and
    // SILENTLY INERT for every all-day one: a date-only value produced
    // "2026-11-03:00Z", Date.parse returned NaN for it, and `NaN < NaN` is false.
    // So `startsAt: 2026-11-03, endsAt: 2026-10-01` validated clean. A review
    // caught it; the test for it now covers the all-day case, which the original
    // test did not.
    const startsAt = checked.startsAt;
    const endsAt = checked.endsAt;
    if (typeof startsAt === 'string' && typeof endsAt === 'string') {
      if (wallClockToSortable(endsAt) < wallClockToSortable(startsAt)) {
        problems.push(
          problem(
            `${path}.endsAt`,
            'ends-before-starts',
            `${path}.endsAt is "${endsAt}", which is before startsAt "${startsAt}"`
          )
        );
      }
    }

    // Duplicate ids are a hard error. An id is a DOM id and an anchor fragment;
    // two rows sharing one means the second is unreachable and a link to it
    // scrolls the reader to the wrong event.
    const id = checked.id;
    if (typeof id === 'string') {
      const previous = seenIds.get(id);
      if (previous !== undefined) {
        problems.push(
          problem(
            `${path}.id`,
            'duplicate-id',
            `${path}.id is "${id}", which is already used by events[${previous}]. Ids must be unique: they are DOM ids and anchor fragments.`
          )
        );
      } else {
        seenIds.set(id, index);
      }
    }

    // An event is only admitted if none of its fields produced a problem, so a
    // half-parsed record can never reach the page.
    const eventPathProblems = problems.filter((p) => p.path === path || p.path.startsWith(`${path}.`));
    if (eventPathProblems.length > 0) return;

    events.push({
      id: id as string,
      name: checked.name as string,
      event: checked.event as string,
      startsAt: startsAt as string,
      endsAt: (endsAt as string | null) ?? null,
      allDay,
      timezone: (checked.timezone as string | null) ?? null,
      location: checked.location as string,
      type: checked.type as EventType,
      thumbnail: (checked.thumbnail as string | null) ?? null,
      banner: (checked.banner as string | null) ?? null,
      url: (checked.url as string | null) ?? null,
      notes: (checked.notes as string | null) ?? null
    });
  });

  if (problems.length > 0) {
    return { ok: false, problems, events: [], reviewedOn };
  }
  return { ok: true, problems: [], events, reviewedOn };
}

function describeSuggestion(suggestion: string): string {
  return suggestion === '' ? '' : `Did you mean "${suggestion}"?`
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
//
// EVERY date on the events page is rendered by one of these three functions, and
// none of them calls `toLocaleDateString`. That is the whole point, and the
// reasoning is the same as the long note above formatUtcDate() in
// src/lib/articles.ts: month names and separators come from ICU data on the
// BUILD MACHINE, so the same commit can render differently on the GH Pages
// runner, and the failure looks like a data bug rather than an environment one.
//
// What is different here is the input. An article timestamp is a UTC instant, so
// the renderers reach for getUTC* to stop the machine's zone shifting it. An
// event timestamp is already a local wall clock, so the digits are read back as
// written and the getUTC* accessors do the reading purely because they cannot
// apply an offset. Either way: no zone argument can change the output, and the
// built HTML is identical on every machine.

/**
 * `14 November 2026`, for either a timed or an all-day event.
 *
 * Returns the empty string for anything unparseable, so a bad value degrades to a
 * missing date instead of printing "Invalid Date" - a smaller lie.
 */
export function formatEventDate(value: string): string {
  const parsed = parseWallClock(value);
  if (parsed === null) return '';
  return `${parsed.day} ${MONTHS[parsed.month - 1]} ${parsed.year}`
}

/**
 * `6:30 pm`, or `6:30 pm - 8:00 pm` when the event has an end.
 *
 * The empty string for an all-day event, because an all-day event has no clock
 * time and printing "12:00 am" for it would be a fabricated fact. There is no
 * 24-hour variant and no locale switch: 12-hour with a lowercase meridiem is what
 * this site uses everywhere, and a locale-dependent variant would reintroduce
 * the ICU dependency the whole section exists to avoid.
 *
 * The separator is an ASCII hyphen with spaces, not an en dash, because every
 * character authored into this project is ASCII (ROADMAP design rule 9).
 */
export function formatEventTime(startsAt: string, endsAt: string | null): string {
  const start = parseWallClock(startsAt);
  if (start === null || start.allDay) return '';
  const from = formatClockTime(start.hour as number, start.minute as number);
  if (endsAt === null) return from;
  const end = parseWallClock(endsAt);
  if (end === null || end.allDay) return from;
  return `${from} - ${formatClockTime(end.hour as number, end.minute as number)}`
}

function formatClockTime(hour: number, minute: number): string {
  const meridiem = hour < 12 ? 'am' : 'pm';
  // 0 and 12 both display as 12, which is the one piece of arithmetic here that
  // is worth stating: `hour % 12` alone would print "0:30 am".
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${meridiem}`
}

/**
 * The zone label as a short trailing hint, or the empty string.
 *
 * Shown as "Eastern Time (ET)" rather than abbreviated to "ET" alone, because
 * "ET" is ambiguous with both Eastern Standard and Eastern Daylight Time and the
 * label is the only thing standing in for the instant this file deliberately
 * does not store.
 */
export function formatEventZone(timezone: string | null): string {
  const trimmed = timezone?.trim();
  return trimmed ? trimmed : '';
}

/**
 * The value for a `<time datetime="...">` attribute.
 *
 * The wall clock is passed through with a zero seconds part stripped, and
 * NOTHING ELSE. No offset is appended, because appending one would assert an
 * instant this file does not know. A local date-and-time string is a valid HTML
 * time, and a reader's assistive technology reads it as the local time - which is
 * what it is.
 *
 * Strips seconds rather than keeping them so that `18:30` and `18:30:00` produce
 * byte-identical HTML. Two spellings of the same moment rendering differently is
 * exactly the kind of thing that makes a diff unreviewable.
 */
export function machineDateTime(value: string): string {
  const parsed = parseWallClock(value);
  if (parsed === null) return '';
  if (parsed.allDay) return value;
  const hour = String(parsed.hour).padStart(2, '0');
  const minute = String(parsed.minute).padStart(2, '0');
  return `${parsed.year}-${monthKeyPart(parsed.month - 1)}-${String(parsed.day).padStart(2, '0')}T${hour}:${minute}`
}

// ---------------------------------------------------------------------------
// Ordering and grouping
// ---------------------------------------------------------------------------

/**
 * Sort a copy chronologically, ASCENDING, with a stable tiebreak.
 *
 * Ascending, unlike the article feed. A calendar reads forward in time; "latest
 * first" is right for a reading room and wrong for a list of dates, where it
 * puts the furthest-future event at the top.
 *
 * The tiebreak is `id`, then the original index. Two events at the same minute
 * must not order by whatever the sort algorithm feels like, because the built HTML
 * would then differ between machines - design rule 8 applied to ordering.
 */
export function sortEvents(eventsIn: readonly EventRecord[]): EventRecord[] {
  return [...eventsIn]
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const delta = wallClockToSortable(a.event.startsAt) - wallClockToSortable(b.event.startsAt);
      if (delta !== 0) return delta;
      if (a.event.id !== b.event.id) return a.event.id < b.event.id ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.event);
}

/**
 * A sortable number for a wall-clock string, WITHOUT interpreting a timezone.
 *
 * Both forms are reduced to the same `YYYYMMDD`(+`HHMM`) integer, so a date-only
 * event and a timed event on the same day sort adjacently and a date-only event
 * sorts before a timed one that morning, which is what a reader expects from a
 * calendar. Zero-padded fixed-width integers compare correctly as strings, which
 * is the whole trick: no Date, no offset, no machine timezone.
 */
export function wallClockToSortable(value: string): number {
  const [datePart, timePart = ''] = value.split('T');
  const [hour = '00', minute = '00', second = '00'] = timePart.split(':');
  // FIXED WIDTH, ALWAYS. The first version appended timePart with its colons
  // stripped and nothing else, which produced 4 digits for "18:30" and 6 for
  // "18:30:00". Those are not comparable numbers: 20261114183000 (18:30:00)
  // is numerically GREATER than 202611142000 (20:00), so an event running
  // 18:30:00 to 20:00 was reported as ending before it started. It surfaced only
  // after the ends-before-starts rule was rewritten to use this function - which
  // is the ordinary way a latent bug gets found, by giving it a second caller.
  const timeDigits = `${hour.padStart(2, '0')}${minute.padStart(2, '0')}${second.padStart(2, '0')}`;
  return Number(`${datePart.replace(/-/g, '')}${timeDigits}`);
}

/** `2026-11` for a wall-clock string. The month a calendar groups by. */
export function monthKey(value: string): string {
  const parsed = parseWallClock(value);
  if (parsed === null) return '';
  return `${parsed.year}-${monthKeyPart(parsed.month - 1)}`
}

/** `November 2026` for a `2026-11` key. */
export function monthLabel(key: string): string {
  const parsed = parseWallClock(`${key}-01`);
  if (parsed === null) return key;
  return `${MONTHS[parsed.month - 1]} ${parsed.year}`
}

/** One month of events, in the shape the page renders. */
export interface MonthGroup {
  /** `2026-11`, sortable and stable, and usable as an anchor fragment. */
  key: string
  /** `November 2026`, for display. */
  label: string
  events: EventRecord[]
}

/**
 * Group events by calendar month, months ascending, events ascending within.
 *
 * Months are derived from the data, never from a hardcoded list, so a calendar
 * that gains an event in a month nobody anticipated simply gains a heading.
 */
export function groupByMonth(eventsIn: readonly EventRecord[]): MonthGroup[] {
  const sorted = sortEvents(eventsIn);
  const groups = new Map<string, EventRecord[]>();
  for (const event of sorted) {
    const key = monthKey(event.startsAt);
    if (key === '') continue;
    if (!groups.has(key)) groups.set(key, []);
    (groups.get(key) as EventRecord[]).push(event);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, label: monthLabel(key), events: list }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * Which side of the reviewed date an event falls on.
 *
 * Compares CALENDAR DAYS as `YYYYMMDD` integers, never instants, so the split
 * cannot be shifted by a timezone. An all-day event ON the reviewed date is
 * upcoming, not past: today has not finished.
 */
export function isPast(event: EventRecord, reviewedOn: string | null): boolean {
  if (reviewedOn === null) return false;
  const reviewed = parseWallClock(reviewedOn);
  if (reviewed === null) return false;
  const eventDay = Number(event.startsAt.slice(0, 10).replace(/-/g, ''));
  const reviewedDay = Number(`${reviewed.year}${String(reviewed.month).padStart(2, '0')}${String(reviewed.day).padStart(2, '0')}`);
  return eventDay < reviewedDay
}

/** The types actually present, in EVENT_TYPES order, with counts. */
export function eventTypesPresent(eventsIn: readonly EventRecord[]): { type: EventType; count: number }[] {
  const counts = new Map<string, number>();
  for (const event of eventsIn) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  return EVENT_TYPES.filter((type) => counts.has(type)).map((type) => ({
    type,
    count: counts.get(type) as number
  }))
}
