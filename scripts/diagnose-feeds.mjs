// scripts/diagnose-feeds.mjs
//
// WHY THIS EXISTS. `npm run fetch` reports a feed failure as "HTTP 403 for <url>"
// and stops. That is the right behaviour for a gate and useless for a diagnosis:
// a 403 from a WAF, a 403 from the origin application, and a 403 from a bot
// policy are three different problems with three different fixes, and the status
// code alone cannot tell them apart. The body and the response headers can.
//
// So this script asks the question `fetch` cannot: not WHETHER a host refuses,
// but WHAT refused and under which circumstances. It probes every enabled feed
// across a matrix of User-Agent strings, plus two control hosts that prove
// whether outbound HTTPS works at all from the machine running it.
//
// WHAT IT DOES NOT DO. It writes nothing, commits nothing, deploys nothing, and
// it ALWAYS exits 0. A diagnostic that can fail a build is a gate wearing a lab
// coat, and the gate already exists - `npm run fetch`, which is deliberately
// fail-loud. This one is for reading.
//
// HOW TO READ THE OUTPUT. Two questions, in this order:
//
//   1. Did the CONTROL hosts answer? If example.com does not, the problem is
//      this machine's network and nothing about feeds is being learned at all.
//   2. Do the feeds answer for SOME User-Agents and not others? If every
//      variant fails, the refusal is not about how we introduce ourselves and
//      the fix has to be a different network or a conversation with the
//      publisher. If only one variant fails, it is the string, and the fix is
//      one line in scripts/lib/http.mjs.
//
// That distinction is the whole point of the matrix. Running this once in the
// same place the failure occurs is what turns "the runner 403s" into an answer.
//
// A NOTE ON THE ASCII RULE, because it was learned the hard way writing this
// file. The two sanitising regexes below are written as escape SEQUENCES
// (\x00-\x1f and \x20-\x7e), never as literal control characters in the source.
// An earlier draft of this file typed the range literally, the bytes landed in
// the file, and the file became binary - unreadable by the read tool and
// unreviewable by a human, from a line that looks like it is merely a regex.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { USER_AGENT } from './lib/http.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// The variants. The project UA is imported, not retyped, so this can never
// drift from the string the real fetcher sends - a diagnostic that probes a
// different User-Agent than production sends would be measuring the wrong thing.
const UA_VARIANTS = [
  { key: 'project', ua: USER_AGENT, note: 'the string scripts/lib/http.mjs sends' },
  {
    key: 'browser',
    ua:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    note: 'an ordinary desktop browser, to test whether it is the UA string'
  },
  { key: 'curl', ua: 'curl/8.5.0', note: 'a common bot UA, to test bot filtering' },
  { key: 'empty', ua: '', note: 'no identification at all' }
];

// Control hosts. These are chosen to fail in a way that is unambiguous:
// example.com answers for anyone who has egress, and api.github.com is not a
// feed host, so a 403 from it would mean something is intercepting all traffic.
const CONTROLS = [
  { label: 'example.com (egress control)', url: 'https://example.com/' },
  { label: 'api.github.com (egress control)', url: 'https://api.github.com/zen' }
];

const TIMEOUT_MS = 20_000;

/** Strip to printable ASCII on a single line, so a hostile body cannot break the table. */
function snippet(body, limit = 180) {
  if (!body) return '(empty body)';
  return (
    body
      // Control characters, CRLF included, would each start a new table row.
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      // Anything above ASCII becomes a marker rather than being printed raw:
      // this file and every log it lands in are ASCII-only, and a mangled byte
      // in a diagnostic is worse than an honest placeholder.
      .replace(/[^\x20-\x7e]/g, '?')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit) || '(whitespace only)'
  );
}

