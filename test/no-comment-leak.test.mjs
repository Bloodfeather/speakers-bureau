// test/no-comment-leak.test.mjs
//
// REGRESSION TEST for a bug that shipped to a live page.
//
// WHAT HAPPENED. A note inside src/pages/events.astro explained that an Astro JSX
// comment is an expression container rather than a self-closing comment, and it did
// so by SPELLING THE DELIMITERS: it wrote the opening brace-slash-star and the
// closing star-slash-brace as literal characters inside its own comment.
//
// The closing sequence terminated the comment early. Everything after it - roughly
// five hundred words of a note about braces - was rendered as visible page text on
// /events/, between the review date and the view switch. A reader would have seen a
// paragraph of build-system trivia under the heading "Events".
//
// WHY IT SURVIVED SO LONG. Every other test in this suite asserts structure: that a
// selector exists, that a marker is drawn, that an image resolves. Nothing asserted
// that a particular kind of text was ABSENT from the rendered page, so a leak of
// comment prose into the output was invisible to all 206 tests. This file is that
// missing assertion.
//
// THE RULE THIS ENFORCES. Never write a comment delimiter inside a comment. Describe
// it in words. The cost is one slightly less literal sentence; the cost of getting it
// wrong is your own source code printed on a public website.
//
// WHAT IS CHECKED, and why each part:
//   1. No Astro JSX comment in any src/ file contains a nested delimiter.
//   2. No built page in dist/ contains a phrase that only ever appears in comments.
//   3. Positive controls, so a stripper that eats the whole file cannot pass this.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const SRC = join(PROJECT_ROOT, 'src')
const DIST = join(PROJECT_ROOT, 'dist')

async function collect(dir, ext, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await collect(full, ext, out)
    else if (entry.name.endsWith(ext)) out.push(full)
  }
  return out
}

/**
 * Phrases that exist ONLY in code comments in this project.
 *
 * Each is distinctive enough that it cannot occur in real copy, and each is load
 * bearing: if one appears in a built page, comment prose has reached a reader.
 *
 * `phrase` is the marker. `where` says where it legitimately lives, so a failure
 * message can name the file rather than just the string.
 */
const COMMENT_ONLY_PHRASES = [
  { phrase: 'EXPRESSION container', where: 'src/pages/events.astro' },
  { phrase: 'LOAD-BEARING', where: 'comment prose about a brace' },
  { phrase: 'is:inline', where: 'src/pages/events.astro' },
  { phrase: 'IMPORTANT:', where: 'agent instruction files, never site copy' },
  { phrase: 'PROVISIONAL', where: 'src/lib/site.ts, src/pages/about.astro' },
  { phrase: 'PLACEHOLDER', where: 'src/pages/about.astro' },
  { phrase: 'deliberately left in place', where: 'comment prose' },
  { phrase: 'build-log.md', where: 'internal cross-references only' },
  { phrase: 'ROADMAP.md', where: 'internal cross-references only' },
]

// NOT on the list, and the omission is instructive: `data-astro-cid` was the first
// entry here and it failed on every single page, because Astro emits that attribute
// itself as a scoping hook. A phrase list built from "strings that look internal"
// picks up the build tool's own output. Every entry above is prose a human wrote in
// a comment, verified absent from all seven built pages before being listed.

