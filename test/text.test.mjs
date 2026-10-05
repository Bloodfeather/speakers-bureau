// test/text.test.mjs - entity decoding, tag stripping, word-boundary excerpts.
//
// NON-ASCII HANDLING IN THIS FILE. Rule 1 and ROADMAP design rule 9: no literal
// typographic glyph is ever typed into an authored file. Where a test needs a
// genuine non-ASCII character it is BUILT FROM ITS CODE POINT and the code
// point is then ASSERTED BACK. Asserting the code point rather than a pasted
// glyph is the part that matters: if the file were ever re-encoded and the
// glyph silently became an ASCII apostrophe, a test comparing against a pasted
// literal would still pass, whereas one comparing 0x2019 against 0x27 cannot.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeEntities, stripHtml, makeExcerpt } from '../scripts/lib/text.mjs';

// Built from code points, never pasted.
const RIGHT_SINGLE_QUOTE = String.fromCharCode(0x2019); // typographic apostrophe
const LEFT_SINGLE_QUOTE = String.fromCharCode(0x2018);
const LEFT_DOUBLE_QUOTE = String.fromCharCode(0x201c);
const EM_DASH = String.fromCharCode(0x2014);
const NBSP = String.fromCharCode(0xa0);
const ELLIPSIS_CHAR = String.fromCharCode(0x2026);

// Confirm the constants above are what they claim to be, before trusting them
// in any assertion. If this file were ever mangled, this test fails loudly
// rather than the other tests failing for a confusing reason.
test('the non-ASCII constants are built from the intended code points', () => {
  assert.equal(RIGHT_SINGLE_QUOTE.charCodeAt(0), 0x2019);
  assert.equal(LEFT_SINGLE_QUOTE.charCodeAt(0), 0x2018);
  assert.equal(LEFT_DOUBLE_QUOTE.charCodeAt(0), 0x201c);
  assert.equal(EM_DASH.charCodeAt(0), 0x2014);
  assert.equal(NBSP.charCodeAt(0), 0xa0);
  assert.equal(ELLIPSIS_CHAR.charCodeAt(0), 0x2026);
});

test('decodes the named entities that RSS actually contains', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeEntities('he said &quot;hi&quot;'), 'he said "hi"');
  assert.equal(decodeEntities('it&#39;s'), "it's");
  assert.equal(decodeEntities('&apos;'), "'");
  assert.equal(decodeEntities('a&nbsp;b'), `a${NBSP}b`);
  assert.equal(decodeEntities('&#x27;'), "'");
});

test('decodes decimal numeric entities and preserves the resulting code point', () => {
  const decoded = decodeEntities('the &#8217;corner store&#8217;');
  // POSITIVE CONTROL: not an ASCII apostrophe. This is the assertion that
  // catches a degraded fixture turning 0x2019 into 0x27.
  assert.notEqual(decoded, "the 'corner store'");
  assert.equal(decoded, `the ${RIGHT_SINGLE_QUOTE}corner store${RIGHT_SINGLE_QUOTE}`);
  // Assert the code point at the exact offset where the character landed:
  // "the " is 4 chars, so the decoded quote is at index 4.
  assert.equal(decoded.charCodeAt(4), 0x2019, 'decoded char must be U+2019, not ASCII');
  assert.equal(decoded.charCodeAt(4), 8217);
});

test('decodes hex numeric entities to the same characters as decimal', () => {
  assert.equal(decodeEntities('&#x2019;'), RIGHT_SINGLE_QUOTE);
  assert.equal(decodeEntities('&#x2019;').charCodeAt(0), 0x2019);
  assert.equal(decodeEntities('&#8217;'), decodeEntities('&#x2019;'));
});

test('decodes high code points for em dashes and curly double quotes', () => {
  assert.equal(decodeEntities('&#8212;'), EM_DASH);
  assert.equal(decodeEntities('&#8220;'), LEFT_DOUBLE_QUOTE);
  assert.equal(decodeEntities('&#8230;'), ELLIPSIS_CHAR);
  // Still not ASCII, still not normalized away.
  assert.notEqual(decodeEntities('&#8212;'), '-');
});

test('decodes multi-entity strings in one pass', () => {
  const input = '&lt;p&gt;Tom &amp; Jerry&#8217;s &quot;show&quot;&lt;/p&gt;';
  assert.equal(decodeEntities(input), `<p>Tom & Jerry${RIGHT_SINGLE_QUOTE}s "show"</p>`);
});

test('leaves unknown entities untouched rather than guessing', () => {
  assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;');
  assert.equal(decodeEntities('AT&T'), 'AT&T');
});

test('rejects lone surrogate code points instead of emitting invalid text', () => {
  // A lone surrogate would make JSON.stringify produce invalid UTF-8 escapes.
  assert.equal(decodeEntities('&#xD800;'), '&#xD800;');
  assert.equal(decodeEntities('&#x110000;'), '&#x110000;');
});

test('handles empty and non-string input without throwing', () => {
  assert.equal(decodeEntities(''), '');
  assert.equal(decodeEntities(null), '');
  assert.equal(decodeEntities(undefined), '');
  assert.equal(decodeEntities(42), '');
});

