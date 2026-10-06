// test/rss.test.mjs - parsing realistic Substack-shaped XML.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFeed, normalizeItem, slugify, toIsoUtc } from '../scripts/lib/rss.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(HERE, 'fixtures', name);

const TWO_ITEM_XML = await readFile(fixture('substack-feed.xml'), 'utf8');
const ONE_ITEM_XML = await readFile(fixture('single-item-feed.xml'), 'utf8');

const SOURCE = { id: 'examplepress', name: 'The Example Press' };
const RESOLVED = 'https://examplepress.test/feed';

test('parses channel metadata', () => {
  const { ok, feed, error } = parseFeed(TWO_ITEM_XML);
  // POSITIVE CONTROL: a good feed must actually yield something before any
  // field is asserted, so these assertions cannot pass on an empty parse.
  assert.equal(ok, true, `expected a clean parse, got error: ${error}`);
  assert.ok(feed, 'feed metadata must be present');
  assert.ok(feed.title && feed.title.length > 0, 'channel title must be non-empty');
  assert.equal(feed.title, 'The Example Press');
  assert.equal(feed.link, 'https://examplepress.test');
});

test('channel subtitle is optional and reported as null when absent', () => {
  // Verified live: neither thefp nor grayzone has a <subtitle> element. The
  // fixture has none either, so this asserts absence is handled, not required.
  const { ok, feed } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(feed.title && feed.title.length > 0, 'positive control');
  assert.equal(feed.subtitle, null);
});

test('parses multiple items as an array', () => {
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(Array.isArray(items), 'items must always be an array');
  assert.equal(items.length, 2);
});

test('parses a single-item feed without throwing or dropping it', () => {
  // The off-by-one bug: channel.item is an OBJECT here, not an array. Real
  // feeds do vary in size - 20, 20 and 1 were observed live.
  const { ok, items, error } = parseFeed(ONE_ITEM_XML);
  assert.equal(ok, true, `single-item parse failed: ${error}`);
  assert.ok(Array.isArray(items), 'a one-item feed must still yield an array');
  assert.equal(items.length, 1);
});

test('malformed input is reported, never thrown', () => {
  const result = parseFeed('<rss><channel><item>');
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  assert.deepEqual(result.items, []);
});

test('empty input is reported, never thrown', () => {
  const result = parseFeed('');
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
});

test('normalizes to the exact dataset shape', () => {
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control: fixture must produce items');

  const article = normalizeItem(items[0], SOURCE, RESOLVED);
  assert.deepEqual(
    Object.keys(article).sort(),
    [
      'author',
      'categories',
      'dek',
      'excerpt',
      'id',
      'image',
      'publishedAt',
      'sourceId',
      'sourceName',
      'title',
      'url'
    ].sort(),
    'normalized article must have exactly the agreed field set'
  );
});

test('reads dc:creator as the author, not the channel title', () => {
  // The namespace trap: dc:creator and title both exist. If the parser were
  // namespace-blind or regex-based it would grab the wrong one.
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  assert.equal(normalizeItem(items[0], SOURCE, RESOLVED).author, 'Jane Reporter');
});

test('reads the image from the enclosure url ATTRIBUTE', () => {
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  const article = normalizeItem(items[0], SOURCE, RESOLVED);
  assert.ok(article.image, 'image must be present');
  assert.equal(article.image, 'https://cdn.example.test/images/gas-station_1024x683.jpeg');
});

