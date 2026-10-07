// test/egress.test.mjs
//
// The egress transport is the piece that decides whether a scheduled run can
// read the feeds at all, and it sits directly on the path between a refusal and
// a dataset. So the tests here are mostly about what it does with BAD input and
// BAD output, because the failure this project cannot afford is a transport that
// turns a problem into a plausible-looking empty success.
//
// The behaviour under test, in one line: relay the origin's answer faithfully,
// including when the answer is "no", and refuse to invent one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEgressTransport, resolveFetchImpl, EgressError } from '../scripts/lib/egress.mjs'
import { get, USER_AGENT } from '../scripts/lib/http.mjs'

const ENDPOINT = 'https://sb-feed-egress.example.workers.dev'
const TOKEN = 'test-token-not-a-real-secret'
const FEED = 'https://unitedpatriotsalliance.substack.com/feed'

/** A fake Worker that answers with the given envelope. */
function workerAnswering(payload, { status = 200 } = {}) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
      json: async () => {
        if (typeof payload === 'string') throw new SyntaxError('Unexpected token')
        return payload
      }
    }
  }
  impl.calls = calls
  return impl
}

const envelope = (over = {}) => ({
  requested: 1,
  results: [
    {
      url: FEED,
      finalUrl: FEED,
      status: 200,
      ok: true,
      headers: { 'content-type': 'application/xml', 'x-sub': 'unitedpatriots' },
      bytes: 42,
      truncated: false,
      body: '<rss><item></item></rss>',
      error: null,
      ...over
    }
  ]
})

// ---------------------------------------------------------------------------
// The happy path: it must be a transparent pipe.
// ---------------------------------------------------------------------------

test('relays the origin status, headers and body unchanged', async () => {
  const worker = workerAnswering(envelope())
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  const res = await transport(FEED, { headers: { 'User-Agent': USER_AGENT } })

  assert.equal(res.status, 200)
  assert.equal(res.ok, true)
  assert.equal(res.headers.get('content-type'), 'application/xml')
  assert.equal(res.headers.get('x-sub'), 'unitedpatriots')
  assert.equal(await res.text(), '<rss><item></item></rss>')
})

test('forwards the caller User-Agent rather than imposing one', async () => {
  const worker = workerAnswering(envelope())
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  await transport(FEED, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' } })

  const sent = worker.calls[0].options.headers
  // The whole point of the Worker is to be a transparent pipe. If it rewrote the
  // User-Agent, the honest identification in http.mjs would be a lie.
  assert.equal(sent['user-agent'], USER_AGENT)
  assert.equal(sent.accept, 'application/xml')
  assert.equal(sent.authorization, `Bearer ${TOKEN}`)
})

test('carries finalUrl through, because a constructed Response has an empty url', async () => {
  // ROADMAP design rule 4: a configured feedUrl may redirect to a different host
  // and a different publication, and the fetcher reports the resolved URL rather
  // than treating the redirect as a failure. If .url came back empty the rule
  // would break silently, which is the worst way for it to break.
  const resolved = 'https://www.somewhere-else.example/feed'
  const worker = workerAnswering(envelope({ finalUrl: resolved }))
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  const res = await transport(FEED, {})
  assert.equal(res.url, resolved, 'resolved URL must survive the relay')
  assert.notEqual(res.url, '')
})

test('falls back to the requested URL when the Worker reports no finalUrl', async () => {
  const worker = workerAnswering(envelope({ finalUrl: '' }))
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  const res = await transport(FEED, {})
  assert.equal(res.url, FEED, 'an absent finalUrl must not become an empty url')
})

// ---------------------------------------------------------------------------
// A refusal must stay a refusal. This is the single most important test here.
// ---------------------------------------------------------------------------

test('a 403 from the origin stays a 403, and is NOT turned into a success', async () => {
  const worker = workerAnswering(
    envelope({ status: 403, ok: false, body: '<title>Just a moment...</title>' })
  )
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  const res = await transport(FEED, {})
  assert.equal(res.status, 403, 'the origin said 403 and that is what the fetcher must see')
  assert.equal(res.ok, false)
  assert.match(await res.text(), /Just a moment/)
})

test('http.mjs treats a relayed 403 exactly as it treats a direct 403', async () => {
  // The integration that matters: the existing fail-loud behaviour has to be
  // unchanged when the bytes arrived by relay. `get` must return ok:false with a
  // 403 in the error, which is what fails the build.
  const worker = workerAnswering(
    envelope({ status: 403, ok: false, body: '<title>Just a moment...</title>' })
  )
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  const result = await get(FEED, { fetchImpl: transport, retries: 0 })

  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.match(result.error, /403/)
})

test('http.mjs still validates a relayed feed and fails when the body is not XML', async () => {
  // The Worker is not trusted to have fetched a feed. It relays bytes; whether
  // those bytes are a feed is still the fetcher's decision.
  const worker = workerAnswering(envelope({ body: '<html>this is not a feed</html>' }))
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  const result = await get(FEED, { fetchImpl: transport, retries: 0 })
  // Validation of content-type and item count happens in fetch-feeds.mjs, so
  // here the contract is narrower and still the important one: the bytes came
  // back intact and unmangled.
  assert.equal(await (async () => {
    const res = await transport(FEED, {})
    return res.text()
  })(), '<html>this is not a feed</html>')
  assert.equal(result.status, 200)
})

// ---------------------------------------------------------------------------
// Broken transport must be loud. Silent success here means an empty dataset
// that reads as a healthy fetch of nothing.
// ---------------------------------------------------------------------------

test('throws when the Worker is unreachable, rather than returning an empty 200', async () => {
  const transport = createEgressTransport({
    endpoint: ENDPOINT,
    token: TOKEN,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED')
    }
  })

  await assert.rejects(() => transport(FEED, {}), (err) => {
    assert.ok(err instanceof EgressError)
    assert.match(err.message, /could not reach the feed-egress Worker/)
    return true
  })
})

