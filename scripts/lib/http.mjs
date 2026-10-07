// scripts/lib/http.mjs
//
// Single-purpose GET client for RSS fetches.
//
// Contract: this NEVER throws for an expected HTTP failure. A feed that 403s
// or 404s is data, not an exception, and design rule 3 ("fail loud") is
// satisfied by returning `ok: false` with a reason the orchestrator can print
// and exit non-zero on. Throwing here would force a try/catch at every call
// site and invites a silent `catch {}`.

import { setTimeout as delay } from 'node:timers/promises';
import { resolveFetchImpl } from './egress.mjs';

// Identify ourselves honestly, with a contact URL. Some hosts 403 an anonymous
// or absent User-Agent outright, so this is load-bearing, and the contact URL
// is what lets an operator get in touch instead of just guessing why.
export const USER_AGENT =
  'SpeakersBureauFeedFetcher/1.0 (+https://scspeakersbureau.org; feed aggregator; contact via site)';

// Per-call timeout. JUDGMENT CALL: 15s. A Substack feed is a few hundred KB
// from a CDN and normally lands in under 2s. 15s is generous enough to absorb
// cold TLS and a slow mobile link, short enough that a hung socket on a
// 20-source list cannot stall the scheduled Action for minutes. Retries add
// up: 3 attempts x 15s plus backoff is a ~50s worst case per dead feed, which
// is acceptable for a job that runs every 4h. Raise it if feeds are ever
// fetched from somewhere genuinely slow rather than by reflex.
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const BACKOFF_MS = [750, 2000];

// Status codes worth trying again.
//   5xx - server-side problem, may be transient.
//   429 - explicit rate limit; back off and retry, and wait a good deal longer
//         than for a 5xx. See the backoff schedules below for why these two are
//         not treated the same.
function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

// BACKOFF, AND WHY THERE ARE THREE SCHEDULES RATHER THAN ONE.
//
// The original design had a single 750ms/2000ms pair and was measurably wrong.
// With every feed now arriving through one Worker, all scheduled traffic comes
// from a small set of Cloudflare addresses, and the measured result was that the
// origins served a residential IP 4 feeds out of 4 while refusing or throttling
// the Worker 2 out of 4. Concentrating the egress concentrates the rate-limit
// risk, and a 2-second gap does not outlast a throttle that lasts minutes.
//
// So the three retryable kinds are separated, because they mean different things:
//
//   429      the server told us how fast to go, or at least that we are going
//            too fast. Waiting seconds is the whole point, so wait longer than we
//            would for a server error.
//   5xx      the server is broken or busy. Typically clears in seconds.
//   network  no response at all. Usually a dropped connection, and a short gap
//            is usually enough; a long one just wastes the runner's clock.
//
// WORST CASE, and it is bounded deliberately. Per feed: 3 attempts, each capped
// at DEFAULT_TIMEOUT_MS, plus at most 10s + 45s of waiting for a 429. That is
// roughly 100s for a throttled feed, and feeds are fetched one at a time, so a
// run where every feed is throttled costs a few extra minutes. A scheduled job
// that waits three minutes to avoid publishing stale data is a good trade; one
// that waits three minutes and still fails teaches nothing.
const BACKOFF_429_MS = [10_000, 45_000];
const BACKOFF_5XX_MS = [1_000, 4_000];
const BACKOFF_NETWORK_MS = [2_000, 8_000];

// A server may TELL us how long to wait, in `Retry-After`, as either a number of
// seconds or an HTTP date. When it does, that beats any schedule we invented:
// guessing 45s when the server says 4s wastes the runner, and guessing 45s when
// the server says 600s means retrying too early and getting throttled again.
//
// Honoring it through the egress relay required the Worker to pass the header
// along, which it did not until this change: it relayed content-type, x-sub,
// etag, last-modified and content-length, and nothing else. So the single most
// useful header for this exact problem was being dropped on the floor by the
// relay that exists to carry it.
const RETRY_AFTER_CAP_MS = 120_000;

/**
 * How long to wait before the next attempt, given how the last one failed.
 *
 * @param {number} status  the last attempt's status; 0 means no response
 * @param {number} attempt zero-based index of the attempt just made
 * @param {string|null} retryAfter the origin's Retry-After header, if any
 * @returns {number} milliseconds to wait
 */
export function backoffFor(status, attempt, retryAfter = null) {
  const schedule =
    status === 0 ? BACKOFF_NETWORK_MS : status === 429 ? BACKOFF_429_MS : BACKOFF_5XX_MS;

  const told = parseRetryAfter(retryAfter);
  // When the server TELLS us, it wins. This was not the first version: an
  // earlier one took max(server, schedule), on the reasoning that our 429 floor
  // existed to stop us retrying too eagerly. But that floor is the fallback for
  // servers that send no header at all - which is exactly the case that produced
  // this whole change, since the throttling we hit arrived as a bare 429 with no
  // Retry-After. When a header IS present the server knows its own limit, and
  // sitting on our own number after it says "you may retry in 2s" wastes the
  // runner's clock for no benefit. The schedule is the guess; the header is the
  // instruction.
  if (told === null) return schedule[Math.min(attempt, schedule.length - 1)];

  // Still capped, so a hostile or buggy origin cannot park a scheduled run for
  // an hour by sending Retry-After: 86400.
  return Math.min(told, RETRY_AFTER_CAP_MS);
}

