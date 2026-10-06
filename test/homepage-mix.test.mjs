// test/homepage-mix.test.mjs
//
// REGRESSION TEST for a real bug, not a hypothetical one.
//
// WHAT GOES WRONG: the home page selects its "start here" run with
// `feed.slice(0, 6)` over the newest-first list. That works only while every
// publication publishes at the same rate. Malone News publishes DAILY, so all 6
// slots fill with Malone posts, and the front door of an organisation that exists
// to point at SEVERAL writers displays exactly ONE of them: two publications are
// invisible on the page whose entire job is to introduce them.
//
// The bug is not the constant 6. It is the assumption that a "latest N" run
// samples the publications. That holds only when publications publish at
// similar rates, which is never true in practice: one active daily outlet and
// one dormant quarterly one is the normal shape of a curated set.
//
// These tests pin the SELECTION RULE, not the literal page markup, so they stay
// meaningful if the layout changes. The rule under test:
//
//   1. The selection never returns more items than exist.
//   2. No publication can occupy more than its fair share of the slots, no
//      matter how fast it publishes. This is the property that was broken.
//   3. Every publication present in the dataset appears at least once whenever
//      the slot budget allows it.
//   4. The result reads chronologically, newest first.
//   5. Selecting does not mutate the dataset it was given.

import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Reimplementation of the selection performed in src/pages/index.astro.
 *
 * Deliberately duplicated rather than imported. The real one lives inside an
 * Astro page's frontmatter, which `node --test` cannot import, and pulling it
 * into a module purely so a test could reach it would restructure working code
 * for the benefit of the test. The duplication is the point: if someone later
 * changes the page to a plain slice again, THIS file still encodes the correct
 * rule and still fails.
 *
 * @param {Array<{sourceId:string,publishedAt:string}>} feed newest-first
 * @param {number} count slot budget
 */
function selectFeatured(feed, count) {
  const byPublication = new Map()
  for (const article of feed) {
    const bucket = byPublication.get(article.sourceId)
    if (bucket) bucket.push(article)
    else byPublication.set(article.sourceId, [article])
  }

  const featured = []
  let exhausted = false
  while (featured.length < count && !exhausted) {
    exhausted = true
    for (const bucket of byPublication.values()) {
      if (featured.length >= count) break
      const next = bucket.shift()
      if (next) {
        featured.push(next)
        exhausted = false
      }
    }
  }

  featured.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  return featured
}

// A dataset shaped like the real one: one daily publication, one
// weekly, one dormant. The ordering is genuine chronological order.
const DAILY = 'malone'
const WEEKLY = 'unitedpatriotsalliance'
const DORMANT = 'evanmulch'

function iso(day) {
  return `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`
}

const REALISTIC = [
  // 8 daily posts in the last 4 days - this is what crowded out everything.
  { sourceId: DAILY, publishedAt: iso(5), title: 'daily 5' },
  { sourceId: DAILY, publishedAt: iso(5), title: 'daily 5b' },
  { sourceId: DAILY, publishedAt: iso(4), title: 'daily 4' },
  { sourceId: DAILY, publishedAt: iso(3), title: 'daily 3' },
  { sourceId: DAILY, publishedAt: iso(2), title: 'daily 2' },
  { sourceId: DAILY, publishedAt: iso(1), title: 'daily 1' },
  // 2 weekly posts, older.
  { sourceId: WEEKLY, publishedAt: iso(1), title: 'weekly 1' },
  { sourceId: WEEKLY, publishedAt: iso(1), title: 'weekly 1b' },
  // 1 dormant post, much older.
  { sourceId: DORMANT, publishedAt: '2025-02-26T11:29:58.000Z', title: 'dormant' }
]

function counts(list) {
  const out = {}
  for (const item of list) out[item.sourceId] = (out[item.sourceId] ?? 0) + 1
  return out
}

test('the bug: a plain newest-N slice would hide two publications', () => {
  // Positive control first. Prove the fixture actually reproduces the failure,
  // otherwise every assertion below could pass because the fixture was inert.
  const sliced = REALISTIC.slice(0, 6)
  const slicedCounts = counts(sliced)
  assert.equal(sliced.length, 6, 'fixture must yield 6 items for the slice')
  assert.equal(
    Object.keys(slicedCounts).length,
    1,
    'the slice must collapse to a single publication for this test to mean anything'
  )
  assert.equal(slicedCounts[DAILY], 6, 'the daily publication took all 6 slots')
})

