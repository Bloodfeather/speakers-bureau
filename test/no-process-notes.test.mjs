// test/no-process-notes.test.mjs
//
// WHY THIS FILE EXISTS.
//
// The About page once carried a heading reading "This page is a placeholder", a
// paragraph explaining that the organisation's story "has not been supplied yet",
// and a promise that a later phase would replace the section. A topic page told a
// reader that its tag was assigned "in data/sources.yml". The masthead shipped a
// provisional-copy marker as an HTML attribute on every page.
//
// None of that was a bug. It parsed, it built, it passed every other test in this
// repository, and it published. It read as a builder's notes about its own progress
// rather than as words written for a visitor, and nothing in the suite could see the
// difference, because every other test asserts that something IS present and nothing
// asserted that a particular kind of text was ABSENT.
//
// This file is that missing assertion. It is the same lesson as
// test/no-comment-leak.test.mjs, one layer up: that guard stops comment prose
// reaching a built page, this one stops a placeholder notice reaching one.
//
// THE OTHER DIRECTION MATTERS TOO. A well-meaning tidy-up can also remove an honest
// disclosure because it reads like bookkeeping. So there is an ALLOWED list as well
// as a forbidden one, and the suite fails if a deliberate disclosure disappears.
//
// WHAT IS CHECKED
//   1. No built page contains a phrase that only ever appeared in notes about the
//      work. Measured against dist/, case-insensitively.
//   2. Every deliberate disclosure is still present on the site.
//   3. Positive controls proving both detectors fire, run against the SAME pure
//      functions the real assertions use, so the controls cannot drift from them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const DIST = join(PROJECT_ROOT, 'dist')

/**
 * Text that must never reach a reader.
 *
 * Every entry is a phrase this project actually put on the site, or a phrase a
 * placeholder of this kind is made of. `why` is not decoration: it is the reason a
 * future maintainer does not helpfully add the word back, and it is what makes a
 * failure message worth more than the phrase that tripped it.
 *
 * Matched case-INSENSITIVELY, because "Placeholder" and "placeholder" are the same
 * note to a reader.
 */
const PROCESS_NOTES = [
  {
    phrase: 'placeholder',
    why:
      'Used as a page heading and in body copy on the old About page. It is also the ' +
      'word the generated EVENT ARTWORK prints on itself, but that text lives in ' +
      'public/img/events/*.svg and is asserted by test/placeholders.test.mjs - it is ' +
      'drawn as pixels on an image, which is the one honest way to say an event has no ' +
      'photograph. This guard reads .html only, so the two rules do not collide.'
  },
  {
    phrase: 'provisional',
    why:
      'The masthead shipped data-provisional="tagline" on every page while its tagline ' +
      'was project-written copy. The marker went with the copy that needed it.'
  },
  {
    phrase: 'not been supplied',
    why:
      'About page: "the organisation\'s own story, its purpose and the names of the ' +
      'people behind it have not been supplied yet". Spelled this way on purpose: the ' +
      'first version of this entry said "not yet supplied", which is a different word ' +
      'order and matched nothing. The positive control below caught that.'
  },
  {
    phrase: 'not yet supplied',
    why: 'The same hedge in the other word order, which is what a later writer reaches for.'
  },
  {
    phrase: 'to be written',
    why:
      'The standard hedge of a page that is not finished. A page that is not finished ' +
      'should say nothing rather than announce itself.'
  },
  {
    phrase: 'sources.yml',
    why:
      'A topic page with no articles named the internal file holding the tag list. The ' +
      'behaviour is worth explaining to a reader; the filename is build scaffolding.'
  },
  { phrase: 'build-log.md', why: 'An internal file. No reader can open it.' },
  { phrase: 'ROADMAP.md', why: 'An internal file. No reader can open it.' },
  { phrase: 'TODO', why: 'A work marker in shipped copy.' },
  { phrase: 'FIXME', why: 'A work marker in shipped copy.' },
  {
    phrase: 'example.org',
    why:
      'The placeholder domain still sitting in astro.config.mjs. It renders nowhere ' +
      'today because no page emits a canonical URL, so this entry is armed for the page ' +
      'that does. Do not silence it by adding example.org to the ALLOWED list - set `site` ' +
      'to the real domain.'
  },
  {
    phrase: 'coming soon',
    why: 'A promise about work in progress, which is the process note in its commonest costume.'
  },
  { phrase: 'lorem', why: 'Filler text.' }
]

/**
 * Text that IS on the site on purpose and must not be swept away by this guard.
 */
