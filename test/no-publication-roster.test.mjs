// test/no-publication-roster.test.mjs
//
// A CLIENT DECISION, and this file exists so that both halves of it stick.
//
// WHAT CHANGED, 2026-10-06. The home page carried a section headed "Where this
// writing comes from" listing every publication by name, and the About page
// carried the same roster. The client asked for the explicit advert of who the
// site pulls articles for to come off, partly because the roster reads as a
// showcase and partly because they expect to add and swap sources regularly.
//
// WHAT WAS DECIDED AGAINST, and why the line is drawn where it is. The client
// was offered four options and chose: remove the ROSTERS, keep PER-CARD
// ATTRIBUTION. The reasoning is the reason this test is worth having.
//
// Each card shows the article's title and a short excerpt. That excerpt is
// someone else's writing, quoted. Attribution on a card is not advertising, it
// is what makes quoting someone honest - a page that reproduces a paragraph of a
// named publication's work while removing every indication of whose work it is
// reads as though the site wrote it. So the name stays where the text is.
//
// Removed, because a roster is a showcase of who the curator reads and adds no
// information a reader needs: the home page already says in its own lede that it
// does not host the articles and links straight out to where the writing lives,
// and the footer already says every link leaves the site in a new tab.
//
// THE TWO ASSERTIONS
//   1. No page renders a roster. Publication names must not appear as a LIST.
//   2. The non-ownership disclosure must still be present. Removing the roster
//      is exactly the change that makes "this is not our writing" worth saying
//      out loud, so a cleanup that quietly dropped the disclaimer would have made
//      the site worse while looking like a tidy-up.
//
// The roster is detected by CLASS NAME rather than by searching for publication
// names, because the names themselves are still legitimately on every card.
// Searching for "Malone News" would fail the moment a source is added, and pass
// vacuously if the roster came back without that source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const DIST = join(PROJECT_ROOT, 'dist')

// Any of these appearing in built HTML means a roster came back.
const ROSTER_CLASSES = ['publications__list', 'publications__item', 'publications__heading']

// The claims that must survive the removal of the roster.
const DISCLOSURES = [
  {
    phrase: 'not affiliated with the SC Speakers Bureau',
    where: 'about/',
    why:
      'The non-affiliation claim. The roster used to imply these publications are ' +
      'associated with the Bureau by being printed on its own site; removing the ' +
      'roster without this sentence would leave that implication standing.'
  },
  {
    phrase: 'written and published by someone else',
    where: 'about/',
    why:
      'Says plainly that the quoted excerpts are not the Bureau\'s writing. This is ' +
      'the claim that matters most precisely BECAUSE the names are gone from the ' +
      'rosters.'
  },
  {
    phrase: 'We do not host these articles',
    where: 'every page listing articles',
    why:
      'The home page lede already carried this before the roster was removed, and ' +
      'it is what the removed section used to repeat.'
  }
]

async function collectHtml(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await collectHtml(full, out)
    else if (entry.name.endsWith('.html')) out.push(full)
  }
  return out
}

test('no page renders a roster of publication names', async (t) => {
  assert.ok(existsSync(DIST), 'positive control: dist/ must exist. Run `npm run build` first.')

  const pages = await collectHtml(DIST)
  assert.ok(pages.length > 0, 'positive control: dist/ must contain built HTML')

  const rosters = []
  for (const page of pages) {
    const text = await readFile(page, 'utf8')
    const rel = page.replace(`${DIST}\\`, '').replace(`${DIST}/`, '')
    for (const cls of ROSTER_CLASSES) {
      if (text.includes(cls)) rosters.push(`${rel} renders "${cls}"`)
    }
  }

  t.diagnostic(
    `checked ${pages.length} built pages for ${ROSTER_CLASSES.length} roster markers`
  )
  assert.deepEqual(
    rosters,
    [],
    `a publication roster is back. The client removed it on purpose:\n  ${rosters.join('\n  ')}`
  )
})

test('the non-ownership disclosures survived the removal', async (t) => {
  const pages = await collectHtml(DIST)
  assert.ok(pages.length > 0, 'positive control: dist/ must contain built HTML')

  const raw = (await Promise.all(pages.map((p) => readFile(p, 'utf8')))).join('\n')

  // WHITESPACE IS COLLAPSED FIRST, and that is not cosmetic. Astro preserves the
  // line breaks of the template, so a sentence written across two source lines is
  // emitted as "...are not\n        affiliated with..." and a raw substring search
  // for it finds nothing. The first version of this test failed on exactly that
  // and reported a disclosure as missing while it was plainly on the page - a
  // false alarm that would have sent someone hunting for a problem that did not
  // exist. Searching rendered prose means searching rendered prose.
  const corpus = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase()

  const missing = DISCLOSURES.filter(
    ({ phrase }) => !corpus.includes(phrase.toLowerCase())
  ).map(({ phrase, where, why }) => `"${phrase}" (expected on ${where}) - ${why}`)

  t.diagnostic(`checked ${DISCLOSURES.length} disclosures are still present`)
  assert.deepEqual(
    missing,
    [],
    `removing the roster must not remove the honesty that came with it:\n  ${missing.join('\n  ')}`
  )
})

test('POSITIVE CONTROL: both detectors can still fire', async (t) => {
  // 1. The roster detector, against a roster exactly as it used to be rendered.
  const oldHome = `
    <section class="publications" aria-labelledby="publications-heading">
      <h2 class="label publications__heading">Where this writing comes from</h2>
      <ul class="publications__list"><li class="publications__item">Some Publication</li></ul>
    </section>`
  const caught = ROSTER_CLASSES.filter((cls) => oldHome.includes(cls))
  assert.deepEqual(
    caught.sort(),
    [...ROSTER_CLASSES].sort(),
    'every roster marker class must be detected, or removing one would pass'
  )

  // 2. The disclosure detector, on a corpus that has lost them. This check passes
  //    trivially on an empty corpus, so prove it looks.
  const stripped = '<html><body><p>A page with nothing honest on it.</p></body></html>'
  const missingFromStripped = DISCLOSURES.filter(
    ({ phrase }) => !stripped.toLowerCase().includes(phrase.toLowerCase())
  )
  assert.equal(
    missingFromStripped.length,
    DISCLOSURES.length,
    'a corpus with none of the disclosures must report all of them missing'
  )

  t.diagnostic(
    `planted roster trips ${caught.length} marker(s); stripped corpus reports all ${DISCLOSURES.length} disclosures missing`
  )
})
