// src/lib/events.ts - the typed loader over data/events.json, and the place where
// a malformed events file stops the build.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND WHY IT THROWS
// ---------------------------------------------------------------------------
//
// src/lib/articles.ts loads a dataset that scripts/fetch-feeds.mjs wrote, so its
// shape is guaranteed by the code that wrote it and the loader can safely cast.
// data/events.json has no writer. It is filled in by hand and by an AI assistant
// working from a written description, which means a field can be misspelled and
// the site will render perfectly without it.
//
// So this loader VALIDATES, and on failure it THROWS with every problem listed.
//
// It throws rather than degrading, and that is the one deliberate departure from
// this project's stated fail-safe habit. The feed pipeline is allowed to keep
// serving yesterday's data because yesterday's data was correct and a stale
// calendar of PAST events is not a lie - the events happened. A malformed
// upcoming-events file is different: silently omitting one row, or rendering one
// at the wrong time, is the site asserting something untrue about a date on which
// somebody might turn up. So a bad events file fails the build loudly, and the
// committed file stays untouched for whoever is fixing it.
//
// The reader's answer to "if this were broken, how would I find out?" is
// therefore: `npm run build` goes red and names the offending path. That is a
// check, not somebody noticing the page looks wrong.
//
// For the friendlier report while editing, use `npm run events:check`, which
// runs the same validator without taking the build down with it.
//
// ---------------------------------------------------------------------------
// SAME RULE AS articles.ts: no Astro global, no import.meta.env, so that
// `node --test` and scripts/check-events.mjs can both import this module. All
// base-path handling belongs in src/lib/site.ts.
// ---------------------------------------------------------------------------

// The `.ts` specifiers here are required for bare Node to resolve them; see the
// longer note at the top of events-schema.ts. The JSON import attribute is the
// same form articles.ts already uses, which Node 24 supports natively.
import datasetJson from '../../data/events.json' with { type: 'json' }
import { validateEvents } from './events-schema.ts'
import type { EventRecord, PageNote } from './events-schema.ts'

export type { EventRecord, EventDataset, EventType, MonthGroup, PageNote } from './events-schema.ts'
export {
  EVENT_TYPES,
  EVENT_FIELDS,
  ALLOWED_EVENT_KEYS,
  isEventType,
  sortEvents,
  groupByMonth,
  monthKey,
  monthLabel,
  isPast,
  eventTypesPresent,
  formatEventDate,
  formatEventDateSpan,
  formatEventTime,
  formatEventZone,
  machineDateTime
} from './events-schema.ts'

// ---------------------------------------------------------------------------
// Load, validate, sort
// ---------------------------------------------------------------------------

const result = validateEvents(datasetJson)

if (!result.ok) {
  // Every problem, not the first. Somebody fixing a 40-row file wants the whole
  // list; the one-problem-at-a-time behaviour of a feed validator is wrong here.
  const lines = [
    '',
    `data/events.json FAILED VALIDATION: ${result.problems.length} problem(s).`,
    'The events page was not rendered. Fix the file and build again.',
    ''
  ]
  for (const item of result.problems) {
    lines.push(`  [${item.reason}] ${item.detail}`);
  }
  lines.push('')
  // Thrown at module scope, so it surfaces as a build error rather than as an
  // empty calendar - which is the failure this file exists to prevent.
  throw new Error(lines.join('\n'))
}

/** The validated events, chronologically ascending. */
export const events: EventRecord[] = result.events

/**
 * The date the list was last reviewed by a human: `YYYY-MM-DD`, or null.
 *
 * This is what the page splits past from upcoming on. It is IN THE DATA, not
 * read from the clock, because a build that renders "today" differently
 * depending on the day it ran is ROADMAP design rule 8 broken in the most literal
 * way available. See `reviewedOn` in src/lib/events-schema.ts.
 */
export const reviewedOn: string | null = result.reviewedOn

/**
 * The optional closing block of prose, or null when the file does not carry one.
 *
 * Null is an ordinary value, not a failure: most pages will not have one, and the
 * events page renders nothing at all when this is null rather than an empty section
 * with a heading over it. The validator rejects a `pageNote` whose paragraphs array
 * is empty precisely so that "no note" can never be expressed as "a note with
 * nothing in it".
 */
export const pageNote: PageNote | null = result.pageNote

/** How many events there are, for the page to state rather than have typed. */
export const eventCount: number = events.length
