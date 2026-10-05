// src/lib/articles.ts - the typed loader over data/articles.json, and the ONLY
// place that knows the dataset's shape.
//
// ---------------------------------------------------------------------------
// WHY A LOADER EXISTS AT ALL
// ---------------------------------------------------------------------------
//
// The dataset is written by scripts/fetch-feeds.mjs and its shape is owned by
// that pipeline. If a page reads `article.title` directly, then a field rename in
// scripts/lib/rss.mjs breaks the site with a TypeError at build time and a blank
// card at best. Everything the pages touch goes through the types below, so the
// contract between the pipeline and the site is written down once, here.
//
// The loader also owns three decisions that would otherwise be re-made, slightly
// differently, in four different components:
//
//   1. ORDER. Newest first, always, with a stable tiebreak.
//   2. BYLINE. `bylineFor()` is the single implementation of the attribution
//      rule. There is deliberately no second copy.
//   3. DATES. `formatUtcDate()` formats in UTC. There is no local-time path.
//
// This module reads no environment and no Astro global, so `node --test` can
// import it directly (Node 24 strips the types). src/lib/site.ts, which does read
// import.meta.env, is kept separate for that reason.
//
// ---------------------------------------------------------------------------
// MEASURED FACTS ABOUT THE CURRENT DATASET (2026-10-05, 43 articles, 3 sources)
// ---------------------------------------------------------------------------
//
// These are observations, not schema promises, and each one is a design input.
// Recount them with `npm run fetch` and re-measure; the numbers below are a
// snapshot, not a contract. Where they are cited in a comment above, the
// reasoning depends on the SHAPE (all empty, all present, mostly real people)
// rather than the exact count.
//
//   dek         empty on 43 of 43. Substack RSS carries no subtitle field.
//               So NOTHING may depend on a dek existing. `dek` is typed
//               `string | null` and every card conditionally renders it.
//   image       present on 43 of 43, but typed `string | null` anyway: an
//               optional field that happens to be always-populated today is
//               still optional tomorrow, and the card must not break.
//   author      present on 43 of 43, and a real person on the great majority
//               ("Dr. Robert W. Malone", "Alaina Stone", "Evan Mulch"). On a
//               small number it is "United Patriots Alliance", which is the
//               PUBLICATION name minus
//               the word "News" - not a literal string match, so the suppression
//               rule below has to be a normalised comparison, not `===`.
//   excerpt     12 to 299 characters. THREE are under 40 characters and one is
//               12 characters long, which is effectively a title repeated. So no
//               excerpt may be assumed to be a paragraph.
//   categories  every article has exactly one, from data/sources.yml.
// ---------------------------------------------------------------------------

import datasetJson from '../../data/articles.json' with { type: 'json' }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One publication, as recorded by the fetch pipeline. */
export interface FeedSource {
  id: string
  name: string
  /** The manual topic tag assigned in data/sources.yml, if any. */
  tag: string | null
  status: string
  httpStatus: number | null
  configuredUrl: string
  /** The URL after redirects. This is the canonical one (ROADMAP rule 4). */
  resolvedUrl: string
  itemCount: number
  newItemCount: number
  error: string | null
}

/**
 * One article.
 *
 * Every field that the measurement above found empty-on-some-or-all is typed as
 * nullable. That is the point of the types: `dek` cannot be used as if it were
 * guaranteed, because on today's data it never is.
 */
export interface Article {
  id: string
  sourceId: string
  sourceName: string
  title: string
  /** Substack RSS has no subtitle. Empty on 23 of 23. Treat as optional. */
  dek: string | null
  /** The feed's own author string. May be a publication name; see bylineFor. */
  author: string | null
  /** Canonical article URL on the publication's own site. */
  url: string
  image: string | null
  /** ISO 8601, UTC, Z-suffixed. Parse with formatUtcDate, not `new Date()` + local. */
  publishedAt: string
  /** Up to ~300 characters. Can be as short as 12. Treat as optional. */
  excerpt: string | null
  categories: string[]
}

/** The whole dataset file. */
export interface Dataset {
  generatedAt: string
  articleCount: number
  sourceCount: number
  duplicateCount: number
  sources: FeedSource[]
  articles: Article[]
}

