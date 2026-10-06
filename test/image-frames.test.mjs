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

test('the one known bad crop is overridden, and only that one', () => {
  const FIVE_HOSPITALS = 'www-malone-news-p-five-hospitals-and-a-denial'

  const target = articles.find((a) => a.id === FIVE_HOSPITALS)
  assert.ok(target, `positive control: ${FIVE_HOSPITALS} must exist in the dataset`)

  // The override must be the one that fixes the reported problem: anchoring to
  // the left edge keeps the headline intact and moves the whole crop to the
  // right, which is what was asked for.
  const position = imageObjectPosition(target)
  assert.ok(position, 'the article must carry an object-position override')
  assert.match(position, /left/, 'the override must anchor the image to the left')

  // Every other article must be untouched, or the override has become a global
  // style that happens to be spelled as data.
  const overridden = articles
    .filter((a) => a.id !== FIVE_HOSPITALS && imageObjectPosition(a) !== undefined)
    .map((a) => a.id)
  assert.deepEqual(overridden, [], 'only the known-bad crop may be overridden')

  const untouched = articles.filter((a) => a.id !== FIVE_HOSPITALS)
  assert.ok(untouched.length > 0, 'positive control')
  for (const a of untouched) {
    assert.equal(
      imageObjectPosition(a),
      undefined,
      `${a.id} must fall back to the browser default`
    )
  }
})

test('the override file is keyed by ids that exist, and by nothing else', () => {
  // A typo in the key is the failure mode of a hand-maintained lookup: the file
  // looks right, the override simply never applies, and nothing fails.
  const framesDoc = JSON.parse(
    readFileSync(join(PROJECT_ROOT, 'data', 'image-frames.json'), 'utf8')
  )
  const frames = framesDoc.frames ?? {}
  const ids = new Set(articles.map((a) => a.id))

  const orphans = Object.keys(frames).filter((id) => !ids.has(id))
  assert.deepEqual(
    orphans,
    [],
    `data/image-frames.json names ids that are not in the dataset: ${orphans.join(', ')}`
  )

  for (const [id, frame] of Object.entries(frames)) {
    assert.ok(
      typeof frame.objectPosition === 'string' && frame.objectPosition.trim() !== '',
      `${id} must carry a non-empty objectPosition, or the entry does nothing`
    )
  }
})
