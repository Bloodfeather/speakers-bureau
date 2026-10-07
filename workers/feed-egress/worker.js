// workers/feed-egress/worker.js
//
// WHAT THIS IS. A network egress. That is the entire job, and the restraint is
// the design.
//
// THE PROBLEM IT SOLVES, measured rather than assumed. GitHub Actions runners
// cannot read these feeds. From a real `ubuntu-latest` runner, all four feeds
// return HTTP 403 with `cf-mitigated: challenge` and a body whose title is
// "Just a moment...", on every User-Agent including a desktop browser string,
// while `example.com` answers 200 in 172ms from the same runner. That is
// Cloudflare's Managed Challenge refusing GitHub's Azure egress range, not a
// Substack block and not a UA filter. Identical code from a residential IP
// returns 200, and identical code from this Worker's own egress returns 200 in
// 28-135ms. So the fix is not a better User-Agent and not more retries; it is
// to make the request from a network Cloudflare does not challenge.
//
// WHY IT FETCHES AND DOES NOT PARSE. All the parsing, validation, retry policy,
// normalisation and atomic write stay in scripts/, where they are covered by the
// test suite and reviewable in a pull request. This Worker moves bytes. If it
// also parsed feeds, the rules that decide what appears on the site would live
// in two places, one of which has no tests, and they would drift.
//
// The consequence, which is the point: this file contains no content rules at
// all. It cannot decide what an article is. It only answers "what did the
// origin server say?", faithfully, including when the answer is a refusal.
//
// IT IS NOT AN OPEN PROXY. A Worker on a public *.workers.dev hostname that
// fetches any URL given to it is a tool for bypassing exactly the blocks that
// are annoying us, and that is not a property worth shipping. Every request
// must carry the shared secret. Without it the Worker is inert.
//
// TWO OTHER GUARDS, both deliberate:
//   - a cap on how many URLs one request may ask for, and on how large a
//     response body it will relay, so the Worker cannot be used as a bandwidth
//     proxy even with the token;
//   - the secret is compared against a constant-time-ish equality and the token
//     is never echoed, logged, or included in any response.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not cache. A feed refresh that
// served a stale copy would be the exact failure this project is built to make
// impossible: a green run reading as fresh data that is not fresh.

// NO TOKEN CONSTANT LIVES IN THIS FILE.
//
// The first draft of this file had `const TOKEN = '__SET_ME__'` at module scope
// and compared against that. That is wrong in a way that only shows up in
// production: a Worker's secrets arrive on the `env` argument of the handler,
// not in module scope, so a module-scope const can never see the real value.
// Every request would then have been compared against the placeholder - and a
// caller who guessed the placeholder string would have been let straight in.
//
// Set the real value with `wrangler secret put FEED_EGRESS_TOKEN`.

// A refusal must not say WHICH part was wrong.
const UNAUTHORIZED_BODY = JSON.stringify({ error: 'unauthorized' });

// A feed is a few hundred KB to ~1MB. Four of them is the real workload, so
// this is generous rather than tight.
const MAX_URLS_PER_REQUEST = 12;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const CLEAN = (s) =>
  (s || '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // This Worker relays third-party feeds, so it must never be cached by an
      // intermediary. The site's own caching is Cloudflare's business.
      'cache-control': 'no-store'
    }
  });
}

/**
 * Fetch one URL and report exactly what came back.
 *
 * A failure here is REPORTED, never thrown. The caller in scripts/lib/http.mjs
 * has its own retry and validation policy and must be the only place that
 * decides what a failure means. A Worker that threw would turn an HTTP 403 - a
 * piece of data the fetcher wants to see and print - into an exception.
 */
