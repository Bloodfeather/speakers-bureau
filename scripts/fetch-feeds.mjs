#!/usr/bin/env node
// scripts/fetch-feeds.mjs - the orchestrator and the ONLY entry point that
// knows where the dataset lives.
//
// READ -> FETCH -> VALIDATE -> NORMALIZE -> DEDUPE -> SORT -> WRITE ATOMICALLY
//
// FAIL LOUD BY DEFAULT (design rule 3). If any feed fails, this exits non-zero
// and no dataset is written. A green build on stale data is the one failure
// mode that looks like success, so `--allow-partial` must be passed explicitly
// to write a partial dataset. The scheduled Action does NOT pass it.
//
// THE OUTPUT PATH IS A PARAMETER, and the production default is set here and
// nowhere else. This is load-bearing, not tidiness: it is the only way rule 7
// ("never point a test or probe at the real dataset") and rule 3 can both hold.
// The pipeline functions below take `outPath` as an argument and have no
// default, so a test physically cannot write to data/articles.json by omission.
// `npm run fetch` passes the production default; `node scripts/fetch-feeds.mjs
// --out <tmp>` passes anything else.

import { writeFile, rename, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { get } from './lib/http.mjs';
import { validateFeedXml, checkContentType } from './lib/validate.mjs';
import { parseFeed, normalizeItem } from './lib/rss.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');

// PRODUCTION DEFAULTS. Defined here, at the entry point, and not in the
// pipeline. This is the single place the real dataset path appears.
const DEFAULT_SOURCES_PATH = resolve(PROJECT_ROOT, 'data', 'sources.yml');
const DEFAULT_OUT_PATH = resolve(PROJECT_ROOT, 'data', 'articles.json');

/**
 * Parse argv.
 *
 * @param {string[]} argv
 * @returns {{out:string, sources:string, allowPartial:boolean, help:boolean}}
 */
export function parseArgs(argv) {
  const opts = {
    out: null,
    sources: null,
    allowPartial: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') {
      opts.out = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--out=')) {
      opts.out = arg.slice('--out='.length);
    } else if (arg === '--sources' || arg === '-s') {
      opts.sources = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--sources=')) {
      opts.sources = arg.slice('--sources='.length);
    } else if (arg === '--allow-partial') {
      opts.allowPartial = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`unknown argument "${arg}". Try --help.`);
    }
  }

  return opts;
}

// A topic tag is a short human-typed word, not a sentence. A longer value is
// rejected rather than truncated, because a truncated tag is a DIFFERENT topic
// that looks right in the YAML and wrong on the site - and a silently wrong
// browse taxonomy is worse than a failed fetch (design rule 3, applied to the
// editor's own file rather than to a feed).
const MAX_TAG_LENGTH = 40;

/**
 * Normalize one `tag:` value from sources.yml.
 *
 * Lowercased on purpose: tags become filter URLs and `data-*` values, and two
 * spellings of one topic would split it into two dead-end filters. Trimmed, and
 * a number is coerced (YAML reads a bare `2026` as a number, not a string,
 * which would otherwise be silently discarded as "not a string").
 *
 * @param {unknown} raw
 * @returns {string|null} normalized tag, or null when absent/blank
 * @throws {Error} when the tag is a non-empty scalar longer than MAX_TAG_LENGTH
 */
function normalizeTag(raw) {
  if (raw === null || raw === undefined || typeof raw === 'boolean') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;

  const tag = String(raw).trim().toLowerCase();
  if (tag === '') return null;
  if (tag.length > MAX_TAG_LENGTH) {
    throw new Error(
      `tag "${tag}" is ${tag.length} characters; a topic tag must be ${MAX_TAG_LENGTH} or fewer. ` +
        'Use a short word such as "news" or "economics", not a phrase.'
    );
  }
  return tag;
}

/**
 * Load and normalize the source list.
 * @returns {Promise<Array<{id:string,name:string,feedUrl:string,tag:?string,enabled:boolean}>>}
 */
export async function loadSources(sourcesPath) {
  const raw = await readFile(sourcesPath, 'utf8');
  const doc = parseYaml(raw);
  const list = Array.isArray(doc?.sources) ? doc.sources : [];

  const sources = [];
  const seenIds = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const feedUrl = typeof entry.feedUrl === 'string' ? entry.feedUrl.trim() : '';

    if (id === '' || name === '' || feedUrl === '') {
      throw new Error(
        `every source needs id, name and feedUrl. Offending entry: ${JSON.stringify(entry)}`
      );
    }
    if (seenIds.has(id)) {
      throw new Error(`duplicate source id "${id}" in ${sourcesPath}. Ids must be unique.`);
    }
    seenIds.add(id);

    sources.push({
      id,
      name,
      feedUrl,
      tag: normalizeTag(entry.tag),
      enabled: entry.enabled === false ? false : true
    });
  }

  return sources;
}

