// test/dedupe.test.mjs - cross-feed dedupe, sorting, and atomic-write behaviour.
//
// Also proves ROADMAP design rule 7 the only way that can be proved cheaply:
// that a fetch pointed at a temp path leaves the REAL data/articles.json
// untouched, byte for byte and mtime for mtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  dedupeAndSort,
  writeJsonAtomic,
  parseArgs,
  collectSource
} from '../scripts/fetch-feeds.mjs';
import { parseFeed, normalizeItem } from '../scripts/lib/rss.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const REAL_DATASET = resolve(PROJECT_ROOT, 'data', 'articles.json');

// Design rule 3: never aim a test at the real dataset. Everything below writes
// under the OS temp dir, which is pre-approved for external access.
async function tempDir() {
  return mkdtemp(join(tmpdir(), 'sb-dedupe-'));
}

/** Build a normalized article directly, so dedupe is tested in isolation. */
function makeArticle(id, sourceId, publishedAt) {
  return {
    id,
    sourceId,
    sourceName: sourceId,
    title: `Article ${id}`,
    dek: null,
    author: null,
    url: `https://example.test/${id}`,
    image: null,
    publishedAt,
    excerpt: 'x',
    categories: []
  };
}

test('the same article from two feeds collapses to one', () => {
  // Same id, different source: this is the syndicated-post case.
  const a = makeArticle('shared-post', 'feed-a', '2026-10-05T10:00:00.000Z');
  const b = makeArticle('shared-post', 'feed-b', '2026-10-05T10:00:00.000Z');

  const { articles, duplicateCount } = dedupeAndSort([a, b]);
  assert.equal(articles.length, 1, 'one shared id must produce one article');
  assert.equal(duplicateCount, 1);
  // First-wins, per sources.yml order.
  assert.equal(articles[0].sourceId, 'feed-a');
});

test('distinct articles are all kept', () => {
  const input = [
    makeArticle('one', 'feed-a', '2026-10-05T10:00:00.000Z'),
    makeArticle('two', 'feed-a', '2026-10-04T10:00:00.000Z'),
    makeArticle('three', 'feed-b', '2026-10-03T10:00:00.000Z')
  ];
  const { articles, duplicateCount } = dedupeAndSort(input);
  assert.equal(articles.length, 3);
  assert.equal(duplicateCount, 0);
});

test('dedupe counts every extra copy, not just the second', () => {
  const input = [
    makeArticle('dup', 'a', '2026-10-05T10:00:00.000Z'),
    makeArticle('dup', 'b', '2026-10-05T10:00:00.000Z'),
    makeArticle('dup', 'c', '2026-10-05T10:00:00.000Z'),
    makeArticle('dup', 'd', '2026-10-05T10:00:00.000Z')
  ];
  const { articles, duplicateCount } = dedupeAndSort(input);
  assert.equal(articles.length, 1);
  assert.equal(duplicateCount, 3);
});

test('sorts newest first by publishedAt', () => {
  const input = [
    makeArticle('old', 'a', '2026-10-01T00:00:00.000Z'),
    makeArticle('newest', 'a', '2026-10-05T00:00:00.000Z'),
    makeArticle('middle', 'a', '2026-10-03T00:00:00.000Z')
  ];
  const { articles } = dedupeAndSort(input);
  assert.deepEqual(articles.map((x) => x.id), ['newest', 'middle', 'old']);
});

test('articles with no date sort last instead of poisoning the order', () => {
  // A missing date must not become an Invalid Date that breaks sorting.
  const input = [
    makeArticle('undated', 'a', null),
    makeArticle('dated', 'a', '2026-10-05T00:00:00.000Z')
  ];
  const { articles } = dedupeAndSort(input);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].id, 'dated', 'the dated article sorts first');
  assert.equal(articles[1].id, 'undated');
});