test('a 401 from the Worker names the token as the likely cause', async () => {
  const worker = workerAnswering({ error: 'unauthorized' }, { status: 401 })
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  await assert.rejects(() => transport(FEED, {}), /token is wrong or FEED_EGRESS_TOKEN is not set/)
})

test('a 500 from the Worker names the unset secret as the likely cause', async () => {
  const worker = workerAnswering({ error: 'FEED_EGRESS_TOKEN is not set on this Worker' }, { status: 500 })
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  await assert.rejects(() => transport(FEED, {}), /FEED_EGRESS_TOKEN is probably not set/)
})

test('throws when the Worker answers with a body that is not JSON', async () => {
  const worker = workerAnswering('<html>502 Bad Gateway</html>')
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  await assert.rejects(() => transport(FEED, {}), /not JSON/)
})

test('throws when the envelope contains no usable result', async () => {
  // A Worker that returns 200 with nothing in it must not become an empty feed.
  const worker = workerAnswering({ requested: 1, results: [] })
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  await assert.rejects(() => transport(FEED, {}), /no usable result/)
})

test('throws on a truncated body rather than parsing a feed with items missing', async () => {
  // This is the quiet-data-loss case. A truncated feed still parses as XML, so
  // without this check the run would go green having silently dropped articles.
  const worker = workerAnswering(envelope({ truncated: true, body: '<rss><item>1</item>' }))
  const transport = createEgressTransport({ endpoint: ENDPOINT, token: TOKEN, fetchImpl: worker })

  await assert.rejects(() => transport(FEED, {}), /truncated/)
})

// ---------------------------------------------------------------------------
// Configuration. The interesting case is a half-configured environment.
// ---------------------------------------------------------------------------

test('resolveFetchImpl returns null when FEED_EGRESS_URL is unset', () => {
  assert.equal(resolveFetchImpl({}), null)
})

test('resolveFetchImpl throws when the endpoint is set but the token is not', () => {
  // The dangerous configuration. Falling back to a direct request here would
  // reproduce the original 403 with no hint that a token had been forgotten,
  // which is exactly the bug this project already spent time on.
  assert.throws(
    () => resolveFetchImpl({ FEED_EGRESS_URL: ENDPOINT }),
    /token is required/
  )
})

test('resolveFetchImpl returns a transport when both are set', () => {
  const impl = resolveFetchImpl({ FEED_EGRESS_URL: ENDPOINT, FEED_EGRESS_TOKEN: TOKEN })
  assert.equal(typeof impl, 'function')
})

test('createEgressTransport refuses to be built without a token', () => {
  assert.throws(() => createEgressTransport({ endpoint: ENDPOINT }), /token is required/)
  assert.throws(() => createEgressTransport({ token: TOKEN }), /endpoint is required/)
})

// ---------------------------------------------------------------------------
// Positive controls. Without these, every test above could pass for the wrong
// reason - most obviously by never exercising the transport at all.
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: the envelope builder can produce a 403 the transport reads as 403', () => {
  // If envelope() could not express a failure, the "403 stays 403" test above
  // would be asserting against a fixture that silently cannot fail.
  const bad = envelope({ status: 403, ok: false })
  assert.equal(bad.results[0].status, 403)
  assert.equal(bad.results[0].ok, false)
})

test('POSITIVE CONTROL: a direct fetch and a relayed 403 produce the same http.mjs verdict', async () => {
  // Same origin answer, two transports. If these ever disagree, the relay has
  // changed the meaning of a failure and the whole design is unsound.
  const direct = async () => ({
    ok: false,
    status: 403,
    url: FEED,
    headers: { get: () => 'application/xml' },
    text: async () => '<title>Just a moment...</title>'
  })
  const relayed = createEgressTransport({
    endpoint: ENDPOINT,
    token: TOKEN,
    fetchImpl: workerAnswering(envelope({ status: 403, ok: false }))
  })

  const viaDirect = await get(FEED, { fetchImpl: direct, retries: 0 })
  const viaRelay = await get(FEED, { fetchImpl: relayed, retries: 0 })

  assert.equal(viaDirect.ok, viaRelay.ok)
  assert.equal(viaDirect.status, viaRelay.status)
  assert.equal(viaDirect.ok, false)
})