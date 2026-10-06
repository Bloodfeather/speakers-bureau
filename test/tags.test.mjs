// test/tags.test.mjs - the manual topic tag from data/sources.yml reaching the
// articles' `categories`.
//
// BACKGROUND: `categories` is empty on every real article, because Substack RSS
// carries no useful <category> elements and `loadSources()` already parsed a
// `tag:` that then went nowhere. The client chose manual topic tags as the
// browsing mechanism (ROADMAP "Decisions taken"), so this is load-bearing, not
// cosmetic.
//
// WHERE THE FIX BELONGS. The tag is a property of the SOURCE, so it is applied
// in `collectSource()` (the orchestrator) and not in `scripts/lib/rss.mjs`,
// which stays publication-agnostic. A test below proves that separation: the
// parser alone still produces no tag, so nothing about "our taxonomy" has leaked
// into the generic layer.
//
// Design rule 7: nothing here reads or writes data/articles.json. Fixtures are
// read from test/fixtures and served through a stubbed fetchImpl.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectSource, loadSources, mergeSourceTag } from '../scripts/fetch-feeds.mjs';
import { parseFeed, normalizeItem } from '../scripts/lib/rss.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Serve a fixture file as a 200 application/xml response.
 *
 * Stubbed rather than live so these tests are deterministic and offline. What is
 * under test here is what happens to the tag afterwards, not the real HTTP path.
 */
async function serveFixture(fixtureName) {
  const xml = await readFile(resolve(HERE, 'fixtures', fixtureName), 'utf8');
  const fetchImpl = async () =>
    new Response(xml, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } });
  return fetchImpl;
}

/** Write a throwaway sources.yml under the OS temp dir and load it. */
async function loadSourcesFrom(text) {
  const dir = await mkdtemp(join(tmpdir(), 'sb-tags-'));
  const path = join(dir, 'sources.yml');
  await writeFile(path, text, 'utf8');
  return loadSources(path);
}

// ---------------------------------------------------------------------------
// loadSources: reading and normalizing the tag out of the YAML
// ---------------------------------------------------------------------------

test('loadSources reads, trims and lowercases the tag', async () => {
  const sources = await loadSourcesFrom(
    ['sources:', '  - id: a', '    name: A', '    feedUrl: https://a.test/feed', '    tag: "  News  "', ''].join('\n')
  );
  assert.equal(sources.length, 1);
  assert.equal(sources[0].tag, 'news', 'a tag must be one normalized slug, not "  News  "');
});

test('loadSources gives tag: null when the key is absent', async () => {
  const sources = await loadSourcesFrom(
    ['sources:', '  - id: a', '    name: A', '    feedUrl: https://a.test/feed', ''].join('\n')
  );
  assert.equal(sources.length, 1);
  assert.equal(sources[0].tag, null);
});

test('loadSources treats an empty tag as no tag rather than as ""', async () => {
  // "" would later become a filter chip with no label. Normalizing it to null
  // here is what keeps an untouched `tag:` line from producing one.
  const sources = await loadSourcesFrom(
    ['sources:', '  - id: a', '    name: A', '    feedUrl: https://a.test/feed', '    tag: "   "', ''].join('\n')
  );
  assert.equal(sources[0].tag, null);
});

test('loadSources coerces a numeric tag, which YAML parses as a number', async () => {
  // YAML reads a bare `tag: 2026` as a number, not a string. The old code kept
  // only `typeof === 'string'`, so a year tag vanished with no error at all.
  const sources = await loadSourcesFrom(
    ['sources:', '  - id: a', '    name: A', '    feedUrl: https://a.test/feed', '    tag: 2026', ''].join('\n')
  );
  assert.equal(sources[0].tag, '2026');
});

test('loadSources rejects an over-long tag loudly instead of truncating it', async () => {
  // Truncation would silently create a DIFFERENT topic that still looks right
  // in the YAML, so this fails the fetch (design rule 3, applied to our own
  // editor-facing file).
  const long = 'x'.repeat(41);
  await assert.rejects(
    loadSourcesFrom(
      ['sources:', '  - id: a', '    name: A', '    feedUrl: https://a.test/feed', `    tag: "${long}"`, ''].join('\n')
    ),
    /40 or fewer/
  );
});

// ---------------------------------------------------------------------------
// collectSource: the tag reaching the articles
// ---------------------------------------------------------------------------

