// test/feed-egress-wiring.test.mjs
//
// The fetch no longer touches the network directly: it is relayed through the
// feed-egress Worker, because GitHub's runner IP range is refused by Cloudflare's
// managed challenge. That relay has three moving parts that name each other -
// the Worker name, the URL in the workflow, and the secret - and nothing at
// runtime connects them. A typo in any one of them produces the same symptom:
// the scheduled run goes red at the fetch step, four hours from now, with a
// message about a Worker that does not exist.
//
// This test connects them at build time instead.
//
// TWO THINGS THIS FILE GOT WRONG FIRST, both worth recording.
//
// 1. IT MATCHED COMMENTS. The first version scanned the raw file for
//    `--allow-partial` and for `echo ... secrets.` and reported both as
//    violations. Both strings are present in refresh.yml only inside comments
//    that FORBID them - "No continue-on-error. No `|| true`. No --allow-partial."
//    and a note explaining that `echo ${{ secrets.X }}` would leak the token. So
//    the guard was enforcing the prose of a file whose prose is a list of things
//    not to do. A grep over a commented configuration file has to strip comments
//    first, or it will eventually block a legitimate change on the strength of a
//    sentence warning against the change.
//
// 2. ITS POSITIVE CONTROL DID NOT USE THE SAME CODE AS THE REAL CHECK. The
//    control asserted that a one-character hostname typo is detected, but it
//    extracted the host with a different expression than the real test used, and
//    so read `https:` instead of the hostname and "passed" for the wrong reason.
//    A positive control that does not exercise the production path proves
//    nothing about it. Both now call the same `hostOf` function.
//
// A NOTE ON REGEXES, because refresh.yml contains a comment warning against
// parsing configuration with a guess. That warning is about a WORKFLOW deciding
// at runtime whether a name is valid and reporting whatever the regex found.
// This is the opposite case: if these regexes stop matching, the test FAILS,
// which is the safe direction. A config check that fails loudly when it cannot
// read is not the same thing as one that proceeds on a bad guess.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = join(ROOT, '.github', 'workflows', 'refresh.yml')
const EGRESS_CONFIG = join(ROOT, 'workers', 'feed-egress', 'wrangler.jsonc')
const SITE_CONFIG = join(ROOT, 'wrangler.jsonc')

const read = (p) => readFile(p, 'utf8')

/**
 * Drop whole-line YAML comments.
 *
 * Only lines whose first non-space character is `#` are removed, which is the
 * only form this file uses. That is a real limitation - a trailing comment after
 * a value would survive - and it is stated rather than hidden, because a
 * limitation that is documented can be checked by a reader and one that is not
 * will be discovered by an outage.
 */
function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
}

/**
 * The first hostname label of a URL, with or without a scheme.
 *
 * `split('/')[0]` alone returns "https:" for a full URL, which is what the
 * first version of the positive control did and why it passed for the wrong
 * reason. This strips the scheme explicitly so the same call is correct whether
 * it is handed "https://host/path" or the already-bare "host/path".
 */
function hostOf(url) {
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return withoutScheme.split('/')[0].split('.')[0];
}

test('the endpoint in the workflow names the Worker that is actually deployed', async (t) => {
  const workflow = stripComments(await read(WORKFLOW))
  const config = stripComments(await read(EGRESS_CONFIG))

  const name = (config.match(/"name"\s*:\s*"([^"]+)"/) || [])[1]
  assert.ok(name, 'positive control: could not read a Worker name from workers/feed-egress/wrangler.jsonc')

  const url = (workflow.match(/FEED_EGRESS_URL:\s*https:\/\/([^\s]+)/) || [])[1]
  assert.ok(url, 'positive control: could not read FEED_EGRESS_URL from refresh.yml')

  const host = hostOf(url)
  assert.equal(
    host,
    name,
    `refresh.yml points at "${url}" but workers/feed-egress/wrangler.jsonc deploys "${name}". ` +
      'One of them is wrong and the scheduled fetch will fail four hours from now.'
  )

  t.diagnostic(`workflow endpoint host "${host}" matches deployed Worker "${name}"`)
})

test('the egress Worker and the site Worker are different Workers', async (t) => {
  const egress = stripComments(await read(EGRESS_CONFIG))
  const site = stripComments(await read(SITE_CONFIG))

  const egressName = (egress.match(/"name"\s*:\s*"([^"]+)"/) || [])[1]
  const siteName = (site.match(/"name"\s*:\s*"([^"]+)"/) || [])[1]
  assert.ok(egressName && siteName, 'positive control: both configs must declare a name')

  // The failure this prevents is quiet and total: deploying the egress Worker
  // with the site's config would replace the website with a JSON endpoint, and
  // deploying the site with the egress config would replace the website with a
  // proxy. Neither would error in a way anyone would read.
  assert.notEqual(
    egressName,
    siteName,
    'the feed-egress Worker and the published site must not share a name'
  )
  t.diagnostic(`egress "${egressName}" is distinct from site "${siteName}"`)
})