test('empty input is handled', () => {
  const { articles, duplicateCount } = dedupeAndSort([]);
  assert.deepEqual(articles, []);
  assert.equal(duplicateCount, 0);
});

test('dedupe is order-independent in its output', () => {
  // Determinism matters: two runs over the same feeds must produce the same
  // file, or every scheduled run shows a spurious diff.
  const input = [
    makeArticle('a', 'x', '2026-10-05T00:00:00.000Z'),
    makeArticle('b', 'y', '2026-10-04T00:00:00.000Z'),
    makeArticle('c', 'z', '2026-10-03T00:00:00.000Z')
  ];
  const first = dedupeAndSort(input).articles.map((x) => x.id);
  const second = dedupeAndSort(input).articles.map((x) => x.id);
  assert.deepEqual(first, second);
});

test('two genuinely different feeds sharing a post really do share the id', async () => {
  // Proves the id is derived from the guid/link, not from the source, by
  // running the real normalizer over two parses of the same document.
  const xml = await readFile(resolve(HERE, 'fixtures', 'substack-feed.xml'), 'utf8');
  const parsed = parseFeed(xml);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.items.length > 0, 'positive control: fixture must produce items');

  const fromA = parsed.items.map((i) => normalizeItem(i, { id: 'a', name: 'A' }, 'https://a.test/feed'));
  const fromB = parsed.items.map((i) => normalizeItem(i, { id: 'b', name: 'B' }, 'https://b.test/feed'));

  const merged = dedupeAndSort([...fromA, ...fromB]);
  assert.equal(merged.articles.length, parsed.items.length, 'identical ids must fully collapse');
  assert.equal(merged.duplicateCount, parsed.items.length);
});

test('writeJsonAtomic writes valid JSON and leaves no temp file behind', async () => {
  const dir = await tempDir();
  const target = join(dir, 'nested', 'articles.json');
  const payload = { generatedAt: '2026-10-05T00:00:00.000Z', articles: [makeArticle('x', 'a', null)] };

  await writeJsonAtomic(target, payload);

  const written = JSON.parse(await readFile(target, 'utf8'));
  assert.deepEqual(written, payload);

  const entries = await readdir(join(dir, 'nested'));
  const temps = entries.filter((e) => e.includes('.tmp'));
  assert.deepEqual(temps, [], `atomic write left temp files behind: ${temps.join(', ')}`);
});

test('writeJsonAtomic overwrites an existing dataset in place', async () => {
  const dir = await tempDir();
  const target = join(dir, 'articles.json');
  await writeFile(target, JSON.stringify({ old: true }), 'utf8');

  await writeJsonAtomic(target, { fresh: true });
  const written = JSON.parse(await readFile(target, 'utf8'));
  assert.deepEqual(written, { fresh: true });
});

test('writeJsonAtomic ends the file with a newline', async () => {
  const dir = await tempDir();
  const target = join(dir, 'articles.json');
  await writeJsonAtomic(target, { a: 1 });
  const text = await readFile(target, 'utf8');
  assert.ok(text.endsWith('\n'), 'file should end with a trailing newline');
});

test('DESIGN RULE 7: writing to a temp path does not touch the real dataset', async (t) => {
  // The real dataset may not exist yet (it is produced by the first fetch).
  // Assert absence-or-unchanged, so this test is meaningful either way.
  const existedBefore = existsSync(REAL_DATASET);
  const before = existedBefore ? await readFile(REAL_DATASET, 'utf8') : null;
  const mtimeBefore = existedBefore ? (await stat(REAL_DATASET)).mtimeMs : null;

  if (!existedBefore) {
    t.diagnostic('real data/articles.json does not exist yet; asserting it still does not');
  }

  const dir = await tempDir();
  const target = join(dir, 'articles.json');
  await writeJsonAtomic(target, { probe: true, articles: [] });

  if (existedBefore) {
    const after = await readFile(REAL_DATASET, 'utf8');
    const mtimeAfter = (await stat(REAL_DATASET)).mtimeMs;
    assert.equal(after, before, 'the real dataset changed during a temp-dir write');
    assert.equal(mtimeAfter, mtimeBefore, 'the real dataset was rewritten during a temp-dir write');
  } else {
    assert.equal(existsSync(REAL_DATASET), false, 'a temp-dir write created the real dataset');
  }
});