test('strips HTML tags and collapses block boundaries into spaces', () => {
  assert.equal(stripHtml('<p>one</p><p>two</p>'), 'one two');
  assert.equal(stripHtml('<div>a</div><div>b</div>'), 'a b');
  assert.equal(stripHtml('<strong>bold</strong> text'), 'bold text');
});

test('strips tags from an entity-laden fragment', () => {
  const html = `<p>He said ${'&#8220;'}hi&#8221; ${'&#8212;'} ok</p>`;
  assert.equal(stripHtml(html), `He said ${LEFT_DOUBLE_QUOTE}hi${String.fromCharCode(0x201d)} ${EM_DASH} ok`);
});

test('removes script and style contents entirely', () => {
  const html = '<p>keep</p><style>.x{display:none}</style><script>alert(1)</script>';
  const out = stripHtml(html);
  assert.equal(out, 'keep');
  assert.ok(!out.includes('display'));
  assert.ok(!out.includes('alert'));
});

test('removes HTML comments', () => {
  assert.equal(stripHtml('<p>a</p><!-- secret --><p>b</p>'), 'a b');
});

test('treats a non-breaking space as whitespace', () => {
  // &nbsp; decodes to U+00A0, which must not survive as a literal in output.
  assert.equal(stripHtml('a&nbsp;&nbsp;b'), 'a b');
});

test('returns an empty string for empty or non-string input', () => {
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
});

test('makeExcerpt returns short text unchanged', () => {
  const text = 'Short enough.';
  assert.equal(makeExcerpt(text), text);
  assert.equal(makeExcerpt(text).endsWith('...'), false, 'no ellipsis when nothing was cut');
});

test('makeExcerpt cuts on a word boundary, not mid-word', () => {
  const words = [];
  for (let i = 0; i < 200; i += 1) words.push(`word${i}`);
  const long = words.join(' ');

  const excerpt = makeExcerpt(long, 100);
  assert.ok(excerpt.length > 0, 'positive control');
  assert.ok(excerpt.endsWith('...'), 'ellipsis must be appended');
  assert.ok(excerpt.length <= 103, `capped length exceeded: ${excerpt.length}`);

  // The critical assertion: no partial trailing word. Strip the ellipsis and
  // the last token must be a complete word from the source.
  const body = excerpt.slice(0, -3);
  const lastToken = body.slice(body.lastIndexOf(' ') + 1);
  assert.ok(lastToken.length > 0, 'excerpt must not end on whitespace');
  assert.ok(words.includes(lastToken), `cut mid-word: "${lastToken}" is not a whole word`);
});

test('makeExcerpt appends three ASCII dots, never the unicode ellipsis', () => {
  const long = 'alpha '.repeat(200);
  const excerpt = makeExcerpt(long, 50);
  assert.ok(excerpt.length > 0, 'positive control');
  assert.ok(excerpt.endsWith('...'), 'must end in three dots');
  assert.ok(
    !excerpt.includes(ELLIPSIS_CHAR),
    'the unicode ellipsis must never appear in text we author'
  );
  assert.equal(excerpt.charCodeAt(excerpt.length - 1), 0x2e, 'last char must be ASCII period');
});

test('makeExcerpt preserves typographic characters inside the cut text', () => {
  const words = [];
  for (let i = 0; i < 200; i += 1) words.push(i % 2 === 0 ? `it${RIGHT_SINGLE_QUOTE}s` : `plain${i}`);
  const long = words.join(' ');

  const excerpt = makeExcerpt(long, 120);
  assert.ok(excerpt.length > 0, 'positive control');
  // The authors' characters survive. No "smart punctuation to ASCII" cleaner.
  assert.ok(
    excerpt.includes(RIGHT_SINGLE_QUOTE),
    'typographic apostrophes must be preserved, not normalized to ASCII'
  );
  assert.ok(
    !excerpt.includes("it's"),
    'the typographic apostrophe must not have been converted to ASCII'
  );
  // Assert a surviving code point directly.
  assert.ok(excerpt.split('').some((ch) => ch.charCodeAt(0) === 0x2019));
});

test('makeExcerpt does not cut absurdly early when the window has no space', () => {
  // A 100-char run with no spaces: the fallback must not yield a 5-char excerpt.
  const long = 'x'.repeat(500);
  const excerpt = makeExcerpt(long, 100);
  assert.ok(excerpt.length > 90, `degenerate cut: ${excerpt.length}`);
  assert.ok(excerpt.endsWith('...'));
});

test('makeExcerpt handles empty and non-string input', () => {
  assert.equal(makeExcerpt(''), '');
  assert.equal(makeExcerpt(null), '');
  assert.equal(makeExcerpt(undefined), '');
});

test('makeExcerpt accepts raw HTML and strips it first', () => {
  const html = `<p>${'alpha &nbsp; bravo '.repeat(40)}</p>`;
  const excerpt = makeExcerpt(html, 100);
  assert.ok(excerpt.length > 0, 'positive control');
  assert.ok(!excerpt.includes('<'), 'tags must be stripped');
  assert.ok(!excerpt.includes('&nbsp;'), 'entities must be decoded');
});