/**
 * Merge a source's manual topic tag into one normalized article.
 *
 * WHY HERE AND NOT IN rss.mjs. The tag belongs to the SOURCE, not to the
 * publication's feed: two people writing for the same publication can disagree
 * about its topic, and the editor changes the topic in sources.yml without the
 * feed changing at all. So the knowledge that "this source is about X" lives in
 * the orchestrator, at the one seam that already knows which source an item came
 * from. `normalizeItem()` stays publication-agnostic and knows nothing about our
 * taxonomy - which is what keeps it testable against arbitrary RSS.
 *
 * MERGE, NOT OVERWRITE. Feed-provided `<category>` elements are the author's own
 * words; a configured tag is ours. Neither replaces the other, so a post that
 * carries both keeps both and the UI can label a card with either.
 *
 * Order: the configured tag leads, because it is the curated browsing axis
 * (ROADMAP, "Topic browsing"), and the feed's own categories follow in the order
 * the feed listed them. Dedup is case-insensitive so `News` from a feed and
 * `news` from sources.yml do not appear as two identical chips.
 *
 * @param {{categories:string[]}} article normalized article
 * @param {string|null|undefined} tag   the source's manual topic tag
 * @returns {object} the article, or the SAME object when there is nothing to do
 */
export function mergeSourceTag(article, tag) {
  if (typeof tag !== 'string' || tag === '') return article;

  const existing = Array.isArray(article.categories) ? article.categories : [];
  const seen = new Set();
  const categories = [];

  for (const candidate of [tag, ...existing]) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (value === '') continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(value);
  }

  return { ...article, categories };
}

/**
 * Fetch, validate, parse and normalize a single source.
 *
 * Never throws. Every failure path returns a result with `ok:false` and a
 * reason, so one dead feed cannot abort the other nineteen.
 *
 * @param {{id:string,name:string,feedUrl:string,tag?:string|null}} source
 * @param {{fetchImpl?:Function, timeoutMs?:number, retries?:number}} [io]
 * @returns {Promise<object>}
 */
export async function collectSource(source, io = {}) {
  const base = {
    id: source.id,
    name: source.name,
    tag: typeof source.tag === 'string' && source.tag !== '' ? source.tag : null,
    configuredUrl: source.feedUrl,
    resolvedUrl: null,
    status: null,
    itemCount: 0,
    newItemCount: 0,
    error: null,
    articles: []
  };

  let response;
  try {
    response = await get(source.feedUrl, {
      fetchImpl: io.fetchImpl,
      timeoutMs: io.timeoutMs,
      retries: io.retries
    });
  } catch (err) {
    // get() is contracted not to throw for expected failures. If it did, that
    // is a bug worth surfacing as this source's failure rather than a crash
    // that loses the other feeds' work.
    return { ...base, status: 0, error: `fetch threw unexpectedly: ${err.message}` };
  }

  if (!response.ok) {
    return { ...base, status: response.status, resolvedUrl: response.finalUrl, error: response.error };
  }

  base.status = response.status;
  // Design rule 4: the RESOLVED url is canonical, not the configured one.
  base.resolvedUrl = response.finalUrl;

  // ORDER MATTERS. Assertion 1 (content-type) is checked BEFORE parsing,
  // because a body claiming to be text/html is already a diagnosis in itself.
  // Running parseFeed first would report the downstream symptom instead
  // ("document root was not rss"), which sends an operator hunting through the
  // XML when the real answer is one HTTP header away.
  const contentTypeVerdict = checkContentType(response.contentType);
  if (!contentTypeVerdict.ok) {
    return { ...base, error: contentTypeVerdict.detail };
  }

  const parsed = parseFeed(response.body);
  if (!parsed.ok) {
    return { ...base, error: parsed.error };
  }
  base.itemCount = parsed.items.length;

  // Now the full three-assertion rule. Assertion 3 has real items to count,
  // and assertion 2 is re-run cheaply (XMLValidator on an already-parsed
  // body) to confirm the document is a feed and not merely parseable.
  const verdict = validateFeedXml({
    contentType: response.contentType,
    body: response.body,
    items: parsed.items
  });
  if (!verdict.ok) {
    return { ...base, error: verdict.detail };
  }

  const articles = parsed.items
    .map((item) => normalizeItem(item, { id: source.id, name: source.name }, response.finalUrl))
    // The source's manual topic tag is applied HERE, at the orchestrator seam,
    // so rss.mjs never has to know that our taxonomy exists.
    .map((article) => mergeSourceTag(article, base.tag))
    .filter((article) => article.publishedAt !== null || article.url !== null);

  return { ...base, articles };
}

