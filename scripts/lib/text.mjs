// scripts/lib/text.mjs
//
// HTML/feed text utilities. Three jobs, no network, no I/O, no dependencies.
//
// DESIGN NOTE - typographic characters are PRESERVED, never normalized.
// Substack post bodies are full of curly quotes, em dashes and non-breaking
// spaces. Those are the AUTHORS' characters, not typos, and they round-trip
// correctly through UTF-8 JSON. There is deliberately NO "smart punctuation to
// ASCII" cleaner in this file. Doing that would be a small act of vandalism on
// someone's prose. The ASCII-only rule from ROADMAP design rule 9 applies to
// files *we* author; text fetched from the internet is explicitly exempt.

// Entities XML/HTML requires us to understand, beyond the numeric form.
// Longest names first so `&apos;` cannot be shadowed by a shorter prefix.
const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00a0'],
  ['hellip', '\u2026'],
  ['mdash', '\u2014'],
  ['ndash', '\u2013'],
  ['lsquo', '\u2018'],
  ['rsquo', '\u2019'],
  ['ldquo', '\u201c'],
  ['rdquo', '\u201d']
]);

// Matches a numeric entity in either decimal (&#8217;) or hex (&#x2019;)
// form. Kept as one regex so a single pass handles both.
const NUMERIC_ENTITY = /&#(?:x([0-9a-fA-F]+)|([0-9]+));/g;
const ANY_ENTITY = /&(?:#(?:x[0-9a-fA-F]+|[0-9]+)|[a-zA-Z][a-zA-Z0-9]*);/g;

/**
 * Decode HTML/XML character references in a string.
 *
 * Unknown entities are left EXACTLY as they are. Rewriting `&foo;` to
 * something guessed would corrupt real text; leaving it alone is visible and
 * harmless. A feed with an entity we do not know still reads correctly.
 *
 * @param {string} input
 * @returns {string}
 */
export function decodeEntities(input) {
  if (typeof input !== 'string' || input.length === 0) return '';

  // Numeric pass first: fast-xml-parser leaves entity text inside CDATA
  // sections untouched (verified: `&#8217;` survives as literal text), so the
  // numbers really are still numbers at this point.
  let out = input.replace(NUMERIC_ENTITY, (match, hex, dec) => {
    const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
    // Surrogate halves are not valid standalone characters. Leave them be
    // rather than emitting a lone surrogate that would break JSON encoding.
    if (code >= 0xd800 && code <= 0xdfff) return match;
    return String.fromCodePoint(code);
  });

  // Named-entity pass. ANY_ENTITY has NO capturing group, so the callback's
  // second argument would be the match OFFSET, not a name. An earlier draft
  // read it as a name and called .toLowerCase() on a number, which threw a
  // TypeError on every string containing &amp;. Slice the name out of the
  // match instead of trusting a capture group that does not exist.
  out = out.replace(ANY_ENTITY, (match) => {
    // Skip anything the numeric pass already handled.
    if (match.startsWith('&#')) return match;
    const name = match.slice(1, -1);
    const mapped = NAMED_ENTITIES.get(name) ?? NAMED_ENTITIES.get(name.toLowerCase());
    return mapped === undefined ? match : mapped;
  });

  return out;
}

/**
 * Strip HTML tags from a fragment and decode entities, leaving readable text.
 *
 * Block-level tags become a single space so that `<p>one</p><p>two</p>` does
 * not collapse into the unreadable `onetwo`. Script and style contents are
 * removed outright - their text is never prose and in a feed body it is often
 * a JSON blob.
 *
 * @param {string} input
 * @returns {string}
 */
export function stripHtml(input) {
  if (typeof input !== 'string' || input.length === 0) return '';

  let out = input;
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  out = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  out = out.replace(/<br\s*\/?>/gi, ' ');
  out = out.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article)\s*>/gi, ' ');
  out = out.replace(/<[^>]*>/g, '');

  out = decodeEntities(out);
  // Collapse whitespace, including the NBSP that decodeEntities just produced
  // from &nbsp;. NBSP is U+00A0, not matched by a plain \s in older engines, so
  // name it explicitly rather than trusting \s to cover it.
  out = out.replace(/[\s\u00a0]+/g, ' ').trim();

  return out;
}

/**
 * Build a short excerpt, cut on a word boundary.
 *
 * Ellipsis is three ASCII dots, never U+2026, because we author this string.
 *
 * @param {string} input raw or already-stripped text
 * @param {number} [maxLength=300]
 * @returns {string}
 */
export function makeExcerpt(input, maxLength = 300) {
  const text = typeof input === 'string' ? stripHtml(input) : '';
  if (text.length === 0) return '';
  if (text.length <= maxLength) return text;

  const hardCut = text.slice(0, maxLength);
  const lastSpace = hardCut.lastIndexOf(' ');
  // Only honour a word boundary if it is not absurdly early - a 300-char window
  // whose last space is at index 4 would otherwise yield a 5-char excerpt.
  const cutAt = lastSpace > maxLength * 0.6 ? lastSpace : hardCut.length;

  return hardCut.slice(0, cutAt).replace(/[\s.,;:!?-]+$/, '') + '...';
}