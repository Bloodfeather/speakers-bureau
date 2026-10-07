// test/egress-wired-in.test.mjs
//
// This file exists because of a bug that every other test missed.
//
// WHAT THE BUG WAS. scripts/fetch-feeds.mjs called
// `collectSource(source, { fetchImpl: globalThis.fetch })`. http.mjs gives an
// explicitly injected fetchImpl priority over its own default - correctly, since
// that is what makes the suite injectable - so the feed-egress Worker was never
// used by the real fetcher. Every request went out over the runner's own network
// and every feed still answered 403, which is the exact failure the Worker was
// built to remove.
//
// WHY NOTHING CAUGHT IT, and this is the part worth remembering. From a
// residential IP the direct path returns 200. So a local run of `npm run fetch`
// reported "4 sources, 49 items, exit 0" - with the relay bypassed - and looked
// like end-to-end proof. It proved nothing, because both paths succeed from
// here. The failure was only visible from the one network where the two paths
// differ, which is the network the change was for.
//
// THE SHAPE OF THE FIX. Rather than assert on the source text - which is how the
// previous guard in this project learned to grep its own comments - these tests
// replace globalThis.fetch with a function that REFUSES to serve a feed URL, and
// only answers the egress endpoint. If any code path reaches the network directly,
// the test throws rather than quietly returning a plausible result. That is the
// only assertion style that could have caught this, because it tests behaviour on
// the real default path instead of describing it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectSource } from '../scripts/fetch-feeds.mjs'

const ENDPOINT = 'https://sb-feed-egress.mstricklandtech.workers.dev'
const TOKEN = 'test-token-not-a-real-secret'

const FEED = 'https://unitedpatriotsalliance.substack.com/feed'

// A minimal but genuinely valid feed: the fetcher parses this for real, so a
// test that passes here has actually been through the parser.
const FEED_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
  '<channel><title>Test</title><link>https://example.substack.com</link>' +
  '<description>d</description>' +
  '<item>' +
  '<title>A relayed article</title>' +
  '<link>https://example.substack.com/p/a-relayed-article</link>' +
  '<guid>https://example.substack.com/p/a-relayed-article</guid>' +
  '<pubDate>Mon, 06 Oct 2026 12:00:00 GMT</pubDate>' +
  '<description>Summary text.</description>' +
  '<content:encoded><![CDATA[<p>Body text.</p>]]></content:encoded>' +
  '</item></channel></rss>'

/**
 * Replace globalThis.fetch for the duration of one test.
 *
 * `onDirect` is called for anything that is not the egress endpoint. It throws,
 * which is the whole point: a direct network call is a failure, not a slow path.
 */
