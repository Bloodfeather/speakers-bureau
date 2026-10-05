// scripts/lib/rss.mjs
//
// Namespace-aware RSS 2.0 parsing and normalization into the dataset shape.
//
// WHY A REAL XML PARSER AND NOT REGEX. The instruction is literal: a regex for
// `<title>` also matches `<dc:title>`, and a Substack `description` and
// `content:encoded` are multi-kilobyte HTML fragments whose tags would be
// happily consumed as feed structure. fast-xml-parser is a real XML parser and
// keeps namespace prefixes as part of the key, so `dc:creator` and
// `content:encoded` arrive as their own keys and cannot be confused with
// `title`.
//
// PARSER OPTIONS, each one earning its place:
//   ignoreAttributes:false    we need @_url off <enclosure>
//   attributeNamePrefix:'@_'  distinguishes attributes from child elements
//   textNodeName:'#text'      <guid isPermaLink="false">u1</guid> is an object
//   parseTagValue:false       pubDate must stay a STRING. With this on,
//                             fast-xml-parser would try to coerce it and a
//                             date-like value could come back as a number,
//                             silently changing the type we hand to Date.
//   trimValues:true           CDATA bodies are indented; trailing whitespace
//                             would leak into titles
//   isArray: (name) => ...    force item/category to arrays so a single-entry
//                             feed and a 20-entry feed have identical shapes.
//                             Without it, `channel.item` is an object for one
//                             item and an array for many, which is the classic
//                             off-by-one crash in an aggregator.
//   processEntities           left at its default, but note CDATA is NOT
//                             entity-decoded by the parser (verified: `&#8217;`
//                             survives as literal text inside CDATA). So we
//                             decode entities ourselves in text.mjs. Keeping
//                             that in one place avoids double-decoding.

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { decodeEntities, stripHtml, makeExcerpt } from './text.mjs';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Collapse an empty element to '' rather than dropping it, so "field present
  // but empty" and "field absent" both normalize to null instead of one of
  // them vanishing and changing which branch we take.
  alwaysCreateTextNode: false,
  isArray: (name) => name === 'item' || name === 'category'
});

// Categories longer than this are almost always a sentence, not a tag.
const MAX_CATEGORIES = 8;
const MAX_AUTHOR = 120;

/**
 * Coerce a fast-xml-parser value to a plain string.
 *
 * Handles: plain strings, `#text` wrappers (an element with attributes),
 * numbers that arrived as-is, arrays, and null/undefined.
 */
function asText(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    // A repeated element: take the first non-empty one.
    for (const entry of value) {
      const text = asText(entry);
      if (text) return text;
    }
    return null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if ('#text' in value) return asText(value['#text']);
    return null;
  }
  if (typeof value !== 'string') return null;

  // CDATA arrives as raw text with entities still undecoded. Decode here so
  // every consumer downstream sees plain text, and so a title containing
  // `&amp;` displays as `&` rather than as six literal characters.
  const decoded = decodeEntities(value);
  return decoded.trim() === '' ? null : decoded;
}

/** Same as asText but collapses whitespace, for prose-ish fields. */
function asProse(value) {
  const text = asText(value);
  if (text === null) return null;
  return stripHtml(text);
}

/**
 * Stable, URL-safe slug used as the article `id`.
 *
 * Derived from the guid (falling back to the link) so the same article
 * collapses across runs and across feeds. Must be deterministic: dedupe is the
 * whole reason this exists.
 *
 * @param {string} raw
 * @returns {string}
 */
export function slugify(raw) {
  const base = String(raw || '')
    .trim()
    .toLowerCase();
  const slug = base
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // A pathological input could reduce to an empty slug. Fall back to a stable
  // hash of the input so two different URLs never collide on ''.
  if (slug.length === 0) {
    let hash = 5381;
    for (let i = 0; i < base.length; i += 1) {
      hash = ((hash << 5) + hash + base.charCodeAt(i)) | 0;
    }
    return `id-${(hash >>> 0).toString(36)}`;
  }
  // Long Substack URLs can exceed 80 chars after slugging. Truncating risks a
  // collision, so append a short hash of the full input whenever we truncate.
  if (slug.length > 80) {
    let hash = 5381;
    for (let i = 0; i < base.length; i += 1) {
      hash = ((hash << 5) + hash + base.charCodeAt(i)) | 0;
    }
    return `${slug.slice(0, 70)}-${(hash >>> 0).toString(36)}`;
  }
  return slug;
}