/**
 * Dedupe by `id`, keeping the first occurrence, and sort newest first.
 *
 * The same article syndicated into two feeds collapses to one. First-wins
 * because sources.yml order is the editor's stated preference.
 *
 * @param {object[]} articles
 * @returns {{articles:object[], duplicateCount:number}}
 */
export function dedupeAndSort(articles) {
  const byId = new Map();
  let duplicateCount = 0;

  for (const article of articles) {
    if (byId.has(article.id)) {
      duplicateCount += 1;
      continue;
    }
    byId.set(article.id, article);
  }

  const sorted = [...byId.values()].sort((a, b) => {
    // Articles with no usable date sort last rather than poisoning the order.
    const at = a.publishedAt ?? '';
    const bt = b.publishedAt ?? '';
    if (at === bt) return a.id.localeCompare(b.id);
    if (at === '') return 1;
    if (bt === '') return -1;
    // ISO 8601 UTC strings compare lexicographically in chronological order,
    // which is why design rule 8 makes this safe without a Date parse.
    return bt.localeCompare(at);
  });

  return { articles: sorted, duplicateCount };
}

/**
 * Write the dataset atomically: temp file in the SAME directory, then rename.
 *
 * Same directory matters - rename is only atomic within a filesystem, and a
 * temp file in the OS temp dir could land on a different volume where the
 * "atomic" rename degrades to a copy that a crash can interrupt mid-write.
 *
 * @param {string} outPath
 * @param {object} payload
 * @returns {Promise<void>}
 */
export async function writeJsonAtomic(outPath, payload) {
  const target = resolve(outPath);
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });

  // Named per-pid so two concurrent runs cannot collide on the temp file.
  const tmpPath = `${target}.${process.pid}.tmp`;
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    await writeFile(tmpPath, json, 'utf8');
    await rename(tmpPath, target);
  } catch (err) {
    // Never leave the temp file behind to be mistaken for the dataset.
    try {
      await rename(tmpPath, tmpPath + '.orphan');
    } catch {
      /* best effort */
    }
    throw err;
  }
}

/**
 * Build the report rows and print them.
 * Design rule 6: every run records what it actually did.
 */