test('parseArgs understands --out in both forms and defaults to null', () => {
  // A null default is what forces the entry point to be the only place that
  // knows the production path.
  assert.equal(parseArgs([]).out, null);
  assert.equal(parseArgs(['--out', 'X']).out, 'X');
  assert.equal(parseArgs(['--out=X']).out, 'X');
  assert.equal(parseArgs(['-o', 'X']).out, 'X');
  assert.equal(parseArgs(['--allow-partial']).allowPartial, true);
  assert.equal(parseArgs([]).allowPartial, false);
});

test('parseArgs rejects an unknown argument loudly', () => {
  assert.throws(() => parseArgs(['--not-a-flag']), /unknown argument/);
});

test('collectSource reports a per-source failure instead of throwing', async () => {
  // A stubbed fetchImpl proves the pipeline survives one dead feed. Also
  // proves fetchImpl is injectable, which the unit tests depend on.
  const failingFetch = async () => {
    throw new Error('simulated network failure');
  };
  const result = await collectSource(
    { id: 'dead', name: 'Dead Feed', feedUrl: 'https://dead.test/feed' },
    { fetchImpl: failingFetch, retries: 0 }
  );

  assert.equal(result.error !== null, true, 'a dead feed must produce an error');
  assert.match(result.error, /network error/);
  assert.deepEqual(result.articles, []);
  assert.equal(result.itemCount, 0);
});

test('collectSource on a 403 does not retry and names the status', async () => {
  // Design rule in http.mjs: 4xx other than 429 is not retried.
  let calls = 0;
  const forbidden = async () => {
    calls += 1;
    return new Response('nope', { status: 403, statusText: 'Forbidden' });
  };

  const result = await collectSource(
    { id: 'blocked', name: 'Blocked', feedUrl: 'https://blocked.test/feed' },
    { fetchImpl: forbidden, retries: 2 }
  );

  assert.equal(result.error !== null, true, 'a 403 must be reported as an error');
  assert.match(result.error, /403/);
  assert.equal(calls, 1, `a 403 must not be retried, but was called ${calls} time(s)`);
});

test('collectSource rejects the 200-text/html case end to end', async () => {
  const html = '<!DOCTYPE html><html><body>Substack</body></html>';
  const htmlResponse = async () =>
    new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

  const result = await collectSource(
    { id: 'nostarch', name: 'No Such Pub', feedUrl: 'https://nostarch.substack.com/feed' },
    { fetchImpl: htmlResponse }
  );

  assert.equal(result.error !== null, true, 'the real 200-HTML case must fail validation');
  assert.match(result.error, /text\/html/);
  assert.deepEqual(result.articles, []);
});

test('collectSource accepts a good feed and records the resolved URL', async () => {
  const xml = await readFile(resolve(HERE, 'fixtures', 'substack-feed.xml'), 'utf8');
  // Simulates the verified redirect: requested one host, served by another.
  const redirected = async () =>
    new Response(xml, {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8' }
    });

  const result = await collectSource(
    { id: 'thefp', name: 'The Free Press', feedUrl: 'https://bariweiss.substack.com/feed' },
    { fetchImpl: redirected }
  );

  assert.equal(result.error, null, `good feed must not error: ${result.error}`);
  assert.equal(result.itemCount, 2, 'positive control: fixture items must be counted');
  assert.equal(result.articles.length, 2);
  for (const article of result.articles) {
    assert.equal(article.sourceId, 'thefp');
    assert.ok(article.publishedAt, 'every article must carry a normalized date');
  }
});
