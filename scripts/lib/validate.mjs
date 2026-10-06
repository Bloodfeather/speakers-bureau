// scripts/lib/validate.mjs
//
// The three-assertion feed validity rule (ROADMAP design rule 2).
//
// WHY THREE AND NOT ONE: a fetcher that checks only the status code accepts
// garbage. Observed live:
//   https://nostarch.substack.com/feed  -> HTTP 200, Content-Type text/html
// That is a publication that does not exist. It redirects to
// https://substack.com/@nostarch and serves a 200 with an HTML body. There is
// no 404 to catch. Each assertion below exists because the previous weaker
// version passed that response.
//
// ALL THREE ARE REQUIRED. One failing rejects the feed.
//
// Assertion 2 has a subtlety worth stating plainly. There are TWO distinct
// ways a non-feed gets here, and both are real:
//
//   (a) The body is not well-formed XML at all. This is what ACTUAL Substack
//       404 pages produce: they contain bare void elements like
//       <meta charset="utf-8">, and HTML void elements are not well-formed XML.
//       XMLValidator rejects them with "Expected closing tag 'meta'".
//
//   (b) The body IS well-formed XML but is not rooted at <rss> or <feed>.
//       A tidy HTML document with no void elements lands here.
//
// Verified against XMLValidator directly; see the tests for both cases. Because
// (b) is reachable, "it parsed" is NOT sufficient on its own and must never be
// reported as though it were - hence the explicit root-element check.

import { XMLValidator } from 'fast-xml-parser';

/**
 * Does this Content-Type claim to be XML?
 * Accepts application/xml, text/xml, application/rss+xml, application/atom+xml
 * and any of them with parameters (`; charset=utf-8`).
 */
function contentTypeLooksXml(contentType) {
  if (typeof contentType !== 'string' || contentType.trim() === '') return false;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return (
    mime === 'application/xml' ||
    mime === 'text/xml' ||
    mime === 'application/rss+xml' ||
    mime === 'application/atom+xml' ||
    mime === 'application/x-rss+xml' ||
    mime.endsWith('+xml')
  );
}

/**
 * Assertion 1: Content-Type indicates XML.
 * @returns {{ok:boolean, reason:string, detail:string}}
 */
function assertContentType(contentType) {
  if (contentTypeLooksXml(contentType)) {
    return { ok: true, reason: 'content-type-ok', detail: `content-type was "${contentType}"` };
  }
  // This is the exact real-world failure: a nonexistent publication answers
  // 200 text/html. Say so with the value we actually saw, not a generic
  // "invalid feed", because that message is the only thing standing between an
  // operator and a wasted afternoon.
  return {
    ok: false,
    reason: 'content-type-not-xml',
    detail:
      `content-type was "${contentType || '(absent)'}" but an XML media type was required. ` +
      'This is usually a publication that does not exist: Substack serves HTTP 200 text/html ' +
      'for unknown feeds rather than a 404, so a status-code-only check accepts it.'
  };
}

/**
 * Assertion 2: the body is well-formed XML AND parses to a feed root element.
 * @returns {{ok:boolean, reason:string, detail:string}}
 */
function assertParses(body) {
  if (typeof body !== 'string' || body.trim() === '') {
    return {
      ok: false,
      reason: 'body-not-xml',
      detail: 'body was empty, so there was nothing to parse as XML'
    };
  }

  let valid;
  try {
    valid = XMLValidator.validate(body);
  } catch (err) {
    return {
      ok: false,
      reason: 'body-not-xml',
      detail: `XML validation threw: ${err.message}`
    };
  }

  if (valid !== true) {
    const msg = valid && valid.err ? valid.err.msg : 'unknown XML error';
    const code = valid && valid.err ? valid.err.code : 'InvalidXml';
    return {
      ok: false,
      reason: 'body-not-xml',
      detail: `body failed to parse as XML (${code}): ${msg}`
    };
  }

  // Well-formed, but is it a FEED? Prose and an HTML page both pass the
  // validator. Look for the root element rather than trusting well-formedness.
  const rootMatch = body.match(/<([A-Za-z_][\w.:-]*)\b/);
  const root = rootMatch ? rootMatch[1].toLowerCase() : '';
  if (root !== 'rss' && root !== 'feed') {
    return {
      ok: false,
      reason: 'body-not-feed-xml',
      detail:
        `body is well-formed XML but its root element is <${root || '(none found)'}>, ` +
        'not <rss> or <feed>. A well-formed XML check alone cannot tell an RSS feed ' +
        'from an HTML page, so the root element is checked explicitly.'
    };
  }

  return { ok: true, reason: 'parses-as-xml', detail: `body parsed as XML with root element <${root}>` };
}