/** One probe. Never throws: a refusal is a result, not an error. */
async function probe(url, ua) {
  const started = Date.now();
  const base = {
    url,
    ok: false,
    status: 0,
    ms: 0,
    server: '-',
    ray: '-',
    mitigated: '-',
    xsub: '-',
    ctype: '-',
    bytes: 0,
    items: 0,
    body: '(no response)'
  };
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': ua, Accept: '*/*' }
    });
    const body = await res.text();
    const h = (name) => res.headers.get(name) || '-';
    return {
      ...base,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      server: h('server'),
      ray: h('cf-ray'),
      mitigated: h('cf-mitigated'),
      xsub: h('x-sub'),
      ctype: h('content-type').slice(0, 34),
      bytes: body.length,
      items: (body.match(/<item>/g) || []).length,
      body: snippet(body)
    };
  } catch (err) {
    return {
      ...base,
      ms: Date.now() - started,
      // A thrown fetch has no HTTP status at all, which is a DIFFERENT failure
      // from a 403 and must never be reported as one.
      body: snippet(`request failed: ${err.message}`)
    };
  }
}

function row(r) {
  return [
    String(r.status).padStart(3),
    `${r.ms}ms`.padStart(7),
    String(r.server).padEnd(16).slice(0, 16),
    String(r.mitigated).padEnd(9).slice(0, 9),
    String(r.xsub).padEnd(14).slice(0, 14),
    String(r.items).padStart(4),
    String(r.bytes).padStart(8)
  ].join(' ');
}

const doc = parseYaml(await readFile(resolve(ROOT, 'data/sources.yml'), 'utf8'));
const feeds = (doc.sources || [])
  .filter((s) => s.enabled !== false)
  .map((s) => ({ id: s.id, url: s.feedUrl }));

console.log('');
console.log('  FEED DIAGNOSTIC');
console.log('  ' + '-'.repeat(78));
console.log(`  feeds configured and enabled : ${feeds.length}`);
console.log(`  user-agent variants         : ${UA_VARIANTS.length}`);
console.log(`  control hosts               : ${CONTROLS.length}`);
console.log(`  probes this will make       : ${feeds.length * UA_VARIANTS.length + CONTROLS.length}`);
console.log('');
console.log('    sta    lat  server          cf-mitig  x-sub          item    bytes  <- variant');
console.log('  ' + '-'.repeat(78));

// 1. Controls first. If these fail, everything after them is noise.
console.log('');
console.log('  CONTROLS');
const controlRows = [];
for (const c of CONTROLS) {
  const r = await probe(c.url, UA_VARIANTS[0].ua);
  controlRows.push({ ...r, label: c.label });
  console.log('  ' + row(r) + '  ' + c.label);
  console.log(`      ${r.body}`);
}

// 2. The matrix.
const results = [];
for (const feed of feeds) {
  console.log('');
  console.log(`  ${feed.id}  (${feed.url})`);
  for (const v of UA_VARIANTS) {
    const r = await probe(feed.url, v.ua);
    results.push({ feed: feed.id, variant: v.key, ...r });
    console.log('  ' + row(r) + '  ' + v.key);
  }
}

// 3. A verdict per feed, because a table of raw numbers is not an answer.
console.log('');
console.log('  ' + '='.repeat(78));
console.log('  READING OF THE RESULT');
console.log('  ' + '='.repeat(78));

const deadControls = controlRows.filter((r) => !r.ok);
if (deadControls.length > 0) {
  console.log('');
  console.log('  WARNING: a control host did not answer. If outbound HTTPS is broken');
  console.log('  on this machine, NOTHING below is evidence about the feeds.');
}

for (const feed of feeds) {
  const rows = results.filter((r) => r.feed === feed.id);
  const ok = rows.filter((r) => r.ok);
  // THE PARTITION THAT MATTERS. A refusal and a non-response are DIFFERENT
  // FAILURES and must never be counted together.
  //
  //   status >= 400  the server answered and said no. That is a REFUSAL, and it
  //                  is evidence about us.
  //   status === 0   no HTTP response at all; the request never completed. That
  //                  is a TIMEOUT or a dropped connection. It is evidence about
  //                  THE NETWORK and says nothing about our User-Agent.
  //
  // The first version of this script used a bare `!r.ok` and therefore counted
  // timeouts as refusals. On a degraded link it then reported a feed as
  // "USER-AGENT SENSITIVE" when two variants had merely run out the clock - a
  // false diagnosis that would have sent someone to change the User-Agent, and
  // would have looked rigorous while being wrong. A timeout is not an answer.
  const refused = rows.filter((r) => r.status >= 400);
  const noResponse = rows.filter((r) => r.status === 0);

  console.log('');
  console.log(`  ${feed.id}`);
  console.log(`    statuses : ${rows.map((r) => `${r.variant}=${r.status}`).join('  ')}`);

  if (noResponse.length > 0) {
    console.log(
      `    WARNING  : ${noResponse.length} of ${rows.length} variants got NO HTTP RESPONSE ` +
        `(${noResponse.map((r) => r.variant).join(', ')}).`
    );
    console.log('               That is a network symptom, not a refusal, and it makes any');
    console.log('               User-Agent inference from this feed UNSAFE. Re-run when the');
    console.log('               link is healthy before concluding anything about it.');
  }

  if (refused.length > 0 && ok.length > 0 && noResponse.length === 0) {
    console.log(`    verdict  : USER-AGENT SENSITIVE. Answers: ${ok.map((r) => r.variant).join(', ')}.`);
    console.log(`               Refuses: ${refused.map((r) => r.variant).join(', ')}.`);
    console.log('               Every variant completed, so the difference is the request');
    console.log('               itself rather than the network. The string is the cause.');
  } else if (ok.length === 0 && refused.length === rows.length) {
    console.log('    verdict  : REFUSED ON EVERY VARIANT, including a browser string, and');
    console.log('               every variant completed a request.');
    console.log('               The refusal is NOT about our User-Agent, so it is about where');
    console.log('               the request came from. One identical answer for every variant');
    console.log('               is the signature of an IP or network-range block.');
  } else if (ok.length === rows.length) {
    console.log('    verdict  : OK on every variant.');
  } else {
    console.log('    verdict  : INCONCLUSIVE on this run. The variants did not all complete,');
    console.log('               so the difference between them cannot be attributed to the');
    console.log('               request. Re-run on a healthy link.');
  }

  const sample = refused[0];
  if (sample) {
    console.log(`    server   : ${sample.server}   cf-ray: ${sample.ray}   cf-mitigated: ${sample.mitigated}`);
    console.log(`    body     : ${sample.body}`);
  }
}

console.log('');
console.log('  ' + '='.repeat(78));
console.log('  Always exits 0. This script observes; it does not gate.');
console.log('  The gate is `npm run fetch`, and it is deliberately fail-loud.');
console.log('');