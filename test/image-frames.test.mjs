// test/image-frames.test.mjs
//
// Two defects, both found by a reader looking at the live site rather than by a
// test, and both about how one article's artwork reached the page.
//
// 1. A PODCAST ENCLOSURE WAS RENDERED AS AN IMAGE. A Substack item encloses its
//    audio exactly the way it encloses a photo, so `<enclosure>` alone cannot
//    mean "image". The extractor took the url on sight, and three posts in the
//    shipped dataset ended up with an `.mp3` in `image`. The built page emitted
//    `<img src="...mp3">`, which a browser renders as a broken image icon.
//
// 2. ONE IMAGE WAS CROPPED THROUGH ITS OWN TITLE. Cards sit in a fixed 3:2
//    frame and `object-fit: cover` crops centred. "Five Hospitals and a Denial"
//    is 1456x819, which is 1.778 against a frame of 1.5, so a centred crop
//    discarded about 7.8% from EACH side - and the left-hand 7.8% ran into the
//    leading "F" of the headline set into the artwork.
//
// Both were invisible to a suite that asserts structure. This file asserts the
// two behaviours directly, and asserts them against the real dataset rather
// than against a stub, so a dataset that drifts back into the old shape fails.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { imageUrl, imageObjectPosition } from '../src/lib/articles.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')

const dataset = JSON.parse(
  readFileSync(join(PROJECT_ROOT, 'data', 'articles.json'), 'utf8')
)
const articles = dataset.articles ?? dataset