/**
 * Assertion 3: at least one item was produced.
 *
 * A technically perfect, correctly-typed, empty feed is still useless to this
 * site: it would silently zero out that publication's contribution while every
 * other check passed green.
 *
 * @param {unknown[]} items
 * @returns {{ok:boolean, reason:string, detail:string}}
 */
function assertHasItems(items) {
  const count = Array.isArray(items) ? items.length : 0;
  if (count >= 1) {
    return { ok: true, reason: 'has-items', detail: `parsed ${count} item(s)` };
  }
  return {
    ok: false,
    reason: 'no-items',
    detail:
      'the feed parsed as valid XML but yielded 0 items. A correctly-typed, ' +
      'well-formed but empty feed would silently drop this publication from the ' +
      'site, so an empty item list is treated as a failure rather than a valid result.'
  };
}

/**
 * Run all three assertions against a fetched feed.
 *
 * NEVER throws. Returns `{ok, reason, detail}` where `reason` is a short stable
 * slug suitable for logs and `detail` is the human-readable sentence to print.
 *
 * @param {object} input
 * @param {string} input.contentType
 * @param {string} input.body
 * @param {unknown[]} [input.items] parsed items, from rss.parseFeed
 * @returns {{ok:boolean, reason:string, detail:string}}
 */
export function validateFeedXml(input) {
  // A default parameter only covers `undefined`. A caller passing `null` (a
  // plausible thing to do with a failed fetch's result object) would otherwise
  // throw a TypeError here - and this function is contracted never to throw.
  const { contentType, body, items } = input ?? {};

  const contentTypeResult = assertContentType(contentType);
  if (!contentTypeResult.ok) {
    return { ok: false, reason: contentTypeResult.reason, detail: contentTypeResult.detail };
  }

  const parseResult = assertParses(body);
  if (!parseResult.ok) {
    return { ok: false, reason: parseResult.reason, detail: parseResult.detail };
  }

  const itemResult = assertHasItems(items);
  if (!itemResult.ok) {
    return { ok: false, reason: itemResult.reason, detail: itemResult.detail };
  }

  return {
    ok: true,
    reason: 'valid',
    detail: `valid feed: ${contentTypeResult.detail}; ${parseResult.detail}; ${itemResult.detail}`
  };
}

/**
 * ASSERTION 1 alone: does this Content-Type claim to be XML?
 *
 * Exported so the orchestrator can run the cheap, decisive check BEFORE it
 * spends time parsing a body it already knows is not a feed. Running the parse
 * first would report the downstream symptom ("document root was not rss")
 * rather than the cause, which is one HTTP header away.
 *
 * @param {string} contentType
 * @returns {{ok:boolean, reason:string, detail:string}}
 */
export function checkContentType(contentType) {
  return assertContentType(contentType);
}

/**
 * ASSERTION 2 alone: is the body well-formed XML AND rooted at a feed element?
 * @param {string} body
 * @returns {{ok:boolean, reason:string, detail:string}}
 */
export function checkParsesAsXml(body) {
  return assertParses(body);
}

/**
 * ASSERTION 3 alone: did the feed yield at least one item?
 * @param {unknown[]} items
 * @returns {{ok:boolean, reason:string, detail:string}}
 */
export function checkHasItems(items) {
  return assertHasItems(items);
}

/** The three assertions, named. Exported so tests can assert on them individually. */
export const ASSERTIONS = ['content-type indicates XML', 'body parses as XML', 'yields >= 1 item'];