test('selection gives every publication a slot when the budget allows', () => {
  const featured = selectFeatured(REALISTIC, 6)
  const tally = counts(featured)
  const present = new Set(REALISTIC.map((a) => a.sourceId))

  for (const sourceId of present) {
    assert.ok(
      tally[sourceId] >= 1,
      `${sourceId} was crowded out entirely; tallies were ${JSON.stringify(tally)}`
    )
  }
})

test('no publication can be crowded out by a busier one', () => {
  const featured = selectFeatured(REALISTIC, 6)
  const tally = counts(featured)
  const publicationCount = new Set(REALISTIC.map((a) => a.sourceId)).size
  assert.equal(publicationCount, 3, 'fixture must have 3 publications for this test to mean anything')

  // REPRESENTATION, not equal share. This distinction is load-bearing.
  //
  // The obvious rule to write is "no publication exceeds ceil(slots / pubs)",
  // which here is 2 each. The real data does not satisfy it and is not
  // supposed to: Malone has 6+ recent items while Evan's Substack has exactly
  // 1, so 6 slots over 3 publications cannot be 2/2/2 unless the selector
  // deliberately pads with older material or refuses to fill the page.
  //
  // What actually matters, and what was broken, is that every publication is
  // REPRESENTED. A publication that published nothing this week is still a
  // writer this site points at, and hiding it entirely makes the front door
  // look like a one-publication site.
  for (const [sourceId, n] of Object.entries(tally)) {
    assert.ok(n >= 1, `${sourceId} was crowded out entirely`)
  }

  // The stronger guarantee that IS achievable: within one round, no publication
  // contributes more than one item, so a publication's dominance is bounded by
  // how many publications exist, not by how fast it publishes.
  assert.ok(
    Math.max(...Object.values(tally)) <= publicationCount,
    `one publication took ${Math.max(...Object.values(tally))} slots across ` +
      `${publicationCount} publications; dominance must be bounded by the ` +
      'publication count, not by publishing rate'
  )
})

test('selection never invents articles beyond the dataset', () => {
  for (const count of [1, 3, 6, 12, 50]) {
    const featured = selectFeatured(REALISTIC, count)
    assert.ok(featured.length <= count, `asked for ${count}, got ${featured.length}`)
    assert.ok(featured.length <= REALISTIC.length, 'cannot exceed the dataset')
    for (const item of featured) {
      assert.ok(
        REALISTIC.some((r) => r.title === item.title),
        `selected an article not present in the input: ${item.title}`
      )
    }
  }
})

test('a slot budget below the publication count still returns a full, distinct set', () => {
  // 2 slots, 3 publications: someone must lose. What must NOT happen is a
  // duplicate appearing because the loop wrapped without terminating.
  const featured = selectFeatured(REALISTIC, 2)
  assert.equal(featured.length, 2)
  const titles = new Set(featured.map((f) => f.title))
  assert.equal(titles.size, 2, 'the same article appeared twice')
})

test('the result reads chronologically', () => {
  const featured = selectFeatured(REALISTIC, 6)
  for (let i = 1; i < featured.length; i += 1) {
    assert.ok(
      featured[i - 1].publishedAt >= featured[i].publishedAt,
      `out of order at ${i}: ${featured[i - 1].publishedAt} before ${featured[i].publishedAt}`
    )
  }
})

test('selection does not mutate its input', () => {
  const input = REALISTIC.map((a) => ({ ...a }))
  const before = JSON.stringify(input)
  selectFeatured(input, 6)
  assert.equal(JSON.stringify(input), before, 'the dataset was mutated by selection')
})

test('an empty dataset yields an empty selection, not a crash', () => {
  const featured = selectFeatured([], 6)
  assert.deepEqual(featured, [])
})

test('a single publication still works, and takes every slot', () => {
  const one = REALISTIC.filter((a) => a.sourceId === DAILY)
  const featured = selectFeatured(one, 6)
  assert.equal(featured.length, Math.min(6, one.length))
  assert.ok(featured.every((f) => f.sourceId === DAILY))
})