const ALLOWED = [
  {
    phrase: 'Last reviewed',
    why:
      'The only thing telling a reader when civic dates were last checked against a ' +
      'source. Present on /events/ only; the same phrase was removed from the home page, ' +
      'where it was an audit stamp wedged mid-sentence.'
  },
  {
    phrase: 'not an archive',
    why:
      'The window disclosure. Feeds hold only recent posts, so saying what the site is ' +
      'not is the product, not a disclaimer.'
  },
  {
    phrase: 'last checked',
    why:
      'When the feeds were last fetched, in the footer. A reader deciding whether a ' +
      'window of posts is stale needs it.'
  }
]

/**
 * Pure: the process-note phrases present in one page's text.
 *
 * Kept pure and separate so the positive control can call it directly. A control
 * that re-implements the matching is a control of its own reimplementation.
 */
export function findProcessNotes(text) {
  const lower = text.toLowerCase()
  return PROCESS_NOTES.filter(({ phrase }) => lower.includes(phrase.toLowerCase()))
}

/** Pure: the deliberate disclosures absent from a corpus of page text. */
export function findMissingDisclosures(corpus) {
  const lower = corpus.toLowerCase()
  return ALLOWED.filter(({ phrase }) => !lower.includes(phrase.toLowerCase()))
}

async function collectHtml(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await collectHtml(full, out)
    else if (entry.name.endsWith('.html')) out.push(full)
  }
  return out
}

test('no built page carries a note about the work', async (t) => {
  // Worthless if dist/ is absent, because then "no note" is trivially true.
  assert.ok(
    existsSync(DIST),
    'positive control: dist/ must exist. Run `npm run build` before this suite, or ' +
      'this test cannot detect anything.'
  )

  const pages = await collectHtml(DIST)
  assert.ok(pages.length > 0, 'positive control: dist/ must contain built HTML')

  const leaks = []
  for (const page of pages) {
    const text = await readFile(page, 'utf8')
    const rel = page.replace(`${DIST}\\`, '').replace(`${DIST}/`, '')
    for (const { phrase, why } of findProcessNotes(text)) {
      leaks.push(`${rel} contains "${phrase}" - ${why}`)
    }
  }

  t.diagnostic(
    `checked ${pages.length} built pages against ${PROCESS_NOTES.length} process-note phrases`
  )
  assert.deepEqual(
    leaks,
    [],
    `a note about the build has reached a reader:\n  ${leaks.join('\n  ')}`
  )
})

test('the deliberate disclosures are still on the site', async (t) => {
  const pages = await collectHtml(DIST)
  assert.ok(pages.length > 0, 'positive control: dist/ must contain built HTML')

  const corpus = (await Promise.all(pages.map((p) => readFile(p, 'utf8')))).join('\n')
  const missing = findMissingDisclosures(corpus).map(
    ({ phrase, why }) => `"${phrase}" is gone - ${why}`
  )

  t.diagnostic(`checked ${ALLOWED.length} disclosures are still present`)
  assert.deepEqual(
    missing,
    [],
    `an honest disclosure has been removed:\n  ${missing.join('\n  ')}`
  )
})

test('POSITIVE CONTROL: the process-note detector fires', async (t) => {
  // A page shaped exactly like the one that shipped.
  const planted = [
    '<p class="label">About</p>',
    '<h2>This page is a placeholder</h2>',
    '<p>The organisation\'s own story has not been supplied yet. More to be written.</p>',
    '<p class="tagline" data-provisional="tagline">Coming soon</p>'
  ].join('\n')

  const caught = findProcessNotes(planted).map(({ phrase }) => phrase)

  for (const expected of ['placeholder', 'provisional', 'not been supplied', 'to be written', 'coming soon']) {
    assert.ok(
      caught.includes(expected),
      `the detector must catch a planted "${expected}" notice, or this suite proves nothing`
    )
  }
  t.diagnostic(`a planted placeholder page trips ${caught.length} phrases: ${caught.join(', ')}`)
})

test('POSITIVE CONTROL: the disclosure detector fires on an absence', async (t) => {
  // The allowed-side check has an unusual failure mode: it passes trivially if the
  // corpus is empty, because everything is missing only if you look. Prove it looks,
  // and that it is satisfied by the real corpus and unsatisfied by a stripped one.
  const stripped = '<html><body><p>An ordinary page with no disclosures at all.</p></body></html>'
  const missingFromStripped = findMissingDisclosures(stripped).map(({ phrase }) => phrase)

  assert.equal(
    missingFromStripped.length,
    ALLOWED.length,
    'a corpus containing none of the disclosures must report all of them missing'
  )

  const present = ALLOWED.map(({ phrase }) => phrase).join(' ')
  assert.deepEqual(
    findMissingDisclosures(present),
    [],
    'a corpus containing every disclosure must report none missing, or the check ' +
      'could never pass on the real site'
  )

  t.diagnostic(
    `an empty corpus reports all ${ALLOWED.length} disclosures missing; a complete one reports none`
  )
})
