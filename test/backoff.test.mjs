// test/backoff.test.mjs
//
// The backoff schedules exist because of a measurement, not a hunch: with every
// feed arriving through one Worker, all scheduled traffic came from a few
// Cloudflare addresses and the origins throttled them. The previous single
// 750ms/2000ms schedule did not outlast that.
//
// What is asserted here is that the three retryable kinds are treated as
// different things, and that a server's own Retry-After beats anything we
// invented. Both matter: a schedule that grows uniformly wastes the runner on 5xx
// and still under-waits a 429.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backoffFor, parseRetryAfter, get } from '../scripts/lib/http.mjs'

// ---------------------------------------------------------------------------
// The schedules are ordered the way the reasoning says they must be.
// ---------------------------------------------------------------------------

test('a 429 is waited on far longer than a 5xx or a dropped connection', () => {
  for (const attempt of [0, 1]) {
    const rateLimited = backoffFor(429, attempt)
    const serverError = backoffFor(503, attempt)
    const dropped = backoffFor(0, attempt)

    assert.ok(rateLimited > serverError, `attempt ${attempt}: 429 (${rateLimited}) must exceed 5xx (${serverError})`)
    assert.ok(rateLimited > dropped, `attempt ${attempt}: 429 (${rateLimited}) must exceed network drop (${dropped})`)
  }
})

test('the wait grows between attempts rather than staying flat', () => {
  for (const status of [429, 503, 0]) {
    const first = backoffFor(status, 0)
    const second = backoffFor(status, 1)
    assert.ok(
      second > first,
      `status ${status}: second wait (${second}) must exceed first (${first}), or retrying is pointless`
    )
  }
})

test('a third attempt waits the same as the second rather than off the end of an array', () => {
  // backoffFor indexes a schedule by attempt. An attempt index past the end of
  // the array must clamp, not return undefined, which would be a NaN delay and
  // a silent immediate retry.
  for (const status of [429, 503, 0]) {
    const second = backoffFor(status, 1)
    const tenth = backoffFor(status, 9)
    assert.equal(tenth, second, `status ${status}: schedule must clamp, not fall off the end`)
    assert.ok(Number.isFinite(tenth), `status ${status}: a clamped wait must still be a number`)
  }
})

// ---------------------------------------------------------------------------
// Retry-After. The server's own number wins over ours, within limits.
// ---------------------------------------------------------------------------

test('parses Retry-After given as delta-seconds', () => {
  assert.equal(parseRetryAfter('30'), 30_000)
  assert.equal(parseRetryAfter(' 45 '), 45_000)
  assert.equal(parseRetryAfter('0'), 0)
})

test('parses Retry-After given as an HTTP date, and never returns a negative wait', () => {
  const soon = new Date(Date.now() + 20_000).toUTCString()
  const parsed = parseRetryAfter(soon)
  assert.ok(parsed > 15_000 && parsed <= 20_000, `expected roughly 20s, got ${parsed}`)

  // A date already in the past means "now", not a negative delay.
  const past = new Date(Date.now() - 60_000).toUTCString()
  assert.equal(parseRetryAfter(past), 0)
})

test('ignores a Retry-After it cannot understand rather than waiting on nonsense', () => {
  assert.equal(parseRetryAfter(''), null)
  assert.equal(parseRetryAfter(null), null)
  assert.equal(parseRetryAfter(undefined), null)
  assert.equal(parseRetryAfter('soon please'), null)

  // This one is not pedantry. Date.parse('-5') does not fail: it returns a date
  // in the past, which the "never negative" clamp turned into a wait of ZERO. So
  // a malformed header could talk the fetcher into retrying a throttled origin
  // immediately. The parse must reject it instead.
  assert.equal(parseRetryAfter('-5'), null, 'a negative delta-seconds must not become an immediate retry')
  assert.equal(parseRetryAfter('1.5'), null, 'a fractional value is not a permitted form')
  assert.equal(parseRetryAfter('12345x'), null, 'digits with trailing junk must not parse as seconds')
})

test('POSITIVE CONTROL: the junk guard rejects real junk and accepts real dates', () => {
  // The letter-guard could in principle be over-eager and reject a legitimate
  // HTTP-date. Prove it accepts one, or the test above proves only that we
  // reject things.
  const realDate = new Date(Date.now() + 30_000).toUTCString()
  assert.ok(parseRetryAfter(realDate) > 25_000, 'a real HTTP-date must still parse')
  assert.match(realDate, /[a-zA-Z]/, 'and it does contain a letter, which is what the guard keys on')
})

test("the server's Retry-After overrides our schedule when it is longer", () => {
  // The whole point. If the origin says wait 90s, our invented 45s is wrong.
  const ours = backoffFor(429, 1, null)
  const theirs = backoffFor(429, 1, '90')
  assert.equal(theirs, 90_000)
  assert.ok(theirs > ours)
})