async function fetchOne(url, requestHeaders) {
  const started = Date.now();
  try {
    const headers = {};
    // Forward the caller's User-Agent rather than imposing one. The point of
    // this Worker is to be a transparent pipe: if the fetcher's honest
    // identification matters, the Worker must not overwrite it with its own.
    const ua = requestHeaders.get('user-agent');
    if (ua) headers['User-Agent'] = ua;
    const accept = requestHeaders.get('accept');
    if (accept) headers.Accept = accept;

    const res = await fetch(url, { headers, redirect: 'follow' });

    // Read as text rather than bytes. The fetcher parses XML, and re-encoding
    // bytes through JSON would risk corrupting a multi-byte character in a
    // title. Text is lossless for the UTF-8 these feeds actually use, and the
    // fetcher's own parser is the authority on whether it is valid.
    const body = await res.text();

    // Only the headers the fetcher actually inspects are relayed. Dumping the
    // full header set would leak this Worker's own Cloudflare bookkeeping into
    // a place that has no use for it.
    //
    // `retry-after` is on this list because of a measured omission. The fetcher
    // honours Retry-After when an origin sends it - it is the one piece of
    // rate-limit guidance the server can give us, and it beats any schedule we
    // invent. This relay did not forward it, so every 429 arrived stripped of
    // the instruction to wait, and the fetcher fell back to guessing. The header
    // most worth relaying for a rate-limited relay was the one it dropped.
    const RELAYED = [
      'content-type',
      'x-sub',
      'etag',
      'last-modified',
      'content-length',
      'retry-after'
    ];
    const relayed = {};
    for (const name of RELAYED) {
      const value = res.headers.get(name);
      if (value !== null) relayed[name] = value;
    }

    return {
      url,
      // The resolved URL, which ROADMAP design rule 4 depends on: a configured
      // feedUrl may legitimately redirect to a different host and publication,
      // and the fetcher reports the resolved URL rather than treating that as a
      // failure. A Response constructed in a Worker has an EMPTY .url, so this
      // value has to be carried explicitly or the rule silently breaks.
      finalUrl: res.url || url,
      status: res.status,
      ok: res.ok,
      headers: relayed,
      bytes: body.length,
      truncated: body.length > MAX_BODY_BYTES,
      body: body.length > MAX_BODY_BYTES ? body.slice(0, MAX_BODY_BYTES) : body,
      ms: Date.now() - started,
      error: null
    };
  } catch (err) {
    // No HTTP response at all. This is a DIFFERENT failure from a 403 and the
    // fetcher is entitled to tell them apart, so it is reported as status 0
    // rather than being dressed up as a refusal.
    return {
      url,
      finalUrl: url,
      status: 0,
      ok: false,
      headers: {},
      bytes: 0,
      truncated: false,
      body: '',
      ms: Date.now() - started,
      error: CLEAN(err && err.message ? err.message : String(err))
    };
  }
}

export default {
  async fetch(request, env) {
    // FAIL CLOSED, AND SAY WHY. A missing secret is a deployment mistake, not
    // an attack, so it is a 500 with a message an operator can act on. What it
    // must never do is fall through to comparing against an empty or undefined
    // token, which is how "no secret configured" turns into "no authentication
    // configured" - the exact failure this token exists to prevent.
    const token = env && env.FEED_EGRESS_TOKEN;
    if (!token) {
      return json({ error: 'FEED_EGRESS_TOKEN is not set on this Worker' }, 500);
    }

    // GET is refused rather than served: accepting a URL in a query string
    // would put third-party feed URLs into access logs and browser history.
    if (request.method !== 'POST') {
      return json({ error: 'use POST' }, 405);
    }

    // Length is compared as well as content. This is not constant-time and is
    // not claimed to be: JavaScript string comparison cannot be made so without
    // a WebAssembly detour that would be absurd here. What the length check
    // does buy is refusing the common case without running the comparison at
    // all, and what protects the token in practice is that it is long random
    // data rather than a password a person chose.
    const presented = request.headers.get('authorization') || '';
    const expected = `Bearer ${token}`;
    if (presented.length !== expected.length || presented !== expected) {
      return new Response(UNAUTHORIZED_BODY, {
        status: 401,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'body must be JSON' }, 400);
    }

    const urls = Array.isArray(payload?.urls) ? payload.urls : null;
    if (!urls || urls.length === 0) {
      return json({ error: 'urls must be a non-empty array' }, 400);
    }
    if (urls.length > MAX_URLS_PER_REQUEST) {
      return json({ error: `at most ${MAX_URLS_PER_REQUEST} urls per request` }, 400);
    }
    if (!urls.every((u) => typeof u === 'string' && /^https:\/\//.test(u))) {
      // HTTPS only. Without this the Worker would relay plain HTTP, which is
      // both useless for feeds and one more thing to get wrong.
      return json({ error: 'every url must be an https string' }, 400);
    }

    const results = await Promise.all(urls.map((url) => fetchOne(url, request.headers)));

    return json({
      // Echoed so the fetcher can prove it was told about every URL it asked
      // about, including any the Worker chose not to answer.
      requested: urls.length,
      results
    }, 200);
  }
};