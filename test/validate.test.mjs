// test/validate.test.mjs - the three assertions from ROADMAP design rule 2.
//
// EVERY NEGATIVE ASSERTION HERE HAS A POSITIVE CONTROL. A test that asserts
// "validation rejected the bad feed" passes just as happily if validation
// rejects EVERYTHING, including a perfectly good feed. So each negative test
// first proves the same function accepts the known-good input. Without that,
// this file could be green while the pipeline rejects all real feeds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateFeedXml, ASSERTIONS } from '../scripts/lib/validate.mjs';
import { parseFeed } from '../scripts/lib/rss.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOOD_XML = await readFile(resolve(HERE, 'fixtures', 'substack-feed.xml'), 'utf8');
const BAD_HTML = await readFile(resolve(HERE, 'fixtures', 'bad-publication.html'), 'utf8');

const GOOD_CT = 'application/xml; charset=utf-8';

/** A genuinely good feed, parsed so the item assertion has real items. */
function goodInput() {
  const parsed = parseFeed(GOOD_XML);
  assert.equal(parsed.ok, true, 'fixture must parse');
  assert.ok(parsed.items.length > 0, 'fixture must produce items');
  return { contentType: GOOD_CT, body: GOOD_XML, items: parsed.items };
}

test('the rule is exactly three named assertions', () => {
  assert.deepEqual(ASSERTIONS, [
    'content-type indicates XML',
    'body parses as XML',
    'yields >= 1 item'
  ]);
});

test('POSITIVE CONTROL: a real feed passes all three', () => {
  const result = validateFeedXml(goodInput());
  assert.equal(result.ok, true, `a good feed must validate, got: ${result.detail}`);
  assert.equal(result.reason, 'valid');
  assert.ok(result.detail.length > 0, 'detail must describe what passed');
});

test('ASSERTION 1 rejects text/html - the exact real 200-HTML failure', () => {
  // POSITIVE CONTROL first, with the identical function.
  assert.equal(validateFeedXml(goodInput()).ok, true, 'control: good feed must pass');

  // Now the real-world case: HTTP was 200. Only the body and type are wrong.
  const parsed = parseFeed(BAD_HTML);
  const result = validateFeedXml({
    contentType: 'text/html; charset=utf-8',
    body: BAD_HTML,
    items: parsed.items
  });

  assert.equal(result.ok, false, 'a text/html body must be rejected even at HTTP 200');
  assert.equal(result.reason, 'content-type-not-xml');
  // The message must NAME the actual failure, including the value seen.
  assert.match(result.detail, /text\/html/);
  assert.match(result.detail, /does not exist/i);
});

test('ASSERTION 1 rejects a missing content-type', () => {
  assert.equal(validateFeedXml(goodInput()).ok, true, 'control: good feed must pass');
  const parsed = parseFeed(GOOD_XML);
  const result = validateFeedXml({ contentType: '', body: GOOD_XML, items: parsed.items });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'content-type-not-xml');
});

test('ASSERTION 1 accepts every XML media type variant', () => {
  const parsed = parseFeed(GOOD_XML);
  assert.equal(parsed.ok, true, 'fixture must parse');
  assert.ok(parsed.items.length > 0, 'fixture must produce items');

  for (const ct of [
    'application/xml',
    'application/xml; charset=utf-8',
    'text/xml',
    'application/rss+xml',
    'application/atom+xml',
    'APPLICATION/XML; charset=UTF-8'
  ]) {
    const result = validateFeedXml({ contentType: ct, body: GOOD_XML, items: parsed.items });
    assert.equal(result.ok, true, `expected ${ct} to be accepted: ${result.detail}`);
  }
});