test('a source with a tag produces articles that carry it', async () => {
  const result = await collectSource(
    { id: 'tagged', name: 'Tagged Press', feedUrl: 'https://tagged.test/feed', tag: 'civic-life' },
    { fetchImpl: await serveFixture('substack-feed.xml') }
  );

  // POSITIVE CONTROL, before any assertion about the tag: the fixture must
  // actually have produced articles. Without this, a test asserting "every
  // article carries civic-life" also passes on an empty array.
  assert.equal(result.error, null, `fixture fetch must succeed: ${result.error}`);
  assert.equal(result.itemCount, 2, 'positive control: the fixture must yield 2 items');
  assert.equal(result.articles.length, 2, 'positive control: both items must become articles');
  assert.ok(result.articles.length > 0, 'a zero-article fixture makes every assertion below vacuous');

  for (const article of result.articles) {
    assert.ok(
      article.categories.includes('civic-life'),
      `article ${article.id} must carry the source tag, got ${JSON.stringify(article.categories)}`
    );
  }
});

test('a source with NO tag produces empty categories rather than crashing', async () => {
  // Uses the single-item fixture, which has no <category> elements, so the only
  // possible source of a category is the tag. This is the negative case.
  const result = await collectSource(
    { id: 'untagged', name: 'Untagged Weekly', feedUrl: 'https://untagged.test/feed' },
    { fetchImpl: await serveFixture('single-item-feed.xml') }
  );

  // POSITIVE CONTROL FIRST. "categories is empty" is also what you get when the
  // fetch failed and no articles exist at all, so prove articles were produced
  // before asserting anything about their contents.
  assert.equal(result.error, null, `fixture fetch must succeed: ${result.error}`);
  assert.equal(result.itemCount, 1, 'positive control: the fixture must yield 1 item');
  assert.equal(result.articles.length, 1, 'positive control: 1 article must be produced');
  assert.ok(result.articles.length > 0, 'a zero-article fixture makes every assertion below vacuous');

  for (const article of result.articles) {
    assert.ok(Array.isArray(article.categories), 'categories must stay an array, never undefined');
    assert.deepEqual(article.categories, [], `untagged article ${article.id} must have no categories`);
  }
});

test('an explicitly null tag is treated as no tag, not as the string "null"', async () => {
  const result = await collectSource(
    { id: 'nul', name: 'Null Tag', feedUrl: 'https://nul.test/feed', tag: null },
    { fetchImpl: await serveFixture('single-item-feed.xml') }
  );
  assert.equal(result.error, null);
  assert.equal(result.articles.length, 1, 'positive control: the fixture must produce an article');
  assert.deepEqual(result.articles[0].categories, []);
});

test('feed categories and the source tag are MERGED, neither clobbering the other', async () => {
  // substack-feed.xml item 1 carries <category>economy</category> and
  // <category>cities</category>; the tag below is a third, distinct value.
  const result = await collectSource(
    { id: 'merged', name: 'Merged Press', feedUrl: 'https://merged.test/feed', tag: 'local-government' },
    { fetchImpl: await serveFixture('substack-feed.xml') }
  );

  assert.equal(result.error, null);
  assert.equal(result.articles.length, 2, 'positive control: the fixture must produce 2 articles');

  const first = result.articles.find((a) => (a.title || '').includes('gas station'));
  assert.ok(first, 'positive control: the item with two feed categories must exist');
  assert.deepEqual(
    [...first.categories].sort(),
    ['cities', 'economy', 'local-government'],
    'the tag and BOTH feed categories must survive'
  );

  // The second item carries only <category>infrastructure</category>; it must
  // gain the tag without losing its own.
  const second = result.articles.find((a) => (a.title || '').includes('bridge'));
  assert.ok(second, 'positive control: the second item must exist');
  assert.deepEqual(
    [...second.categories].sort(),
    ['infrastructure', 'local-government']
  );
});

test('the tag leads the categories array, feed categories keep their feed order', async () => {
  // The UI renders categories in array order and the tag is the curated
  // browsing axis, so it has to be first rather than appended after a variable
  // number of author-supplied terms.
  const result = await collectSource(
    { id: 'order', name: 'Order Press', feedUrl: 'https://order.test/feed', tag: 'local-government' },
    { fetchImpl: await serveFixture('substack-feed.xml') }
  );
  const first = result.articles.find((a) => (a.title || '').includes('gas station'));
  assert.deepEqual(first.categories, ['local-government', 'economy', 'cities']);
});

test('a tag equal to a feed category is stored once, not twice', async () => {
  const result = await collectSource(
    { id: 'dupe', name: 'Dupe Press', feedUrl: 'https://dupe.test/feed', tag: 'economy' },
    { fetchImpl: await serveFixture('substack-feed.xml') }
  );
  assert.equal(result.articles.length, 2, 'positive control: the fixture must produce 2 articles');
  const first = result.articles.find((a) => (a.title || '').includes('gas station'));
  const economies = first.categories.filter((c) => c.toLowerCase() === 'economy');
  assert.equal(economies.length, 1, `expected exactly one "economy" chip, got ${JSON.stringify(first.categories)}`);
});