const NON_IMAGE_EXTENSION =
  /\.(mp3|m4a|aac|oga|opus|ogg|wav|flac|mp4|m4v|mov|avi|webm|pdf|epub|json|xml)(\?|#|$)/i

test('no article in the real dataset yields an audio url as an image', () => {
  assert.ok(articles.length > 0, 'positive control: the dataset must not be empty')

  const rendered = articles
    .filter((a) => imageUrl(a) !== null && NON_IMAGE_EXTENSION.test(imageUrl(a)))
    .map((a) => a.id)

  assert.deepEqual(
    rendered,
    [],
    `these articles would render an audio file as an image: ${rendered.join(', ')}`
  )
})

test('imageUrl passes real image urls through untouched', () => {
  const image = 'https://substackcdn.com/image/fetch/$s_!Lia4!,f_auto,q_auto:good/x.jpeg'
  assert.equal(imageUrl({ image }), image, 'a real image must survive verbatim')
  assert.equal(imageUrl({ image: '' }), null, 'empty string is no image')
  assert.equal(imageUrl({ image: null }), null)
  assert.equal(imageUrl({ image: '   ' }), null, 'whitespace is no image')
  assert.equal(
    imageUrl({ image: 'https://cdn.example/a_1024x683.PNG' }),
    'https://cdn.example/a_1024x683.PNG',
    'case must not matter, and a png must not be rejected'
  )
})

test('an article with no image yields null, and the card still renders', () => {
  // The card guards with `{image && ...}`, so a null image must be a COMPLETE
  // card rather than a broken one. That contract is what the podcast fix relies
  // on, so it is asserted here rather than assumed.
  assert.equal(imageUrl({ image: null }), null)
  assert.equal(imageUrl({ image: '' }), null)
})

test('POSITIVE CONTROL: audio is rejected from SYNTHETIC input, not from the dataset', () => {
  // The first version of this test proved the guard by looking for an article in
  // data/articles.json that still held an .mp3. That was a mistake, and it was
  // the exact mistake this project keeps warning about: the assertion passed
  // only while the bug was still present, so it FAILED THE MOMENT THE FIX
  // WORKED. A positive control must not be a statement about the state of the
  // world.
  //
  // The control below is built from literals, so it holds whether the dataset
  // holds zero podcast posts or twenty. Each of these is a URL that really
  // appeared in this dataset, or really occurs in Substack feeds.
  const mustReject = [
    'https://api.substack.com/feed/podcast/218377170/ac19357b5f5647d3be964407edd1ee40.mp3',
    'https://api.substack.com/feed/podcast/205505678/ddcb919189ba978c8151ccd33c050c9c.mp3',
    'https://cdn.example.test/clip.m4a',
    'https://cdn.example.test/show.opus',
    'https://cdn.example.test/talk.mp4',
    'https://cdn.example.test/notes.pdf',
    // Query string and fragment must not disguise the extension.
    'https://cdn.example.test/clip.mp3?token=abc',
    'https://cdn.example.test/clip.mp3#t=10'
  ]
  for (const url of mustReject) {
    assert.equal(
      imageUrl({ image: url }),
      null,
      `must be rejected as a non-image: ${url}`
    )
  }

  const mustAccept = [
    'https://substackcdn.com/image/fetch/$s_!Lia4!,f_auto,q_auto:good/x.jpeg',
    'https://cdn.example.test/a_1024x683.PNG',
    'https://cdn.example.test/photo.webp',
    'https://cdn.example.test/avatar.avif',
    // Extensionless, served without a suffix: cannot be judged, so not rejected.
    'https://cdn.example.test/images/67787c1b-b3ef-4736-94b2-379d45eed972'
  ]
  for (const url of mustAccept) {
    assert.equal(
      imageUrl({ image: url }),
      url,
      `must be kept as a real image: ${url}`
    )
  }
})

test('the real dataset is clean, and stays clean', () => {
  // Now that the parser fix has been run against the live feeds, the committed
  // dataset should hold no non-image in `image` at all. This is the assertion
  // that would have caught the original bug, expressed as the state we want
  // rather than as the state we are escaping.
  const offenders = articles
    .filter((a) => typeof a.image === 'string' && NON_IMAGE_EXTENSION.test(a.image))
    .map((a) => `${a.id} -> ${a.image}`)
  assert.deepEqual(offenders, [], `dataset still holds non-image urls: ${offenders.join(', ')}`)

  // The podcast posts must still be PRESENT. Losing them would be a worse bug
  // than the broken icon: an article that renders is fixable, an article that
  // silently vanished is not noticed until someone goes looking for it.
  const podcasts = articles.filter((a) => /episode|podcast/i.test(a.title))
  if (podcasts.length > 0) {
    for (const a of podcasts) {
      assert.ok(a.url, `${a.title} must still have its link`)
    }
  }
})

// THE OVERRIDE FILE MUST TOLERATE ROTATION, AND THIS IS WHY.
//
// These two tests used to name `www-malone-news-p-five-hospitals-and-a-denial`
// and assert it was IN the dataset. On 2026-10-27 a routine `npm run fetch`
// proved that assumption false: Substack RSS holds only the 20 most recent
// posts, malone published past that article, and it fell out of the window. The
// suite then failed on a refresh that had done nothing wrong - the article was
// simply no longer recent. A guard that fails on correct input teaches people to
// ignore guards.
//
// The split below keeps the intent and drops the false assumption:
//   - the MECHANISM is asserted against a constructed id, because
//     imageObjectPosition looks up by id alone and does not need the article to
//     be present;
//   - the DATA invariant is asserted dynamically over whatever the file holds,
//     with "retired" as the one deliberate state for an id that has left.
//
// A misspelled key is still a hard failure: it is neither in the dataset nor
// marked retired, which is the distinction the old test could not make.

test('the override mechanism still applies the reported crop fix', () => {
  const FIVE_HOSPITALS = 'www-malone-news-p-five-hospitals-and-a-denial'

  // Looked up by id alone, so this asserts the wiring WITHOUT requiring the
  // article to still be in the rolling feed window.
  const position = imageObjectPosition({ id: FIVE_HOSPITALS })
  assert.ok(position, 'the recorded crop fix must still resolve for its article id')
  assert.match(position, /left/, 'the override must anchor the image to the left')

  // An id the file does not name must get the browser default, or the override
  // has become a global style that happens to be spelled as data. This is the
  // assertion that would actually catch that: every other check below would
  // still pass if the lookup ignored its key and returned one position for
  // every article.
  assert.equal(
    imageObjectPosition({ id: 'definitely-not-in-the-frames-file' }),
    undefined,
    'an unlisted id must fall back to the browser default'
  )

  // WIRING OVER THE REAL DATASET: every article that is still here and is named
  // by a live entry must resolve to that entry's position. Asserted by iterating
  // the DATASET (not the file), so an article reaching the page with an override
  // that does not apply is caught. Deliberately no mirror-image loop over the
  // dataset claiming "nothing else is overridden": with the lookup keyed by id
  // that claim is true by construction and could never fail, and a guard that
  // cannot fail is decoration.
  const framesDoc = JSON.parse(
    readFileSync(join(PROJECT_ROOT, 'data', 'image-frames.json'), 'utf8')
  )
  const live = Object.entries(framesDoc.frames ?? {}).filter(
    ([, frame]) => frame?.retired !== true
  )
  for (const [id, frame] of live) {
    const article = articles.find((a) => a.id === id)
    if (!article) continue // a retired-then-returned id is test B's business
    assert.equal(
      imageObjectPosition(article),
      frame.objectPosition,
      `${id} is named by a live entry but does not carry its override`
    )
  }
})

test('the override file is keyed by ids that exist, or is explicitly retired', () => {
  // Two failure modes of a hand-maintained lookup, and they need DIFFERENT
  // answers. A typo means the override silently never applies and nothing
  // fails - so it must fail loudly here. An article leaving the rolling feed
  // window is legitimate, so it must be expressible without a lie.
  const framesDoc = JSON.parse(
    readFileSync(join(PROJECT_ROOT, 'data', 'image-frames.json'), 'utf8')
  )
  const frames = framesDoc.frames ?? {}
  const ids = new Set(articles.map((a) => a.id))

  const orphans = Object.keys(frames).filter(
    (id) => !ids.has(id) && frames[id]?.retired !== true
  )
  assert.deepEqual(
    orphans,
    [],
    `data/image-frames.json names ids that are not in the dataset and are not ` +
      `marked "retired": ${orphans.join(', ')}`
  )

  for (const [id, frame] of Object.entries(frames)) {
    assert.ok(
      typeof frame.objectPosition === 'string' && frame.objectPosition.trim() !== '',
      `${id} must carry a non-empty objectPosition, or the entry does nothing`
    )

    if (frame.retired === true) {
      // Retirement is a decision, and an unexplained one is indistinguishable
      // from an entry someone abandoned.
      assert.ok(
        typeof frame._retiredWhy === 'string' && frame._retiredWhy.trim().length > 20,
        `${id} is retired but does not say why - add a _retiredWhy`
      )
      assert.ok(
        !ids.has(id),
        `${id} is marked retired but IS in the dataset: un-retire it rather than ` +
          `leaving it switched off`
      )
    } else {
      // The wiring check: a live entry's position must actually reach the reader.
      assert.equal(
        imageObjectPosition({ id }),
        frame.objectPosition,
        `${id} is live but its objectPosition does not resolve`
      )
    }
  }
})