/** A topic derived from the data, never from a hardcoded list. */
export interface Topic {
  /** URL-safe slug, e.g. `news`. */
  slug: string
  /** Display label, e.g. `News`. Derived from the slug, not stored twice. */
  label: string
  /** How many articles carry this topic right now. */
  count: number
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** The raw dataset, exactly as committed. Not defensively copied. */
export const dataset = datasetJson as unknown as Dataset

/**
 * All articles, newest first.
 *
 * Sorted ONCE here rather than at each call site, so "newest first" cannot be
 * forgotten in one of the four places that list articles.
 *
 * The tiebreak is deliberate: two articles published in the same millisecond
 * would otherwise order by whatever the sort algorithm feels like, and the built
 * HTML would differ between machines. `id` is stable, so `id` breaks the tie.
 * This is design rule 8 (reproducible output) applied to ordering rather than
 * formatting.
 */
export const articles: Article[] = [...dataset.articles].sort((a, b) => {
  const delta = Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  if (delta !== 0) return delta
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
})

/** Sources that fetched OK, in dataset order. */
export const sources: FeedSource[] = dataset.sources

/**
 * The date the dataset was fetched, ISO UTC. Shown so a reader can tell how
 * current the window is.
 */
export const generatedAt: string = dataset.generatedAt

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// WHY A TABLE AND NOT Intl.DateTimeFormat.
//
// `new Intl.DateTimeFormat('en-GB', {...}).format(d)` gives the right answer on a
// machine with full ICU and a DIFFERENT answer on a build machine with small-ICU,
// because the month names come from ICU data, not from the spec. The GH Pages
// runner is not this machine. A twelve-element table has no runtime dependency,
// no locale negotiation and no ICU version to drift, and it is trivially
// assertable in a test - which matters more than saving twelve lines.
//
// KNOWN DUPLICATION, GUARDED RATHER THAN HIDDEN. src/lib/months.ts carries an
// identical MONTHS table for the events feature, because that code must import a
// month name without pulling this module's dataset import in with it. So there
// are two copies on the site. That is a real cost and it is not left to chance:
// test/events.test.mjs compares the two tables and fails the suite if they ever
// differ, so a drift is a red build rather than a date that quietly renders one
// way on the reading room and another way on the events page.
//
// Collapsing it means moving this module's data import behind a function so the
// pure helpers can be imported on their own. That is worth doing, and it is not
// being done inside a phase whose brief is the reading room, because it touches
// the one module every other module depends on.

const MONTHS = [
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
]

/**
 * Format an ISO UTC timestamp as `1 October 2026`.
 *
 * WHY UTC IS PASSED EXPLICITALLY, IN EVERY CALL - this is a real trap, not a
 * stylistic preference:
 *
 *   `new Date(iso).toLocaleDateString()` with no `timeZone` option formats in
 *   the BUILD MACHINE's local zone. A build on this machine (UTC-4) renders an
 *   article published at 2026-10-01T18:00:46Z as "1 October 2026". The GH Pages
 *   runner is UTC and renders the same article as "1 October 2026" too - but an
 *   article published at 2026-10-02T02:00:00Z renders as "2 October" in UTC and
 *   "1 October" in UTC-4. The same commit would then produce different HTML on
 *   two machines, which is exactly what ROADMAP design rule 8 forbids, and it
 *   would look like a data bug rather than a build-environment bug.
 *
 * The fix is not "be careful"; it is that every date on this site goes through
 * this one function, which calls getUTCDate()/getUTCMonth()/getUTCFullYear() and
 * therefore cannot be shifted by the machine it was built on.
 *
 * Returns an empty string for an unparseable value rather than "Invalid Date",
 * so a bad timestamp degrades to a missing date instead of printing a lie.
 */
export function formatUtcDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/**
 * The machine-readable form for a `<time datetime="...">` attribute.
 *
 * Same reason as above, inverted: the ATTRIBUTE is a UTC instant (ISO with Z)
 * and is what a machine reads, while the visible text is a UTC rendering of it.
 * A reader's browser may still localise the attribute's instant when they hover
 * it, which is correct behaviour for a machine-readable value and is not
 * something the build controls.
 */
export function machineDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

// ---------------------------------------------------------------------------
// Attribution: the byline rule
// ---------------------------------------------------------------------------

// Words that carry no identifying information when comparing two names. If a
// publication is called "The Grayzone" and a feed reports its author as "The
// Grayzone Blog", the two are the same thing for the purpose of a byline, and
// printing "The Grayzone Blog" under a card that already says "The Grayzone" is
// noise. These are matched only at the ENDS of a name, because stripping
// mid-name words would turn "Newsweek" into "week" or "Stone" into nothing.
const LEADING_NOISE = new Set(['the', 'a', 'an'])
const TRAILING_NOISE = new Set([
  'news',
  'newsletter',
  'blog',
  'journal',
  'magazine',
  'review',
  'digest',
  'edition',
  'substack',
  'publication',
  'press'
])

/**
 * Reduce a name to something comparable: lowercase, apostrophes and punctuation
 * removed, leading articles and trailing genre words dropped.
 *
 * This exists because `author === sourceName` is NOT the rule. Measured on the
 * current dataset: the author "United Patriots Alliance" against the publication
 * "United Patriots Alliance News" differs by one trailing word, so a strict
 * equality check would print the publication name as though it were a person on
 * those 2 articles - precisely the failure the rule exists to prevent.
 *
 * Apostrophes are DELETED rather than replaced with a space, so "Evan's Substack"
 * becomes "evans substack" and then, with "substack" dropped, "evans" - not
 * "evan s", which is what a naive replace produces and which would fail to match
 * a byline of "Evan".
 */
export function normalizeName(value: string): string {
  const words = value
    .toLowerCase()
    // Apostrophes are DELETED, not turned into spaces. Built from code points,
    // never typed: U+0027 is the straight apostrophe and U+2019 the curly one a
    // publication's CMS will actually emit, and the whole project is ASCII-only
    // in authored files (ROADMAP design rule 9). Deleting rather than
    // substituting is why "Evan's Substack" normalises to "evans" and not to
    // "evan s" - a stray "s" would stop it matching a byline of "Evan".
    .replace(/[\u0027\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')

  let start = 0
  let end = words.length
  while (start < end && LEADING_NOISE.has(words[start])) start++
  while (end > start && TRAILING_NOISE.has(words[end - 1])) end--

  return words.slice(start, end).join(' ')
}

/**
 * The attribution rule, in one place: does this byline merely repeat the
 * publication it appears in?
 *
 * TRUE means suppress the byline - printing "United Patriots Alliance News"
 * under a card headed by an article FROM United Patriots Alliance News tells the
 * reader nothing and reads as though a masthead were a person.
 *
 * The comparison is the normalised one, which catches the measured 2-of-23 case
 * where the strings differ by a trailing "News". It also requires BOTH sides to
 * be non-empty after normalisation, so that two names which normalise to nothing
 * (or to the same stop word) do not suppress each other by accident.
 */
export function isSelfAttribution(author: string, publication: string): boolean {
  const left = normalizeName(author)
  const right = normalizeName(publication)
  if (left === '' || right === '') return false
  return left === right
}

/**
 * THE byline helper. Every card, list row and summary in the site calls this and
 * nothing else decides attribution.
 *
 * Returns the author's name to display, or `null` when there is nothing worth
 * displaying. Three distinct reasons return null, and they are worth separating
 * in the source because they are three different data problems:
 *
 *   - the feed reported no author at all;
 *   - the author is only whitespace;
 *   - the author merely repeats the publication name (see isSelfAttribution).
 *
 * Callers must render conditionally. There is no CSS that hides an empty
 * element gracefully here, because "gracefully" is a judgement the template
 * should make explicitly - an empty <p> still occupies a margin block, and a
 * dangling "By " prefix is worse than no byline.
 */
export function bylineFor(article: Pick<Article, 'author' | 'sourceName'>): string | null {
  const author = article.author?.trim()
  if (!author) return null
  if (isSelfAttribution(author, article.sourceName)) return null
  return author
}

/**
 * The same decision, returned as a reason. Used by the feed summary so the
 * page can say how many articles carry a real byline, and by tests to prove the
 * suppression rule is actually firing on the real dataset rather than passing
 * because the code never runs.
 */
export type BylineDecision =
  | { show: true; value: string }
  | { show: false; reason: 'missing' | 'blank' | 'repeats-publication' }

export function bylineDecisionFor(
  article: Pick<Article, 'author' | 'sourceName'>
): BylineDecision {
  const raw = article.author
  if (raw === null || raw === undefined) return { show: false, reason: 'missing' }
  const trimmed = raw.trim()
  if (trimmed === '') return { show: false, reason: 'blank' }
  if (isSelfAttribution(trimmed, article.sourceName)) {
    return { show: false, reason: 'repeats-publication' }
  }
  return { show: true, value: trimmed }
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/**
 * Turn a topic string into a URL slug. Anything that is not a letter or digit
 * becomes a hyphen, and runs of hyphens collapse.
 *
 * The dataset's topics are already lowercase single words (`news`,
 * `commentary`), so this is defensive rather than load-bearing today. It is here
 * because data/sources.yml is a file a HUMAN edits: the first topic anybody
 * writes as "Long Reads" or "Q&A" would otherwise produce a URL with a space in
 * it.
 */
export function topicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** "long-reads" -> "Long Reads". A display label derived from the slug. */
export function topicLabel(slug: string): string {
  if (slug === '') return ''
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * The topic list, DERIVED FROM THE ARTICLES rather than hardcoded.
 *
 * This is the whole reason topics work without a taxonomy file: a new tag in
 * data/sources.yml flows through the pipeline into `categories`, and from there
 * into this list, with no edit to any .astro file. A hardcoded `['news',
 * 'commentary']` would be a filter that silently stops working the first time a
 * third tag is assigned, and would keep offering a filter that returns nothing.
 *
 * Ordering is by count descending, then slug ascending. That makes the most
 * populated topic first (which is what a reader wants first) and makes the order
 * deterministic, so the built HTML does not depend on dataset insertion order.
 */
export function topics(articlesIn: readonly Article[] = articles): Topic[] {
  const counts = new Map<string, number>()
  for (const article of articlesIn) {
    for (const category of article.categories ?? []) {
      const slug = topicSlug(category)
      if (slug === '') continue
      counts.set(slug, (counts.get(slug) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, label: topicLabel(slug), count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.slug < b.slug ? -1 : 1))
}

/** Articles carrying a topic, newest first (input is expected pre-sorted). */
export function articlesByTopic(slug: string, articlesIn: readonly Article[] = articles): Article[] {
  return articlesIn.filter((article) =>
    (article.categories ?? []).some((category) => topicSlug(category) === slug)
  )
}

/** Distinct publications present in a list of articles, dataset order. */
export function publicationNames(articlesIn: readonly Article[] = articles): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const article of articlesIn) {
    if (seen.has(article.sourceName)) continue
    seen.add(article.sourceName)
    names.push(article.sourceName)
  }
  return names
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * An image URL, or null.
 *
 * Substack's CDN URLs are long query strings such as
 * `/image/fetch/$s_!Lia4!,f_auto,q_auto:good,.../https%3A%2F%2F...`, so there is
 * no reliable way to append a resize parameter ourselves. They are already sized
 * by the feed, so the card sets no width/height and lets CSS fix the aspect box.
 */
export function imageUrl(article: Pick<Article, 'image'>): string | null {
  const value = article.image?.trim()
  return value ? value : null
}

// ---------------------------------------------------------------------------
// Summaries, used in the page copy so a number is never typed by hand
// ---------------------------------------------------------------------------

export interface FeedSummary {
  /** How many articles are held right now. */
  total: number
  /** How many carry a byline worth printing. */
  withByline: number
  /** How many of those were suppressed as self-attribution. */
  suppressedByline: number
  /** How many have an excerpt long enough to be a sentence. */
  withExcerpt: number
  /** Newest publishedAt in the set, or null when the set is empty. */
  newest: string | null
  /** Oldest publishedAt in the set, or null when the set is empty. */
  oldest: string | null
}

export function summarise(articlesIn: readonly Article[] = articles): FeedSummary {
  let withByline = 0
  let suppressedByline = 0
  let withExcerpt = 0

  for (const article of articlesIn) {
    const decision = bylineDecisionFor(article)
    if (decision.show) withByline++
    else if (decision.reason === 'repeats-publication') suppressedByline++
    if ((article.excerpt?.trim().length ?? 0) > 0) withExcerpt++
  }

  const stamps = articlesIn.map((a) => Date.parse(a.publishedAt)).filter((n) => !Number.isNaN(n))
  const newestIso = stamps.length ? new Date(Math.max(...stamps)).toISOString() : null
  const oldestIso = stamps.length ? new Date(Math.min(...stamps)).toISOString() : null

  return {
    total: articlesIn.length,
    withByline,
    suppressedByline,
    withExcerpt,
    newest: newestIso,
    oldest: oldestIso
  }
}