test('the source tag does not appear when the tag differs only by case from a feed category', async () => {
  // `Economy` from a feed and `economy` from sources.yml are one topic. Two
  // chips differing only in case would be one unreachable duplicate filter.
  const result = await collectSource(
    { id: 'case', name: 'Case Press', feedUrl: 'https://case.test/feed', tag: 'economy' },
    { fetchImpl: await serveFixture('substack-feed.xml') }
  );
  const first = result.articles.find((a) => (a.title || '').includes('gas station'));
  assert.equal(first.categories.filter((c) => c.toLowerCase() === 'economy').length, 1);
});

test('each source keeps its own tag - tags are per source, not global', async () => {
  // Proves the tag is threaded through collectSource(source) rather than read
  // from some module-level constant.
  const [tagged, untagged] = await Promise.all([
    collectSource(
      { id: 'a', name: 'A', feedUrl: 'https://a.test/feed', tag: 'alpha' },
      { fetchImpl: await serveFixture('single-item-feed.xml') }
    ),
    collectSource(
      { id: 'b', name: 'B', feedUrl: 'https://b.test/feed' },
      { fetchImpl: await serveFixture('single-item-feed.xml') }
    )
  ]);

  assert.equal(tagged.articles.length, 1, 'positive control: source a produced an article');
  assert.equal(untagged.articles.length, 1, 'positive control: source b produced an article');
  assert.deepEqual(tagged.articles[0].categories, ['alpha']);
  assert.deepEqual(untagged.articles[0].categories, []);
});

test('collectSource reports the tag it stamped, so a silent regression is visible', async () => {
  // Design rule 6: a run records what it actually did. The tag is in the
  // per-source result and in the dataset's sources[] for the same reason.
  const withTag = await collectSource(
    { id: 'r', name: 'R', feedUrl: 'https://r.test/feed', tag: 'alpha' },
    { fetchImpl: await serveFixture('single-item-feed.xml') }
  );
  const withoutTag = await collectSource(
    { id: 'r', name: 'R', feedUrl: 'https://r.test/feed' },
    { fetchImpl: await serveFixture('single-item-feed.xml') }
  );
  assert.equal(withTag.tag, 'alpha');
  assert.equal(withoutTag.tag, null);
});

// ---------------------------------------------------------------------------
// Layer separation: the generic parser must stay publication-agnostic
// ---------------------------------------------------------------------------

test('the RSS parser alone knows nothing about source tags', async () => {
  // This is the test that keeps the seam honest. normalizeItem is handed the
  // source for its id and name and gains no topic, because the taxonomy is
  // applied by the orchestrator. If someone later "helpfully" adds the tag to
  // rss.mjs, this fails and they have to go and read why.
  const xml = await readFile(resolve(HERE, 'fixtures', 'substack-feed.xml'), 'utf8');
  const parsed = parseFeed(xml);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.items.length > 0, 'positive control: the fixture must yield items');

  const normalized = parsed.items.map((i) => normalizeItem(i, { id: 'a', name: 'A' }, 'https://a.test/feed'));
  assert.equal(normalized.length, parsed.items.length);
  for (const article of normalized) {
    assert.equal(
      article.categories.includes('anything-we-assigned'),
      false,
      'normalizeItem must not invent topics from the source'
    );
    assert.ok(
      article.categories.length > 0,
      'positive control: feed-supplied categories must be present without any tag help'
    );
  }
});

// ---------------------------------------------------------------------------
// mergeSourceTag in isolation
// ---------------------------------------------------------------------------

test('mergeSourceTag is a no-op for a null tag and returns the same object', () => {
  const article = { id: 'x', categories: ['one'] };
  assert.equal(mergeSourceTag(article, null), article);
  assert.equal(mergeSourceTag(article, ''), article);
  assert.equal(mergeSourceTag(article, undefined), article);
});

test('mergeSourceTag does not mutate its input', () => {
  const article = { id: 'x', categories: ['economy'] };
  mergeSourceTag(article, 'news');
  assert.deepEqual(article.categories, ['economy'], 'the input array must be untouched');
});

test('mergeSourceTag repairs a missing categories field instead of throwing', () => {
  // Defensive: an article whose `categories` is absent must still come back as
  // a valid shape. This is the "no tag does not crash" guarantee at the unit
  // level, and it is asserted positively (the array exists afterwards).
  const result = mergeSourceTag({ id: 'x' }, 'news');
  assert.deepEqual(result.categories, ['news']);
  assert.ok(Array.isArray(result.categories));
});

test('mergeSourceTag drops non-string junk rather than putting it in the dataset', () => {
  const result = mergeSourceTag({ id: 'x', categories: ['economy', 42, null, '  '] }, 'news');
  assert.deepEqual(result.categories, ['news', 'economy']);
});