test('ASSERTION 2 rejects a body that is not well-formed XML', () => {
  assert.equal(validateFeedXml(goodInput()).ok, true, 'control: good feed must pass');
  const result = validateFeedXml({
    contentType: GOOD_CT,
    body: '<rss><channel><item><title>unclosed',
    items: [{}]
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'body-not-xml');
  assert.match(result.detail, /XML/);
});

test('ASSERTION 2 rejects well-formed XML that is not a feed', () => {
  // fast-xml-parser's XMLValidator accepts a tidy HTML document as valid XML,
  // because it genuinely is well-formed XML. Verified directly. So assertion 2
  // must check the root element too, or assertion 1 is the only thing standing
  // between a landing page and the dataset.
  assert.equal(validateFeedXml(goodInput()).ok, true, 'control: good feed must pass');

  const result = validateFeedXml({
    contentType: GOOD_CT,
    body: '<html><body><p>Not a feed at all.</p></body></html>',
    items: [{}]
  });
  assert.equal(result.ok, false, 'non-feed XML must be rejected');
  assert.equal(result.reason, 'body-not-feed-xml');
  assert.match(result.detail, /html/);
});

test('ASSERTION 3 rejects a feed that yields zero items', () => {
  assert.equal(validateFeedXml(goodInput()).ok, true, 'control: good feed must pass');

  const emptyFeed =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Quiet</title>' +
    '</channel></rss>';
  const result = validateFeedXml({ contentType: GOOD_CT, body: emptyFeed, items: [] });
  assert.equal(result.ok, false, 'a feed with no items must be rejected');
  assert.equal(result.reason, 'no-items');
  // Distinct from a parse failure, as required.
  assert.notEqual(result.reason, 'body-not-xml');
  assert.match(result.detail, /0 items/);
});

test('ASSERTION 3 rejects undefined items, not just an empty array', () => {
  assert.equal(validateFeedXml(goodInput()).ok, true, 'control: good feed must pass');
  const result = validateFeedXml({ contentType: GOOD_CT, body: GOOD_XML, items: undefined });
  assert.equal(result.ok, false, 'undefined items must be rejected');
  assert.equal(result.reason, 'no-items');
});

test('the three failure modes are distinguishable by reason', () => {
  // Each case isolates exactly ONE assertion, using a body that genuinely
  // satisfies the other two. If these collapse to the same reason, an operator
  // loses the ability to tell a wrong content-type from a broken document.
  const emptyFeed =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Quiet</title></channel></rss>';

  const cases = [
    // Assertion 1 fails; the body IS a valid feed.
    { contentType: 'text/html', body: GOOD_XML, items: [{}], reason: 'content-type-not-xml' },
    // Assertion 2 fails on well-formedness; items are irrelevant.
    { contentType: GOOD_CT, body: 'not xml at all', items: [{}], reason: 'body-not-xml' },
    // Assertion 3 fails; content-type and XML are both fine.
    { contentType: GOOD_CT, body: emptyFeed, items: [], reason: 'no-items' }
  ];
  const reasons = cases.map((c) => validateFeedXml(c).reason);
  assert.deepEqual(reasons, cases.map((c) => c.reason));
  // Three different reasons, so an operator can tell the failures apart.
  assert.equal(new Set(reasons).size, 3);
});

test('validateFeedXml never throws on hostile input', () => {
  const hostile = [undefined, null, {}, { contentType: null, body: null, items: null }];
  for (const input of hostile) {
    const result = validateFeedXml(input);
    assert.equal(typeof result.ok, 'boolean');
    assert.equal(typeof result.reason, 'string');
    assert.equal(typeof result.detail, 'string');
  }
});

test('the real 200-HTML body would ALSO fail assertion 2, not only assertion 1', () => {
  // Defense in depth: the bad-publication.html fixture, fed with a correct XML
  // content-type, must still be rejected. That proves assertion 2 is not dead
  // code that assertion 1 always shadows.
  const parsed = parseFeed(BAD_HTML);
  const result = validateFeedXml({
    contentType: GOOD_CT,
    body: BAD_HTML,
    items: parsed.items
  });
  assert.equal(result.ok, false, 'an HTML landing page is not a feed, whatever the content-type claims');
  assert.equal(result.reason, 'body-not-feed-xml');
});

test('real-world HTML with void elements fails well-formedness, not the root check', () => {
  // HONEST CORRECTION to an assumption made earlier in this phase.
  //
  // It was first recorded that "a tidy HTML document is well-formed XML, so
  // XMLValidator accepts it and the root check is what catches a 404 page".
  // That is only true of HTML WITHOUT void elements. Real Substack 404 pages
  // contain a bare <meta charset="utf-8">, and HTML void elements are not
  // well-formed XML. Verified against XMLValidator, which rejects the document
  // with: Expected closing tag 'meta' (opened in line 5, col 1) instead of
  // closing tag 'head'.
  //
  // So production HTML is usually caught at well-formedness, and only
  // void-free HTML reaches the root-element assertion. Both paths reject, which
  // is what matters, and both are now covered. The fixture uses the
  // well-formed form so the root check stays exercised.
  const realWorldHtml = [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"><title>Substack</title></head>',
    '<body><p>This publication does not exist.</p></body></html>'
  ].join('');

  const result = validateFeedXml({
    contentType: GOOD_CT,
    body: realWorldHtml,
    items: [{ fake: true }]
  });

  assert.equal(result.ok, false, 'HTML with void elements must be rejected');
  assert.equal(result.reason, 'body-not-xml');
  assert.match(result.detail, /well-formed|InvalidTag/);
});

test('a feed-shaped root with a void element is still rejected, and safely', () => {
  // Belt and braces: the root check must not be fooled into ACCEPTING anything
  // simply because a tag looked feed-ish.
  const tricky = '<rss version="2.0"><channel><meta name="x"><item/></channel></rss>';
  const result = validateFeedXml({
    contentType: GOOD_CT,
    body: tricky,
    items: [{ fake: true }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'body-not-xml');
});