// A bare "YYYY-MM-DD HH:MM:SS" with NO timezone marker.
// Naive date-time shapes that carry no offset.
const NAIVE_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T])(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/;

/**
 * Normalize a date to an ISO 8601 UTC string.
 *
 * DESIGN RULE 8 - UTC, always, and this is subtler than it looks.
 *
 * `new Date('2026-10-05 10:03:33')` does NOT mean 10:03:33 UTC. Per the
 * ECMAScript Date Time String Format, a string with a date, a time and NO
 * offset is interpreted in LOCAL time. On this machine (UTC-4) that call
 * returned 2026-10-05T14:03:33.000Z - four hours wrong, and silently so.
 *
 * The ROADMAP threat this implements against is concrete: GH Pages builds run
 * in a different timezone than this machine, so a dataset produced by
 * `new Date()` on a naive string would render DIFFERENT times depending on
 * where it was built, and the ordering of the whole feed could shift across a
 * DST boundary. Sorting by a timestamp that moves is a bug you only find after
 * publishing.
 *
 * So: any naive date-time is turned into an explicit UTC string by APPENDING Z
 * before Date ever sees it. A string that already carries an offset (RSS
 * pubDate is always RFC822 with GMT, so this is the normal live path) is passed
 * through untouched.
 *
 * @param {unknown} value
 * @returns {string|null} ISO string, or null if unparseable
 */
export function toIsoUtc(value) {
  const text = asText(value);
  if (text === null) return null;

  const naive = text.match(NAIVE_DATETIME);
  if (naive) {
    const [, y, mo, d, h, mi, s = '00'] = naive;
    const explicit = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return null;
  }

  // Everything else must declare its own offset, or be a shape Date genuinely
  // understands unambiguously (RFC822 "Mon, 05 Oct 2026 10:03:33 GMT", or ISO
  // with a Z or +hh:mm suffix).
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  return null;
}

/** Pull the enclosure image URL, tolerating a missing or attribute-less node. */
function extractImage(item) {
  const enclosure = item.enclosure;
  const candidate = Array.isArray(enclosure) ? enclosure[0] : enclosure;
  if (candidate && typeof candidate === 'object' && typeof candidate['@_url'] === 'string') {
    const url = candidate['@_url'].trim();
    return url === '' ? null : url;
  }
  // Atom media:content is a plausible alternative in mixed feeds.
  const media = item['media:content'];
  const mediaCandidate = Array.isArray(media) ? media[0] : media;
  if (mediaCandidate && typeof mediaCandidate === 'object') {
    const url = mediaCandidate['@_url'];
    if (typeof url === 'string' && url.trim() !== '') return url.trim();
  }
  return null;
}

/** Extract up to MAX_CATEGORIES category labels. */
function extractCategories(item) {
  const raw = item.category;
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const out = [];
  for (const entry of list) {
    const term = asProse(entry);
    if (term === null) continue;
    const label = term.length > 80 ? term.slice(0, 80) : term;
    if (!out.includes(label)) out.push(label);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

/**
 * Parse an RSS 2.0 (or Atom) document.
 *
 * Returns `{ok, feed, items, error}`. Never throws - a malformed document is
 * reported, not raised, so the orchestrator can name the failure per source
 * and keep going.
 *
 * @param {string} xmlText
 * @returns {{ok:boolean, feed:object|null, items:object[], error:string|null}}
 */
export function parseFeed(xmlText) {
  if (typeof xmlText !== 'string' || xmlText.trim() === '') {
    return { ok: false, feed: null, items: [], error: 'feed body was empty' };
  }

  // STRICT PRE-CHECK. fast-xml-parser's parse() is deliberately LENIENT: it
  // auto-closes unclosed tags, so '<rss><channel><item>' parses "successfully"
  // into a plausible-looking object tree. Verified by a failing test in this
  // phase. The roadmap calls for a strict parse, so well-formedness is
  // checked up front with XMLValidator rather than discovered later as a
  // mysteriously empty feed.
  const wellFormed = XMLValidator.validate(xmlText);
  if (wellFormed !== true) {
    const err = wellFormed && wellFormed.err ? wellFormed.err : null;
    const code = err ? err.code : 'InvalidXml';
    const msg = err ? err.msg : 'unknown XML error';
    const where = err && err.line ? ` (line ${err.line}, col ${err.col ?? '?'})` : '';
    return {
      ok: false,
      feed: null,
      items: [],
      error: `body is not well-formed XML (${code}): ${msg}${where}`
    };
  }

  let doc;
  try {
    doc = parser.parse(xmlText);
  } catch (err) {
    return { ok: false, feed: null, items: [], error: `XML parse threw: ${err.message}` };
  }

  const root = doc.rss ? doc.rss : doc.feed ? doc.feed : doc['rdf:RDF'] ?? null;
  if (!root) {
    const keys = Object.keys(doc).join(', ') || '(none)';
    return {
      ok: false,
      feed: null,
      items: [],
      error: `document root was not rss, feed or rdf:RDF (top-level keys: ${keys})`
    };
  }

  const channel = root.channel ?? root;
  if (!channel || typeof channel !== 'object') {
    return { ok: false, feed: null, items: [], error: 'channel element was missing or not an object' };
  }

  const feed = {
    title: asProse(channel.title),
    link: asText(channel.link && typeof channel.link === 'object' ? channel.link['@_href'] : channel.link),
    description: asProse(channel.description),
    // subtitle is OPTIONAL. Verified live 2026-10-05: neither thefp nor
    // grayzone has a <subtitle> element. It is read if present and null if
    // not; it is never required.
    subtitle: asProse(channel.subtitle ?? channel.tagline)
  };

  const rawItems = channel.item ?? channel.entry ?? [];
  const list = Array.isArray(rawItems) ? rawItems : [rawItems];
  const items = list.filter((entry) => entry && typeof entry === 'object');

  return { ok: true, feed, items, error: null };
}

/**
 * Normalize one parsed item into the dataset shape.
 *
 * Shape (exact field set, names matter - Phase 3 renders these):
 *   { id, sourceId, sourceName, title, dek, author, url, image, publishedAt,
 *     excerpt, categories }
 *
 * Optional fields become null rather than '' or being omitted, so the site can
 * test one thing and the dataset keeps a stable shape across feeds.
 *
 * @param {object} item           raw item from parseFeed
 * @param {{id:string,name:string}} source
 * @param {string} resolvedUrl    final URL after redirects (design rule 4)
 * @returns {object} normalized article
 */
export function normalizeItem(item, source, resolvedUrl) {
  const sourceId = source?.id ?? 'unknown';
  const sourceName = source?.name ?? sourceId;

  const title = asProse(item.title);
  const link = asText(item.link && typeof item.link === 'object' ? item.link['@_href'] : item.link);
  // Verified live: on Substack the guid's text equals the link. Prefer the guid
  // for the id because that is the publisher's own stable identifier, and fall
  // back through link then title so we never produce an id of ''.
  const guid = asText(item.guid && typeof item.guid === 'object' ? item.guid['#text'] : item.guid);
  const description = asProse(item.description);

  // subtitle is preferred for the dek, but ONLY when the item itself carries
  // one. The channel-level subtitle is a publication tagline, not this
  // article's dek, so it is deliberately not used as a fallback. A missing dek
  // stays null. Inventing one is worse than showing none.
  const dek = asProse(item.subtitle ?? item.tagline);

  const rawAuthor = asProse(item['dc:creator'] ?? item.author ?? item['itunes:author']);
  const author = rawAuthor === null ? null : rawAuthor.length > MAX_AUTHOR ? `${rawAuthor.slice(0, MAX_AUTHOR - 3)}...` : rawAuthor;

  // Prefer the feed's description (an editor-written standfirst) and only fall
  // back to the full body when there is none.
  const contentEncoded = asText(item['content:encoded'] ?? item.content);
  const excerptSource = description && description.length > 0 ? description : contentEncoded;
  const excerpt = excerptSource ? makeExcerpt(excerptSource, 300) : null;

  const publishedAt = toIsoUtc(item.pubDate ?? item.published ?? item.updated ?? item['dc:date']);

  return {
    id: slugify(guid || link || title || `${sourceId}-unknown`),
    sourceId,
    sourceName,
    title: title ?? '(untitled)',
    dek: dek ?? null,
    author: author ?? null,
    url: link ?? null,
    image: extractImage(item),
    publishedAt,
    excerpt: excerpt === '' ? null : excerpt,
    categories: extractCategories(item)
  };
}