function printReport(sourceResults, { outPath, wrote }) {
  const lines = [];
  lines.push('');
  lines.push('='.repeat(72));
  lines.push('SpeakersBureau feed fetch report');
  lines.push('='.repeat(72));

  for (const result of sourceResults) {
    if (result.error) {
      lines.push(`[FAIL] ${result.id} (${result.name})`);
      lines.push(`       configured: ${result.configuredUrl}`);
      lines.push(`       resolved:   ${result.resolvedUrl ?? '(never resolved)'}`);
      lines.push(`       reason:     ${result.error}`);
    } else {
      lines.push(`[ OK ] ${result.id} (${result.name})`);
      lines.push(`       configured: ${result.configuredUrl}`);
      lines.push(`       resolved:   ${result.resolvedUrl}`);
      lines.push(`       http:       ${result.status}  items: ${result.itemCount}  new: ${result.newItemCount}`);
      // Design rule 6: what the run actually did includes which topic it
      // stamped. A tag that silently stopped applying would otherwise look
      // identical to a tag that was never configured.
      lines.push(`       tag:        ${result.tag ?? '(none)'}`);
    }
  }

  const failed = sourceResults.filter((r) => r.error).length;
  const totalItems = sourceResults.reduce((sum, r) => sum + r.itemCount, 0);
  lines.push('-'.repeat(72));
  lines.push(
    `sources: ${sourceResults.length}  ok: ${sourceResults.length - failed}  failed: ${failed}`
  );
  lines.push(`items seen: ${totalItems}`);
  lines.push(wrote ? `wrote: ${outPath}` : `NOT WRITTEN: ${outPath} (see failure reason above)`);
  lines.push('='.repeat(72));
  lines.push('');

  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }

  if (opts.help) {
    process.stdout.write(
      [
        'Usage: node scripts/fetch-feeds.mjs [options]',
        '',
        '  --out <path>        write the dataset to <path> instead of data/articles.json',
        '  --sources <path>    read the feed list from <path> instead of data/sources.yml',
        '  --allow-partial     write the dataset even if some feeds failed (default: do not)',
        '  -h, --help          show this help',
        '',
        'Exit codes: 0 all feeds ok, 1 one or more feeds failed, 2 bad arguments.',
        ''
      ].join('\n')
    );
    return 0;
  }

  // The production default lives HERE and only here.
  const outPath = resolve(opts.out ?? DEFAULT_OUT_PATH);
  const sourcesPath = resolve(opts.sources ?? DEFAULT_SOURCES_PATH);

  if (!existsSync(sourcesPath)) {
    process.stderr.write(`sources file not found: ${sourcesPath}\n`);
    return 2;
  }

  let sources;
  try {
    sources = await loadSources(sourcesPath);
  } catch (err) {
    process.stderr.write(`could not read ${sourcesPath}: ${err.message}\n`);
    return 2;
  }

  if (sources.length === 0) {
    process.stderr.write(`no sources defined in ${sourcesPath}\n`);
    return 2;
  }

  const enabled = sources.filter((s) => s.enabled);
  if (enabled.length !== sources.length) {
    process.stdout.write(
      `skipping ${sources.length - enabled.length} disabled source(s): ` +
        `${sources.filter((s) => !s.enabled).map((s) => s.id).join(', ')}\n`
    );
  }

  const results = [];
  for (const source of enabled) {
    // NO `io` ARGUMENT, AND THAT IS LOAD-BEARING.
    //
    // This line used to read `{ fetchImpl: globalThis.fetch }`. That explicitly
    // injected the network fetch, and http.mjs gives an injected fetchImpl
    // priority over its own default - correctly, because that is what makes the
    // test suite injectable. The consequence was that the feed-egress Worker was
    // never used by the real fetcher at all: every request went straight out over
    // the runner's own network, and every feed still answered 403.
    //
    // It looked fine locally, which is what made it dangerous. From a residential
    // IP the direct path returns 200, so a local run could not tell the two paths
    // apart - a local "end to end" check of this change reported 4 sources and 49
    // items and demonstrated nothing whatsoever. The symptom only appeared on the
    // runner, as the same 403 this whole change exists to remove.
    //
    // Passing nothing lets http.mjs decide: the egress relay when FEED_EGRESS_URL
    // is set, the network otherwise. One place knows about the transport, and
    // that place is the transport's own module.
    const result = await collectSource(source);
    results.push(result);
    const mark = result.error ? 'FAIL' : `OK ${result.itemCount} items`;
    process.stdout.write(`fetched ${source.id}: ${mark}\n`);
  }

  const okResults = results.filter((r) => !r.error);
  const allArticles = okResults.flatMap((r) => r.articles);

  // Dedupe globally, then attribute each kept article back to the source that
  // first supplied it, so per-source `newItemCount` reflects the kept set.
  const { articles, duplicateCount } = dedupeAndSort(allArticles);
  const keptIds = new Set(articles.map((a) => a.id));
  const countedIds = new Set();
  for (const result of okResults) {
    let count = 0;
    for (const article of result.articles) {
      if (keptIds.has(article.id) && !countedIds.has(article.id)) {
        countedIds.add(article.id);
        count += 1;
      }
    }
    result.newItemCount = count;
  }

  const failures = results.filter((r) => r.error);

  if (failures.length > 0 && !opts.allowPartial) {
    // FAIL LOUD. No dataset is written. Yesterday's committed file stays
    // exactly as it is - untouched, which is what a failed scheduled run
    // should leave behind.
    for (const result of results) printReportLine(result);
    printReport(results, { outPath, wrote: false });
    process.stderr.write(
      `\n${failures.length} feed(s) failed and --allow-partial was not passed.\n` +
        'The dataset was NOT written. Existing articles.json left unchanged.\n'
    );
    return 1;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    articleCount: articles.length,
    sourceCount: okResults.length,
    duplicateCount,
    sources: results.map((r) => ({
      id: r.id,
      name: r.name,
      // The site builds its topic filter from these, so the dataset has to
      // carry the taxonomy even when an article lost its categories to dedupe.
      tag: r.tag,
      status: r.error ? 'error' : 'ok',
      httpStatus: r.status,
      configuredUrl: r.configuredUrl,
      resolvedUrl: r.resolvedUrl,
      itemCount: r.itemCount,
      newItemCount: r.error ? 0 : r.newItemCount,
      error: r.error
    })),
    articles
  };

  await writeJsonAtomic(outPath, payload);
  printReport(results, { outPath, wrote: true });
  return 0;
}

function printReportLine(result) {
  if (result.error) {
    process.stderr.write(`[FAIL] ${result.id}: ${result.error}\n`);
  }
}

// Only run when executed directly, so tests can import the exports above.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`fatal: ${err && err.stack ? err.stack : err}\n`);
      process.exitCode = 1;
    });
}