async function withFakeNetwork(run, { onDirect }) {
  const original = globalThis.fetch
  const calls = { egress: 0, direct: 0 }
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith(ENDPOINT)) {
      calls.egress += 1
      const body = JSON.stringify({
        requested: 1,
        results: [
          {
            url: FEED,
            finalUrl: FEED,
            status: 200,
            ok: true,
            headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
            bytes: FEED_XML.length,
            truncated: false,
            body: FEED_XML,
            error: null
          }
        ]
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    calls.direct += 1
    return onDirect(String(url), options)
  }
  try {
    return { result: await run(), calls }
  } finally {
    globalThis.fetch = original
  }
}

const SOURCE = { id: 'test', name: 'Test', feedUrl: FEED, tag: 'news' }

/** Fails any direct fetch loudly, which is what proves the relay was used. */
function refuseDirectly(url) {
  throw new Error(`DIRECT NETWORK CALL to ${url} - the egress relay was bypassed`)
}

test('the real fetch path goes through the egress relay, not the network', async (t) => {
  process.env.FEED_EGRESS_URL = ENDPOINT
  process.env.FEED_EGRESS_TOKEN = TOKEN

  const { result, calls } = await withFakeNetwork(
    () => collectSource(SOURCE),
    { onDirect: refuseDirectly }
  )

  assert.equal(calls.egress, 1, 'the egress endpoint should have been called exactly once')
  assert.equal(calls.direct, 0, 'nothing may reach the network directly')

  assert.equal(result.error, null, `fetch failed: ${result.error}`)
  assert.equal(result.status, 200)
  assert.equal(result.resolvedUrl, FEED, 'the resolved URL must survive the relay')
  assert.equal(result.itemCount, 1, 'the relayed XML must actually be parsed')
  assert.equal(result.articles[0]?.title, 'A relayed article')

  t.diagnostic(`egress calls ${calls.egress}, direct calls ${calls.direct}`)
})

test('the resolved URL from a redirect survives the relay', async (t) => {
  // ROADMAP design rule 4. Asserted through collectSource rather than the
  // transport alone, so the whole path is covered: a redirect to a different
  // host must still be reported as the resolved URL and must not fail the feed.
  process.env.FEED_EGRESS_URL = ENDPOINT
  process.env.FEED_EGRESS_TOKEN = TOKEN

  const RESOLVED = 'https://www.moved-elsewhere.example/feed'
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (!String(url).startsWith(ENDPOINT)) return refuseDirectly(String(url))
    return new Response(
      JSON.stringify({
        requested: 1,
        results: [
          {
            url: FEED,
            finalUrl: RESOLVED,
            status: 200,
            ok: true,
            headers: { 'content-type': 'application/rss+xml' },
            bytes: FEED_XML.length,
            truncated: false,
            body: FEED_XML,
            error: null
          }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }
  try {
    const result = await collectSource(SOURCE)
    assert.equal(result.error, null, `fetch failed: ${result.error}`)
    assert.equal(result.resolvedUrl, RESOLVED, 'a cross-host redirect must be reported, not failed')
    t.diagnostic(`resolved to ${result.resolvedUrl}`)
  } finally {
    globalThis.fetch = original
  }
})

test('a relayed 403 fails the fetch and reports the refusal', async () => {
  // The guarantee the whole design rests on: a refusal arriving by relay is
  // still a refusal. If this ever passed, the transport would be inventing data.
  process.env.FEED_EGRESS_URL = ENDPOINT
  process.env.FEED_EGRESS_TOKEN = TOKEN

  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (!String(url).startsWith(ENDPOINT)) return refuseDirectly(String(url))
    return new Response(
      JSON.stringify({
        requested: 1,
        results: [
          {
            url: FEED,
            finalUrl: FEED,
            status: 403,
            ok: false,
            headers: { 'content-type': 'text/html' },
            bytes: 60,
            truncated: false,
            body: '<title>Just a moment...</title>',
            error: null
          }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }
  try {
    const result = await collectSource(SOURCE)
    assert.ok(result.error, 'a relayed 403 must produce an error')
    assert.match(result.error, /403/)
    assert.equal(result.articles.length, 0, 'a refused feed must contribute no articles')
  } finally {
    globalThis.fetch = original
  }
})

test('with FEED_EGRESS_URL unset the fetcher uses the network directly', async (t) => {
  // The other half of the contract. A laptop still has to work, and if this
  // broke, the fix for a blocked network would be a fix that also breaks the
  // only environment where anyone can debug it.
  const savedUrl = process.env.FEED_EGRESS_URL
  const savedToken = process.env.FEED_EGRESS_TOKEN
  delete process.env.FEED_EGRESS_URL
  delete process.env.FEED_EGRESS_TOKEN

  const original = globalThis.fetch
  let directCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).startsWith(ENDPOINT)) throw new Error('must not use the relay when it is not configured')
    directCalls += 1
    return new Response(FEED_XML, {
      status: 200,
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' }
    })
  }
  try {
    const result = await collectSource(SOURCE)
    assert.equal(result.error, null, `fetch failed: ${result.error}`)
    assert.equal(directCalls, 1, 'with no egress configured the network must be used')
    assert.equal(result.itemCount, 1)
    t.diagnostic(`direct calls ${directCalls}, as expected with FEED_EGRESS_URL unset`)
  } finally {
    globalThis.fetch = original
    if (savedUrl !== undefined) process.env.FEED_EGRESS_URL = savedUrl
    if (savedToken !== undefined) process.env.FEED_EGRESS_TOKEN = savedToken
  }
})

test('POSITIVE CONTROL: the fake network really can tell the two paths apart', async () => {
  // If refuseDirectly did not throw, or if collectSource silently succeeded
  // without fetching anything, every test above would pass for the wrong reason.
  // assert.throws, not assert.rejects: refuseDirectly is a plain function that
  // throws synchronously rather than returning a rejected promise. The first
  // version of this control used assert.rejects, which invoked it outside a
  // promise chain and re-threw the very error it was asserting on - so the
  // control failed while proving the helper works exactly as intended.
  assert.throws(
    () => refuseDirectly('https://unitedpatriotsalliance.substack.com/feed'),
    /DIRECT NETWORK CALL/,
    'the direct-path refusal must actually throw'
  )

  const savedUrl = process.env.FEED_EGRESS_URL
  const savedToken = process.env.FEED_EGRESS_TOKEN
  process.env.FEED_EGRESS_URL = ENDPOINT
  process.env.FEED_EGRESS_TOKEN = TOKEN

  const original = globalThis.fetch
  let egressCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).startsWith(ENDPOINT)) {
      egressCalls += 1
      return new Response(JSON.stringify({ requested: 0, results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    return refuseDirectly(String(url))
  }
  try {
    // retries: 0 so the count is exact. An empty envelope makes the transport
    // throw, and http.mjs correctly treats a transport throw as retryable, so
    // the default of 2 retries produced THREE egress calls rather than one. The
    // first version of this control asserted exactly 1 and failed on 3 - which
    // was the retry policy working, not the relay misbehaving. Pinning the count
    // with retries:0 makes the assertion sharp instead of approximate.
    const result = await collectSource(SOURCE, { retries: 0 })
    assert.equal(egressCalls, 1, 'the relay must be the only thing contacted')
    assert.ok(result.error, 'an envelope with no results must not read as a successful fetch')
  } finally {
    globalThis.fetch = original
    if (savedUrl !== undefined) process.env.FEED_EGRESS_URL = savedUrl
    else delete process.env.FEED_EGRESS_URL
    if (savedToken !== undefined) process.env.FEED_EGRESS_TOKEN = savedToken
    else delete process.env.FEED_EGRESS_TOKEN
  }
})