/**
 * Parse a Retry-After header into milliseconds, or null if unusable.
 *
 * Accepts both permitted forms: delta-seconds, and an HTTP-date.
 *
 * The date branch is gated on the value containing a LETTER, and that guard is
 * load-bearing rather than fussy. `Date.parse` is extremely lenient: handed
 * "-5" it does not return NaN, it returns a date in the past, and the
 * `Math.max(0, ...)` below turned that into a wait of zero - so a malformed
 * header could talk the fetcher into retrying a throttled origin IMMEDIATELY.
 * Every HTTP-date form contains alphabetic day or month names ("Wed", "Oct",
 * "GMT"), and delta-seconds contains none, so requiring a letter separates the
 * two permitted forms from arbitrary junk with no false negatives.
 *
 * Exported for testing because unit handling and date arithmetic are exactly
 * where a parser is quietly wrong.
 */
export function parseRetryAfter(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (raw === '') return null;

  if (/^\d+$/.test(raw)) return Number(raw) * 1000;

  if (!/[a-zA-Z]/.test(raw)) return null;

  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  // A date in the past means "retry now", not "retry in the past".
  return Math.max(0, when - Date.now());
}

/**
 * GET a URL with a per-call timeout and bounded retries.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs=15000] per-attempt timeout
 * @param {number} [options.retries=2]      extra attempts after the first
 * @param {Function} [options.fetchImpl]    injectable for tests; defaults to the
 *                                          feed-egress Worker when
 *                                          FEED_EGRESS_URL is set, otherwise
 *                                          globalThis.fetch
 * @param {string} [options.userAgent]
 * @returns {Promise<{ok:boolean,status:number,finalUrl:string,contentType:string,body:string,error:string|null}>}
 */
export async function get(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    // Resolved LAZILY, and only when the caller did not supply one. Two reasons,
    // both learned the hard way.
    //
    // Lazily: reading the environment at module scope would make the choice
    // impossible to change per call and impossible to test both paths in one
    // process, since an import-time decision is fixed before any test runs.
    //
    // Only as a default: an explicitly injected fetchImpl must always win, or
    // the test suite - which injects its own - would start making real network
    // calls whenever the environment happened to be set.
    fetchImpl = null,
    userAgent = USER_AGENT
  } = options;

  // THE TRANSPORT IS THE ONLY THING THAT CHANGED. When FEED_EGRESS_URL is unset
  // this is globalThis.fetch and every behaviour below is exactly what it was
  // before the egress Worker existed: same validation, same retry policy, same
  // definition of a failure. When it IS set, requests are relayed through the
  // Worker because GitHub's runner network is refused by Cloudflare's managed
  // challenge - see scripts/lib/egress.mjs for the measurement.
  const doFetch = fetchImpl ?? resolveFetchImpl() ?? globalThis.fetch;

  const attempts = Math.max(1, retries + 1);
  let lastResult = null;
  // Carried between attempts so the wait can be chosen from HOW the previous
  // attempt failed, and so the origin's own Retry-After survives into it.
  let lastStatus = 0;
  let lastRetryAfter = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await delay(backoffFor(lastStatus, attempt - 1, lastRetryAfter));
    }

    let response = null;
    let networkError = null;

    try {
      // AbortSignal.timeout is available on Node 18+ and this project requires
      // Node >=22, so no manual AbortController bookkeeping is needed. Note it
      // covers the headers AND the body read, because the timer keeps running
      // until the signal is garbage collected.
      response = await doFetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5'
        }
      });
    } catch (err) {
      networkError = err;
    }

    if (networkError) {
      lastResult = {
        ok: false,
        status: 0,
        finalUrl: url,
        contentType: '',
        body: '',
        error: `network error after ${attempt + 1} attempt(s): ${networkError.message}`
      };
      lastStatus = 0;
      lastRetryAfter = null;
      continue;
    }

    // REDIRECTS ARE NORMAL AND NOT ERRORS. Verified live: the feed configured
    // at bariweiss.substack.com redirects to www.thefp.com and the publication
    // is a different one. Cross-host is exactly the observed case. We follow it
    // and report the resolved URL; treating it as a failure would mean
    // rejecting a perfectly good feed.
    const finalUrl = response.url || url;
    const contentType = response.headers.get('content-type') || '';
    const status = response.status;

    if (!response.ok) {
      lastResult = {
        ok: false,
        status,
        finalUrl,
        contentType,
        body: '',
        // The refusal now NAMES the guidance it carries. A bare "HTTP 429" sends
        // whoever is reading a red run to the Cloudflare dashboard to check a
        // deployment that is working perfectly; the rate limit is on OUR request
        // rate, and saying so in the line they will actually read saves that.
        error:
          `HTTP ${status} ${response.statusText || ''}`.trim() +
          ` for ${finalUrl}` +
          (status === 429 ? ' (rate limited by the host; this is our request rate, not a broken feed)' : '')
      };
      lastStatus = status;
      lastRetryAfter = response.headers.get('retry-after') ?? null;
      if (isRetryableStatus(status)) continue;
      return lastResult;
    }

    let body = '';
    try {
      body = await response.text();
    } catch (err) {
      lastResult = {
        ok: false,
        status,
        finalUrl,
        contentType,
        body: '',
        error: `failed to read body for ${finalUrl}: ${err.message}`
      };
      continue;
    }

    // HTTP 2xx with a body in hand. Whether it is actually a feed is NOT
    // decided here - that is validate.mjs's job, and keeping the two apart is
    // what lets us report "200 but it was HTML" instead of a vague error.
    return {
      ok: true,
      status,
      finalUrl,
      contentType,
      body,
      error: null
    };
  }

  return lastResult;
}