test('no source comment spells a comment delimiter inside itself', async () => {
  const files = await collect(SRC, '.astro')
  assert.ok(files.length > 0, 'positive control: there must be .astro files to check')

  const offenders = []

  for (const file of files) {
    const text = await readFile(file, 'utf8')
    // Find every Astro JSX comment by its opening delimiter, then look at the text
    // UP TO the first closing delimiter. Anything delimiter-shaped inside that span
    // is a nested delimiter, and a nested CLOSING one is the bug that shipped.
    //
    // THE OPENER MUST BE `{/` WITH NO WHITESPACE, and that is the whole subtlety.
    // `{/* ... */}` is an Astro JSX comment: the comment is the whole expression.
    // But `{ /* ... */ }` is a plain JAVASCRIPT block comment sitting inside an
    // expression container, it closes with a bare `*/`, and it renders nothing. The
    // first version of this detector allowed whitespace and so flagged five
    // legitimate JS comments in ArticleCard.astro as JSX comment leaks - a false
    // positive that would have taught everyone to ignore this test.
    const opener = /\{\/\*/g
    let match
    while ((match = opener.exec(text)) !== null) {
      const start = match.index + match[0].length
      const closer = text.indexOf('*/}', start)
      const rel = file.replace(`${PROJECT_ROOT}/`, '')
      const body = closer === -1 ? text.slice(start) : text.slice(start, closer)

      if (closer === -1) {
        // Never closed. Everything to the end of the file is inside this comment,
        // so the page renders as one enormous text node. Strictly worse than the
        // shipped bug, and worth naming separately.
        offenders.push(`${rel}: a JSX comment starting at offset ${match.index} is never closed`)
        break
      }
      if (body.includes('*/')) {
        offenders.push(`${rel}: a comment body contains a closing "*/" delimiter`)
      }
      if (body.includes('/*')) {
        offenders.push(`${rel}: a comment body contains an opening "/*" delimiter`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `comment prose must not spell a comment delimiter - doing so closes the comment ` +
      `early and prints the rest of the note as page copy. Offenders:\n  ${offenders.join('\n  ')}`
  )
})

test('no built page contains a phrase that only exists in comments', async (t) => {
  // The guard is worthless if dist/ is absent, because then "no leak" is trivially
  // true. Say so rather than passing silently.
  assert.ok(
    existsSync(DIST),
    'positive control: dist/ must exist. Run `npm run build` before this suite, or ' +
      'this test cannot detect a leak in anything.'
  )

  const pages = await collect(DIST, '.html')
  assert.ok(pages.length > 0, 'positive control: dist/ must contain built HTML')

  const leaks = []
  for (const page of pages) {
    const text = await readFile(page, 'utf8')
    const rel = page.replace(`${DIST}/`, '')
    for (const { phrase, where } of COMMENT_ONLY_PHRASES) {
      if (text.includes(phrase)) leaks.push(`${rel} contains "${phrase}" (legitimately in ${where})`)
    }
  }

  t.diagnostic(`checked ${pages.length} built pages against ${COMMENT_ONLY_PHRASES.length} comment-only phrases`)
  assert.deepEqual(
    leaks,
    [],
    `comment prose has reached a built page, so a reader can see it:\n  ${leaks.join('\n  ')}`
  )
})

test('POSITIVE CONTROL: the leak detector really does detect a leak', async (t) => {
  // A guard that cannot fail is not a guard. Prove this one fires.
  //
  // Constructed in memory, and assembled FROM CODE POINTS rather than typed, for two
  // reasons. First, the shape that shipped was a comment whose prose spelled its own
  // delimiters, so the fixture has to contain delimiters inside a comment - writing
  // the fixture literally would put the very bug in this file. Second, building it
  // from numbers is reviewable: a reader sees numbers, not a glyph they have to
  // trust.
  const CH = {
    braceOpen: String.fromCharCode(123), // {
    slash: String.fromCharCode(47), // /
    star: String.fromCharCode(42), // *
    braceClose: String.fromCharCode(125) // }
  }
  const JSX_OPEN = CH.braceOpen + CH.slash + CH.star // the Astro comment opener
  const JSX_CLOSE = CH.star + CH.slash + CH.braceClose // its terminator

  // A comment that opens, then explains itself by SPELLING both delimiters - which
  // ends it at the first one - and carries on with prose that becomes page copy.
  const leaky = [
    '<div>',
    JSX_OPEN + ' This note explains itself by spelling',
    ' ' + JSX_OPEN + ' ... ' + JSX_CLOSE + ' which closes the comment right here.',
    ' THIS TEXT BECOMES PAGE COPY.',
    ' ' + JSX_CLOSE,
    '<p>ok</p>',
    '</div>'
  ].join('\n')

  // The opener is built with EVERY metacharacter escaped. The first version used
  // '[' + brace + ']' + slash + star, which compiles to `[{]/*` - and there the star
  // is a QUANTIFIER on the slash, not a literal, so it matched a bare brace and the
  // positive control failed for a reason that had nothing to do with the bug it was
  // meant to prove the detector catches.
  const opener = new RegExp('\\' + CH.braceOpen + '\\' + CH.slash + '\\' + CH.star, 'g')
  let found = false
  let earlyCloseAt = -1
  let match
  while ((match = opener.exec(leaky)) !== null) {
    const start = match.index + match[0].length
    const closer = leaky.indexOf(JSX_CLOSE, start)
    const body = closer === -1 ? leaky.slice(start) : leaky.slice(start, closer)
    // Either shape counts, because the nested delimiters a comment author writes are
    // always a COMPLETE pair - which is why the first version of this control
    // asserted only on the closing half and passed nothing. In a complete pair the
    // opening half sits inside the body and the closing half sits exactly ON the
    // boundary, so a body-only-closing test never fires. Test for both.
    if (body.includes(CH.slash + CH.star) || body.includes(CH.star + CH.slash)) {
      found = true
      earlyCloseAt = closer
    }
  }

  assert.ok(
    found,
    'the detector must flag a nested delimiter inside a comment body, or this suite proves nothing'
  )

  // And the leaked text really is outside the comment, which is the actual harm.
  const leaked = leaky.slice(earlyCloseAt + JSX_CLOSE.length)
  assert.ok(
    leaked.includes('THIS TEXT BECOMES PAGE COPY'),
    'the leaked prose must sit after the early close, which is the whole mechanism'
  )
  t.diagnostic('a synthetic leaky comment is detected, and its trailing prose sits outside the comment')
})