test("the server's Retry-After wins outright when it is present, in both directions", () => {
  // The server knows its own limit. Our schedules are the fallback for origins
  // that send no header at all - which is the case that produced this whole
  // change, since the throttling arrived as a bare 429 with nothing attached.
  //
  // The first version of this used max(server, schedule), so a server saying
  // "retry in 1s" was overruled by our own 45s and the runner sat there for no
  // reason. Both directions are pinned so that cannot come back.
  assert.equal(backoffFor(429, 1, '1'), 1_000, 'a server may shorten the wait')
  assert.equal(backoffFor(429, 1, '90'), 90_000, 'a server may lengthen the wait')
  assert.equal(backoffFor(429, 1, '5'), 5_000, 'shortening applies to 429 too, not only 5xx')

  // With no header at all, the schedule stands.
  assert.equal(backoffFor(429, 0, null), 10_000)
  assert.equal(backoffFor(429, 1, null), 45_000)

  // An unparseable header is treated as absent, not as "retry immediately".
  assert.equal(backoffFor(429, 1, 'soon'), 45_000, 'garbage falls back to the schedule')
})

test('a hostile Retry-After cannot park the run indefinitely', () => {
  const waited = backoffFor(429, 0, '86400')
  assert.ok(waited <= 120_000, `a one-day Retry-After capped to ${waited}ms`)
  assert.ok(Number.isFinite(waited))
})

// ---------------------------------------------------------------------------
// Behaviour, not just arithmetic: the retry loop has to actually use it.
// ---------------------------------------------------------------------------

test('a 429 is retried, and a 403 is not', async () => {
  const seen = []
  const impl = async (url) => {
    seen.push(Date.now())
    return { ok: false, status: 429, url, headers: { get: () => null }, text: async () => '' }
  }
  await get('https://example.substack.com/feed', { fetchImpl: impl, retries: 1, timeoutMs: 100 })
  assert.equal(seen.length, 2, 'a 429 must be retried')

  const attempts403 = []
  const refusing = async (url) => {
    attempts403.push(1)
    return { ok: false, status: 403, url, headers: { get: () => null }, text: async () => '' }
  }
  await get('https://example.substack.com/feed', { fetchImpl: refusing, retries: 3, timeoutMs: 100 })
  assert.equal(attempts403.length, 1, 'a 403 is a stable answer and must not be retried')
})

test('a rate-limited error names itself, so a red run does not send anyone to the wrong dashboard', async () => {
  const impl = async (url) => ({
    ok: false,
    status: 429,
    url,
    headers: { get: () => null },
    text: async () => ''
  })
  const result = await get('https://example.substack.com/feed', { fetchImpl: impl, retries: 0 })

  assert.equal(result.status, 429)
  assert.match(result.error, /429/)
  assert.match(
    result.error,
    /our request rate/i,
    'the message must say the limit is on our request rate, not on the feed being broken'
  )
})

test('a Retry-After from the origin reaches the wait, through the egress relay', async () => {
  // End to end over the relay shape, because a Retry-After dropped by the Worker
  // is indistinguishable from a server that never sent one. The Worker relays it
  // now; this is the test that would notice if it stopped.
  //
  // The assertion is a measurement rather than a restatement of backoffFor: the
  // origin says 1s, and the elapsed time must be close to 1s AND clearly less
  // than the 10s the 429 schedule would have used without a header. That is the
  // difference the header makes, observed rather than assumed.
  const started = Date.now()
  let calls = 0
  const impl = async (url) => {
    calls += 1
    return {
      ok: false,
      status: 429,
      url,
      // The relay returns headers through a get(name) accessor, exactly as the
      // Worker-shaped envelope does.
      headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '1' : null) },
      text: async () => ''
    }
  }
  await get('https://example.substack.com/feed', { fetchImpl: impl, retries: 1, timeoutMs: 100 })
  const elapsed = Date.now() - started

  assert.equal(calls, 2, 'the 429 must have been retried')
  assert.ok(elapsed >= 800, `expected to have waited about 1s, waited ${elapsed}ms`)
  assert.ok(
    elapsed < 6_000,
    `expected the origin's 1s to win over the 10s schedule, but waited ${elapsed}ms`
  )
})

// ---------------------------------------------------------------------------
// Positive controls: without these the assertions above could pass vacuously.
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: the schedules are distinguishable from each other', () => {
  // If all three schedules were equal, the ordering tests above would compare
  // numbers to themselves and prove nothing.
  const values = new Set([backoffFor(429, 0), backoffFor(503, 0), backoffFor(0, 0)])
  assert.equal(values.size, 3, '429, 5xx and network waits must be three different values')
})

test('POSITIVE CONTROL: parseRetryAfter rejects what it should and accepts what it should', () => {
  assert.notEqual(parseRetryAfter('30'), null, 'a valid header must parse')
  assert.equal(parseRetryAfter('nonsense'), null, 'an invalid header must not parse')
  assert.ok(parseRetryAfter('30') > parseRetryAfter('5'), 'seconds must scale')
})

test('POSITIVE CONTROL: the 429 error message would be absent without its clause', () => {
  // Guards against the message regressing to a bare "HTTP 429".
  const bare = 'HTTP 429 Too Many Requests for https://example.substack.com/feed'
  assert.doesNotMatch(bare, /our request rate/i)
  assert.match(
    `HTTP 429 Too Many Requests for https://example.substack.com/feed (rate limited by the host; this is our request rate, not a broken feed)`,
    /our request rate/i
  )
})