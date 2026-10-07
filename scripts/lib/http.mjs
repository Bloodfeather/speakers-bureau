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
//   429 - explicit rate limit; backoff and retry.
// Everything in 4xx OTHER than 429 is deliberately NOT retried. A 403 or 404
// is a stable answer: the publication does not exist or does not want us.
// Retrying it just wastes the Action's time and hammers the host, which is how
// a working fetch script gets a publisher's domain rate-limited or blocked.
function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
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

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await delay(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
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
        error: `HTTP ${status} ${response.statusText || ''}`.trim() + ` for ${finalUrl}`
      };
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