test('a PODCAST enclosure is not an image, and must not become one', () => {
  // The bug a reader reported. A Substack item encloses its audio exactly the
  // way it encloses a photo, so `<enclosure>` alone cannot mean "image". Taking
  // its url on sight put an .mp3 into article.image and shipped a broken image
  // icon on the home page for three posts.
  const podcast = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Podcast Press</title><link>https://pod.example</link>
<item>
  <title>An episode about something</title>
  <link>https://pod.example/p/an-episode</link>
  <guid isPermaLink="true">https://pod.example/p/an-episode</guid>
  <pubDate>Sun, 05 Oct 2026 10:03:33 GMT</pubDate>
  <enclosure url="https://api.substack.com/feed/podcast/218377170/abc123.mp3"
             type="audio/mpeg" length="12345"/>
</item></channel></rss>`;

  const { ok, items } = parseFeed(podcast);
  assert.equal(ok, true, 'a podcast feed must still parse cleanly');
  assert.ok(items.length > 0, 'positive control');
  assert.equal(
    normalizeItem(items[0], SOURCE, RESOLVED).image,
    null,
    'an audio enclosure must yield a null image, never an mp3 url'
  );
});

test('an image enclosure is accepted whether or not it declares a type', () => {
  // Both halves matter. Many real feeds omit @_type entirely, so a rule that
  // only trusted @_type would reject every image from those feeds.
  const withType = `<rss version="2.0"><channel><title>T</title><link>https://x.test</link>
    <item><title>i</title><link>https://x.test/p/1</link>
    <guid isPermaLink="true">https://x.test/p/1</guid><pubDate>Sun, 05 Oct 2026 10:03:33 GMT</pubDate>
    <enclosure url="https://cdn.x.test/a_1024x683.jpeg" type="image/jpeg" length="1"/>
    </item></channel></rss>`;
  const withoutType = withType.replace(' type="image/jpeg"', '');

  for (const [label, xml] of [['with type', withType], ['no type', withoutType]]) {
    const { ok, items } = parseFeed(xml);
    assert.equal(ok, true, `${label}: must parse`);
    assert.equal(
      normalizeItem(items[0], SOURCE, RESOLVED).image,
      'https://cdn.x.test/a_1024x683.jpeg',
      `${label}: an image enclosure must be kept`
    );
  }
});

test('an audio enclosure does not stop a real image being found', () => {
  // The fall-through case. A podcast post can carry BOTH an audio enclosure and
  // a media:content image, so returning early on the audio would lose the image.
  const both = `<rss version="2.0"><channel><title>T</title><link>https://x.test</link>
    <item><title>i</title><link>https://x.test/p/2</link>
    <guid isPermaLink="true">https://x.test/p/2</guid><pubDate>Sun, 05 Oct 2026 10:03:33 GMT</pubDate>
    <enclosure url="https://api.substack.com/feed/podcast/1/b.mp3" type="audio/mpeg" length="1"/>
    <media:content url="https://cdn.x.test/cover_1024x683.jpeg" type="image/jpeg"/>
    </item></channel></rss>`;

  const { ok, items } = parseFeed(both);
  assert.equal(ok, true);
  assert.equal(
    normalizeItem(items[0], SOURCE, RESOLVED).image,
    'https://cdn.x.test/cover_1024x683.jpeg',
    'the image must win over the audio enclosure'
  );
});

test('POSITIVE CONTROL: an audio enclosure IS still parseable and not dropped', () => {
  // The rejection above must reject the IMAGE, never the ITEM. A parser that
  // discarded podcast posts entirely would pass the test above while silently
  // removing content from the site, which is the same class of error as the one
  // being fixed.
  const podcast = `<rss version="2.0"><channel><title>T</title><link>https://x.test</link>
    <item><title>Keep me</title><link>https://x.test/p/3</link>
    <guid isPermaLink="true">https://x.test/p/3</guid><pubDate>Sun, 05 Oct 2026 10:03:33 GMT</pubDate>
    <enclosure url="https://api.substack.com/feed/podcast/1/c.mp3" type="audio/mpeg" length="1"/>
    </item></channel></rss>`;

  const { ok, items } = parseFeed(podcast);
  assert.equal(ok, true);
  const article = normalizeItem(items[0], SOURCE, RESOLVED);
  assert.equal(article.title, 'Keep me', 'the item itself must survive');
  assert.ok(article.url, 'and keep its link');
  assert.equal(article.image, null);
});

test('guid is an object because of isPermaLink, and still yields the link', () => {
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  assert.equal(typeof items[0].guid, 'object', 'guid should be an object, not a string');
  assert.equal(items[0].guid['#text'], 'https://examplepress.test/p/gas-station-problem');
  assert.equal(normalizeItem(items[0], SOURCE, RESOLVED).url, 'https://examplepress.test/p/gas-station-problem');
});

test('decodes entities in the title', () => {
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  // &amp; in the CDATA title must arrive as a single ampersand.
  assert.equal(normalizeItem(items[0], SOURCE, RESOLVED).title, 'The gas station problem & what it means');
});

test('publishedAt is a UTC ISO string, independent of machine timezone', () => {
  // Design rule 8. The feed carries GMT, and the output must be Z-suffixed.
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  const iso = normalizeItem(items[0], SOURCE, RESOLVED).publishedAt;
  assert.ok(iso, 'publishedAt must be present');
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(iso, '2026-10-05T10:03:33.000Z');
});

test('toIsoUtc rejects garbage instead of producing Invalid Date', () => {
  assert.equal(toIsoUtc('not a date at all'), null);
  assert.equal(toIsoUtc(null), null);
  assert.equal(toIsoUtc(undefined), null);
  // No timezone given: treated as UTC, not local. This is the rule that keeps
  // a build on the Pages runner byte-identical to a build on the dev machine.
  assert.equal(toIsoUtc('2026-10-05 10:03:33'), '2026-10-05T10:03:33.000Z');
});

test('excerpt comes from description when usable', () => {
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  const article = normalizeItem(items[0], SOURCE, RESOLVED);
  assert.ok(article.excerpt, 'excerpt must be present');
  assert.ok(article.excerpt.length <= 303, `excerpt must be capped, got ${article.excerpt.length}`);
  assert.equal(article.excerpt, 'The ' + String.fromCharCode(0x2018) + 'corner store' + String.fromCharCode(0x2019) + ' economy ' + String.fromCharCode(0x2014) + ' and what it means for towns.');
});

test('dek is null when the feed has no per-item subtitle', () => {
  // Do not invent a dek, and do not fall back to the channel tagline.
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  assert.equal(normalizeItem(items[0], SOURCE, RESOLVED).dek, null);
});

test('excerpt falls back to content:encoded with tags stripped', () => {
  // A feed whose items have no description at all must still produce an
  // excerpt, or cards render blank.
  const { ok, items } = parseFeed(ONE_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  const article = normalizeItem(items[0], { id: 'solo', name: 'Solo Weekly' }, 'https://solo.test/feed');
  assert.ok(article.excerpt && article.excerpt.length > 0, 'excerpt must fall back to content:encoded');
  assert.ok(!article.excerpt.includes('<'), 'tags must be stripped from the excerpt');
});

test('script and style contents are removed from derived text', () => {
  // The fixture body carries a <style> block. Its CSS must not appear.
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  const noDescription = { ...items[0], description: undefined };
  const article = normalizeItem(noDescription, SOURCE, RESOLVED);
  assert.ok(article.excerpt && article.excerpt.length > 0, 'positive control');
  assert.ok(!/display:none/.test(article.excerpt), 'style contents must be dropped');
});

test('categories are collected and de-duplicated', () => {
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  const categories = normalizeItem(items[0], SOURCE, RESOLVED).categories;
  assert.ok(Array.isArray(categories));
  assert.deepEqual(categories, ['economy', 'cities']);
});

test('id is a stable slug derived from the guid', () => {
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  assert.ok(items.length > 0, 'positive control');
  const first = normalizeItem(items[0], SOURCE, RESOLVED);
  // Stability across runs is the whole point: dedupe depends on it.
  assert.equal(first.id, slugify('https://examplepress.test/p/gas-station-problem'));
  assert.equal(first.id, normalizeItem(items[0], SOURCE, RESOLVED).id);
  assert.match(first.id, /^[a-z0-9-]+$/, 'id must be slug-safe');
});

test('normalizeItem tolerates an item with nothing but a title', () => {
  const article = normalizeItem({ title: 'Bare minimum' }, SOURCE, RESOLVED);
  assert.equal(article.title, 'Bare minimum');
  assert.equal(article.author, null);
  assert.equal(article.image, null);
  assert.equal(article.publishedAt, null);
  assert.deepEqual(article.categories, []);
  assert.ok(article.id, 'an id must still be produced');
});

test('sourceId and sourceName are stamped onto every article', () => {
  const { ok, items } = parseFeed(TWO_ITEM_XML);
  assert.equal(ok, true);
  for (const item of items) {
    const article = normalizeItem(item, SOURCE, RESOLVED);
    assert.equal(article.sourceId, 'examplepress');
    assert.equal(article.sourceName, 'The Example Press');
  }
});