test('the fetch step is still fail-loud after the egress change', async (t) => {
  const workflow = stripComments(await read(WORKFLOW))

  // The single most important line in this file, per its own closing comment.
  // Adding the egress relay touched this step, so this asserts the guarantee
  // survived the edit rather than trusting that it did.
  assert.match(
    workflow,
    /run: npm run fetch/,
    'the fetch step must still run `npm run fetch` verbatim'
  )

  // Scanned against the COMMENT-STRIPPED text. See the note at the top: these
  // three strings all appear in this file's prose, in sentences that forbid
  // them, and matching that prose would be the guard enforcing a warning.
  const forbidden = [
    { re: /npm run fetch[^\n]*\|\|\s*true/, what: '`|| true` after the fetch' },
    { re: /continue-on-error:\s*true/, what: 'a continue-on-error on any step' },
    { re: /--allow-partial/, what: '--allow-partial' }
  ]
  const found = forbidden.filter((f) => f.re.test(workflow)).map((f) => f.what)
  assert.deepEqual(
    found,
    [],
    `the fail-loud guarantee was weakened by ${found.join(' and ')}. ROADMAP design rule 3 exists to prevent a green build on stale data.`
  )

  t.diagnostic('no || true, no continue-on-error, no --allow-partial in any non-comment line')
})

test('the egress token reaches the step as an env var, never on a command line', async () => {
  const workflow = stripComments(await read(WORKFLOW))

  assert.match(
    workflow,
    /FEED_EGRESS_TOKEN:\s*\$\{\{\s*secrets\.FEED_EGRESS_TOKEN\s*\}\}/,
    'the token must be supplied through an env: block so it never lands in the log'
  )

  // An `echo ${{ secrets.X }}` in an actual step would print the token into a
  // log readable by anyone with repository access.
  assert.doesNotMatch(
    workflow,
    /echo[^\n]*\$\{\{\s*secrets\./,
    'no step may echo a secret; that prints it into the run log'
  )
})

test('a missing egress token fails before the fetch rather than inside it', async () => {
  const workflow = stripComments(await read(WORKFLOW))

  // The guard has to come BEFORE the fetch, or the fetch's own error is all the
  // operator gets - and the fix for "Worker returned 401" is not obvious from
  // inside a stack trace.
  const guardAt = workflow.indexOf('require the feed egress credential')
  const fetchAt = workflow.indexOf('run: npm run fetch')

  assert.ok(guardAt > -1, 'positive control: the egress credential guard must exist')
  assert.ok(fetchAt > -1, 'positive control: the fetch step must exist')
  assert.ok(
    guardAt < fetchAt,
    'the egress credential guard must run before the fetch, not after it'
  )
})

test('POSITIVE CONTROL: the drift detector can actually see a mismatch', () => {
  // Run against a deliberately wrong pair, through the SAME hostOf the real
  // check uses. The first version of this control used a different expression
  // and read "https:" as the hostname, so it passed while proving nothing.
  const config = '"name": "sb-feed-egress"'
  const driftedUrl = 'https://sb-feed-egres.mstricklandtech.workers.dev'

  const name = (config.match(/"name"\s*:\s*"([^"]+)"/) || [])[1]
  const host = hostOf(driftedUrl)

  assert.equal(name, 'sb-feed-egress')
  assert.equal(
    host,
    'sb-feed-egres',
    'hostOf must read the hostname, not the scheme, or this control is meaningless'
  )
  assert.notEqual(
    host,
    name,
    'a one-character typo in the hostname must be detected, or the real check proves nothing'
  )
})

test('POSITIVE CONTROL: the comment stripper is what makes the guards meaningful', () => {
  // Prose that forbids a thing must not read as the thing. Without this, the
  // fail-loud and echo guards are one honest comment away from failing on the
  // very sentences that document the rule.
  const sample = ['# No --allow-partial, and no `|| true`.', 'run: npm run fetch'].join('\n')

  assert.match(sample, /--allow-partial/, 'the raw text does contain the string')
  assert.doesNotMatch(
    stripComments(sample),
    /--allow-partial/,
    'stripComments must remove a comment that mentions the forbidden token'
  )
})