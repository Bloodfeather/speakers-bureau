// scripts/lib/egress.mjs
//
// A fetch-shaped transport that relays a request through the feed-egress Worker.
//
// WHY THIS EXISTS, in one paragraph. GitHub's Actions runners cannot read these
// feeds: every feed answers HTTP 403 with `cf-mitigated: challenge` from that
// network, on every User-Agent, while `example.com` answers 200 from the same
// runner. It is Cloudflare challenging GitHub's egress range. scripts/lib/http.mjs
// already accepts an injectable `fetchImpl`, so the fix is a different transport
// rather than a different fetcher, and every rule about validation, retries and
// what counts as a failure stays exactly where it was, still under test.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not parse, validate, retry, cache or
// normalise. It does not know what an article is. It moves one URL's bytes and
// reports the origin's answer faithfully, INCLUDING the answer "403", because a
// transport that turned a refusal into a success would be the single most
// dangerous thing this project could ship.
//
// THE SHAPE IT RETURNS is Response-LIKE, not a Response, and the difference
// matters. A `new Response(...)` constructed here has an EMPTY `.url`, and
// ROADMAP design rule 4 depends on the resolved URL being reported: a configured
// feedUrl may legitimately redirect to a different host and a different
// publication, and the fetcher prints that resolved URL instead of treating the
// redirect as a failure. Losing `.url` would silently break that rule, so the
// relay carries `finalUrl` through explicitly. Only the five members http.mjs
// actually reads are implemented: status, ok, url, headers.get(), text().
//
// FAILURE IS FAILURE. If the Worker is unreachable, refuses the token, or
// answers with something that is not the documented shape, this THROWS. It does
// not invent a response. http.mjs catches the throw and reports status 0 with
// the message attached, which is honest: no HTTP response was obtained. A
// transport that swallowed its own failures and returned an empty 200 would
// turn a broken egress into a dataset of nothing that looked like a successful
// fetch of nothing.

/** Thrown when the egress Worker itself misbehaves, as opposed to a feed 403. */
export class EgressError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'EgressError';
    this.detail = detail ?? null;
  }
}

// Per-request timeout for the hop to the Worker. Shorter than the feed timeout
// on purpose: if the Worker is not answering, waiting the feed's full budget on
// every source turns one broken hop into four sequential stalls.
const EGRESS_TIMEOUT_MS = 20_000;

/**
 * Build a fetch-shaped function that relays through the Worker.
 *
 * @param {object} options
 * @param {string} options.endpoint  the Worker's https URL
 * @param {string} options.token     the shared secret
 * @param {Function} [options.fetchImpl] injectable for tests
 * @returns {Function} a (url, options) => Promise<Response-like>
 */
export function createEgressTransport({ endpoint, token, fetchImpl = globalThis.fetch }) {
  if (!endpoint) throw new EgressError('createEgressTransport: endpoint is required');
  if (!token) throw new EgressError('createEgressTransport: token is required');

  // Headers the Worker is documented to relay. Stored LOWERCASE and, crucially,
  // looked up case-INSENSITIVELY.
  //
  // The first version matched `options.headers['user-agent']` against a list
  // written in lowercase, while http.mjs sends 'User-Agent' with capitals. So
  // the lookup missed, the User-Agent was silently dropped, and the Worker would
  // have fetched every feed with no identification at all - in a project whose
  // whole argument is that it identifies itself honestly to publishers. Nothing
  // else would have caught it: the fetch would still have succeeded, and the
  // deployed site would have been identical.
  //
  // HTTP header names are case-insensitive by specification, so treating them
  // otherwise here was simply a bug, not a choice.
  const FORWARDED = ['user-agent', 'accept'];

  return async function egressFetch(url, options = {}) {
    const signal = options.signal ?? AbortSignal.timeout(EGRESS_TIMEOUT_MS);

    // One lowercase view of whatever the caller sent, so the forwarding below
    // cannot depend on how the caller happened to capitalise its headers.
    const incoming = new Map(
      Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
    );
    const forwarded = Object.fromEntries(
      FORWARDED.filter((name) => incoming.has(name)).map((name) => [name, incoming.get(name)])
    );

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        signal,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...forwarded
        },
        body: JSON.stringify({ urls: [url] })
      });
    } catch (err) {
      // The Worker could not be reached. Not a feed failure - a broken pipe -
      // and the wording says so, because "403" and "could not reach the egress
      // Worker" call for completely different responses from whoever is awake.
      throw new EgressError(
        `could not reach the feed-egress Worker at ${endpoint}: ${err.message}`,
        'transport-unreachable'
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        // A non-JSON error body is not worth failing over; the status is the
        // actionable part and this path is already an error.
      }
      const hint =
        response.status === 401
          ? ' - the token is wrong or FEED_EGRESS_TOKEN is not set on the Worker'
          : response.status === 500
            ? ' - FEED_EGRESS_TOKEN is probably not set on the Worker'
            : '';
      throw new EgressError(
        `feed-egress Worker returned HTTP ${response.status}${hint}`,
        detail
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new EgressError(
        `feed-egress Worker returned a body that is not JSON: ${err.message}`,
        'bad-shape'
      );
    }

    const result = Array.isArray(payload?.results) ? payload.results[0] : null;
    if (!result || typeof result.status !== 'number') {
      throw new EgressError(
        'feed-egress Worker returned the documented envelope with no usable result for the requested URL',
        'bad-shape'
      );
    }

    // A truncation would silently produce a feed that parses but is missing
    // items, which is the shape of a quiet data-loss bug. Refuse loudly instead.
    if (result.truncated) {
      throw new EgressError(
        `feed-egress Worker truncated the body for ${url}, so the feed would be parsed incomplete`,
        'truncated'
      );
    }

    return {
      status: result.status,
      ok: result.ok ?? (result.status >= 200 && result.status < 300),
      // Carried explicitly; see the note about constructed Responses above.
      url: result.finalUrl || url,
      headers: {
        get(name) {
          const key = String(name).toLowerCase();
          const value = result.headers?.[key];
          return value === undefined || value === null ? null : value;
        }
      },
      async text() {
        return result.body ?? '';
      }
    };
  };
}

/**
 * Choose the transport for this process.
 *
 * The decision is one environment variable, and the interesting case is the
 * one where it is set WITHOUT a token. That configuration must NOT silently fall
 * back to a direct request: the direct request is exactly the path that is
 * blocked, so falling back would reproduce the original 403 with no
 * explanation and no hint that a token had been forgotten. It throws instead.
 *
 * @returns {Function|null} null means "use the network directly"
 */
export function resolveFetchImpl(env = process.env) {
  const endpoint = env.FEED_EGRESS_URL;
  if (!endpoint) return null;
  return createEgressTransport({ endpoint, token: env.FEED_EGRESS_TOKEN });
}