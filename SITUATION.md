# SITUATION.md

**Written 2026-10-08. Revised 2026-10-09. Read this before changing anything in
this project.**

This is a situational overview, not a history. `build-log.md` records what was
tried and what broke, in order, and it is the right place to look for the reason
a past approach was rejected. This file answers a different question: **if you
are picking this up cold, what is true right now, what is broken, and what is
about to bite you.**

It is deliberately written to be read in one sitting.

---

## 1. What this is

An Astro static site that aggregates RSS feeds from four independent Substack
publications and republishes nothing. Each article appears as a title, a short
excerpt and a prominent outbound link to where the writing actually lives. It
also publishes a civic events calendar for the Upstate of South Carolina.

| | |
| --- | --- |
| Canonical repo | `C:\Users\SCSpeakers\Documents\GitHub\Speakers\Speakers` |
| GitHub | `https://github.com/Bloodfeather/speakers-bureau` (public) |
| Live site | `https://bold-unit-b37a.mstricklandtech.workers.dev` |
| Cloudflare account | `da978ed1ad70fd76a2486982616e2551` (`Mstricklandtech@gmail.com's Account`) |
| Cloudflare site Worker | `bold-unit-b37a` |
| Cloudflare feed Worker | `sb-feed-egress` |

**Every claim in this file is about the canonical repo above.** A second working
copy existed on the Desktop for several days; it is gone, but if you ever find
yourself holding two copies, that is the bug and `WHERE-THIS-REPO-LIVES.md`
explains why.

### READ THIS BEFORE ASSUMING AN ORIGIN

**`scspeakersbureau.org` is NOT this project.** It serves a separate,
pre-existing WordPress site titled "SC Speakers Bureau | Events Promoting Liberty
through Education", and it is hosted by WordOps on an ordinary server
(`x-powered-by: WordOps`), not by Cloudflare Workers. Measured 2026-10-08:

| Path | `scspeakersbureau.org` | `workers.dev` |
| --- | --- | --- |
| `/` | 200, 219 KB, other site | 200, 34 KB, **our site** |
| `/latest/` | **404** | 200 |
| `/about/` | **404** | 200 |
| `/topic/commentary/` | **404** | 200 |

Two consequences that have already caused confusion:

1. **Every live verification in this project's history was run against
   `workers.dev`,** never against the custom domain. That was the right call,
   since it is the only origin serving this build, but it is worth stating
   plainly.
2. **`astro.config.mjs` declares `site: 'https://scspeakersbureau.org'`,** which
   is currently untrue. The practical impact is smaller than it looks: the build
   emits **no canonical links and no `og:url`**, and every internal URL is
   relative, so nothing is actually broken today. It would matter the moment a
   sitemap, an RSS feed or canonical tags were added, all of which would point at
   the wrong origin. Decide deliberately whether the reading room should ever be
   published at that domain or under a path on it, and do not "fix" this by
   repointing DNS.

The User-Agent the fetcher sends also names `scspeakersbureau.org` as its contact
URL. That is harmless and intentional, since it identifies the organisation, but
it is not a URL where this site can be reached.

---

## 2. Current state, in one table

| Area | State |
| --- | --- |
| Live site | **Up and correct.** HTTP 200, 12-card home page, all pages building. |
| Test suite | **290 passing, 0 failing** at time of writing. |
| Build | Exit 0, 7 pages, deterministic (two builds produce identical SHA-256 per file). |
| Event data | `npm run events:check` exits 0. |
| Feed refresh, manual from a home IP | **Works.** 4 sources, 49 articles. |
| Feed refresh, from GitHub's own network | **Broken. Permanently. See section 4.** |
| Feed refresh, via the egress Worker | **Works, with occasional 429s. See section 5.** |
| Automated publishing | **Working.** First fully green run 2026-10-09 (run 37965253177). |
| Repository secrets | **2, both Cloudflare.** `PAT_TOKEN` was deleted 2026-10-09. See section 6. |
| The schedule | **Armed and active.** Every 6 hours. |

---

## 3. The four non-negotiables

These are product requirements, not preferences. Getting them wrong publishes a
lie rather than merely looking untidy.

1. **Nothing may work only with JavaScript.** Navigation is ordinary links. The
   events calendar is interactive with scripting disabled, using radio inputs and
   CSS `:has()`. The only script on the site persists the reader's theme choice.
2. **RSS holds no history.** Each publication's feed returns only its most recent
   posts, roughly 20 items, about six weeks. This site is a **window, not an
   archive.** The words "archive", "library" and "browse all" must never appear.
   When a post falls out of a feed, it leaves this site too.
3. **The built HTML must not depend on when it was built.** No `new Date()` in any
   rendering path. The past/upcoming split on the events page comes from
   `reviewedOn`, a date a human puts in the file. The suite proves this by running
   the date code under several timezones and comparing bytes.
4. **Every event carries a `url`** to the notice it came from. A civic date with
   no source is an assertion with nothing behind it.

Two further rules that have cost real money to learn:

- **A failed feed must be red and must NOT publish.** This is why the deploy job
  has `needs: refresh`. Do not "fix" a red action with `|| true`,
  `continue-on-error`, or `--allow-partial`. The one failure mode that looks like
  success is a green build on yesterday's data.
- **Colour values live only in `src/styles/themes.css`.**

---

## 4. GitHub cannot read these feeds. This is permanent.

Established by measurement, not inference.

On a real `ubuntu-latest` runner (egress `172.184.247.97`, SJC):

| Signal | Value |
| --- | --- |
| `example.com` | 200 in 172ms |
| `api.github.com` | 200 in 64ms |
| All 4 feeds, all 4 User-Agent variants | **403 every time** |
| `cf-mitigated` | **`challenge`** |
| Body | `<title>Just a moment...` |

`cf-mitigated: challenge` identifies it as **Cloudflare's Managed Challenge
refusing GitHub's Azure egress range.** This is not a Substack block and not a
User-Agent filter. **A desktop browser User-Agent fails identically**, which is
the proof that no header change and no increase in retries can ever fix it.

Identical code from a residential IP returns 200. So the only workable answer is
to make the request from a network Cloudflare does not challenge.

Reproduce it any time with:
```
gh workflow run diagnose-feeds.yml --repo Bloodfeather/speakers-bureau
```
That workflow is manual-trigger only, needs no secrets, and shares nothing with
the real one.

---

## 5. The egress Worker, and its occasional 429s

The fix for section 4 is `workers/feed-egress/worker.js`, a Worker that fetches
feed URLs and relays the bytes. It parses nothing and decides nothing; all
validation, retry policy and normalization stay in `scripts/`, under test.

**Status 2026-10-09: this is a known, accepted, intermittent condition, not an
open problem.** It is recorded here because a red run caused by it must not be
mistaken for a regression.

**That fixed the 403, and for a while it looked like it had introduced a second
problem.** Funnelling every scheduled request through one Worker means all
scheduled traffic arrives from a small set of Cloudflare addresses. Four
scheduled runs in a row were throttled:

```
2026-10-07T15:33Z   429
2026-10-07T21:18Z   429
2026-10-08T06:05Z   429
2026-10-08T15:37Z   429
```

**CORRECTION, made in the open on 2026-10-08 after the evidence contradicted it.**
An earlier version of this file called that pattern *chronic, not incidental*, and
implied the request rate had to be cut further. That was too strong, and it was
written from the failure count rather than from a diagnosis. What is actually
known:

- Four consecutive failures, then a clean pass. A Cloudflare-egress probe at
  19:11Z returned **200 on all four feeds in 15-69ms with no `retry-after`**, and
  the 19:12Z run then fetched **4 sources, 4 OK, 0 failed**.
- So the throttling is **intermittent and bursty**, not a standing limit.
- Heavy probing on 2026-10-07 plausibly caused some of it, since this
  investigation hit these feeds dozens of times in a few hours. But the failures
  on 2026-10-08 at 06:05Z and 15:37Z happened while no probing was happening, so
  probing is not the whole explanation either.
- The honest summary is that the Worker concentrates the request rate, which
  makes throttling *possible*, and something about the request pattern tips it
  over sometimes. No single cause has been established.

The stagger and the longer retry window are the right mitigation for intermittent
throttling regardless of the cause, and the 6-hourly interval reduces exposure.
Keep them. But do not treat the 429s as solved until several consecutive runs
have passed, and do not be surprised by an occasional red run that is purely
this.

---

## 6. Automated publishing works. Solved 2026-10-09.

The run that fixed this is **37965253177**: both jobs green, deploy published,
first time in the project's history. Twenty-five runs had failed before it.

Three separate faults were stacked on top of each other, and each one masked the
next. That is why it took days: every fix revealed a different error, and no
single error message named its own cause.

| # | Fault | Symptom | Fix |
| --- | --- | --- | --- |
| 1 | `secrets.PAT_TOKEN \|\| github.token` | `Permission ... denied` (403) | Use `github.token`. See below. |
| 2 | Token secret value malformed | `6111 Invalid format for Authorization header` | Re-paste, 40 chars, no `Bearer`, no quotes |
| 3 | Token had an IP allowlist | `9109 Cannot use the access token from location: 40.75.133.96` | Remove the IP restriction |

### Fault 1: the PAT was never needed, and the fallback hid that

The refresh job has always granted `permissions: contents: write`, and a
job-level grant **overrides** the repository's default workflow-token permission
(which is `read`). So the automatic `GITHUB_TOKEN` could push the dataset the
entire time. The workflow file even said so:

> `GITHUB_TOKEN would also be able to push, and that is the honest alternative.`

The blocker was the expression itself:

```
token: ${{ secrets.PAT_TOKEN || github.token }}
```

That looks like a safe fallback and is the opposite. `||` only falls through when
the left side is **unset**. While `PAT_TOKEN` existed - even set to a token that
was invalid, expired, or scoped to the wrong repository - it always won, and the
`GITHUB_TOKEN` underneath was never reached.

There was a guard step that made this worse: `require the push credential`
asserted that `secrets.PAT_TOKEN` was *set*, so a broken optional secret was
checked for and then used. The failure read as "this credential needs repairing"
when the correct answer was "delete this credential".

**Now:** `token: ${{ github.token }}`, and the guard asserts the real dependency -
that the job grants `contents: write` - failing with a useful message if someone
lowers it. `PAT_TOKEN` was deleted from the repository on 2026-10-09. Do not add
it back.

### Fault 2: 6111 means malformed, not wrong

```
{"code":6003,"message":"Invalid request headers",
  "error_chain":[{"code":6111,"message":"Invalid format for Authorization header"}]}
```

`6111` is returned when the value contains anything outside `[A-Za-z0-9_-]`, or
is empty, or is truncated. It is checked **before** the token is looked up.

An earlier version of this file said the likely cause was a trailing newline or
space. **That is wrong**, and it was measured: a trailing newline or space
returns `1000 Invalid API Token`, not `6111`, because the HTTP client strips
those. What actually produces `6111`, verified against the live API:

| Header value | Cloudflare returns |
| --- | --- |
| Well-formed 40-char but invalid | `1000` |
| Trailing newline / trailing space | `1000` |
| No `Bearer ` prefix | `6111` |
| `Bearer ` with nothing after | `6111` |
| Quoted token `"..."` | `6111` |
| Space, colon, slash or `%` inside | `6111` |
| Short value | `6111` |

So the practical rule: **a valid Cloudflare API token is exactly 40 characters of
`[A-Za-z0-9_-]`, with no prefix and no quotes.** `1000` means the token is
invalid or revoked; `6111` means the value is malformed.

### Fault 3: the IP allowlist, which is the one nobody expects

```
Authentication error [code: 10000]
Cannot use the access token from location: 40.75.133.96 [code: 9109]
```

`40.75.133.96` is **AS8075, Microsoft Corporation, San Jose** - GitHub Actions'
Azure runner egress. The token had **Client IP Address Filtering** set to a home
address, so Cloudflare refused it from the runner while it kept working from a
laptop. That asymmetry is the tell: a token that works in `curl` locally and
fails only in CI is an IP-filter problem, not a permissions problem.

**Fix:** on the token, set *Client IP Address Filtering* to **Not restricted**.
An **empty** condition block is not the same as no filter - it defaults to deny
and reproduces `9109` exactly. Create from the **"Edit Cloudflare Workers"**
template and never touch the IP section.

### The secrets, and the true state of each

Only **two** secrets are needed now, both Cloudflare.

| Secret | Set | Works? |
| --- | --- | --- |
| `FEED_EGRESS_TOKEN` | yes | **Yes.** Proved by every green fetch. |
| `CLOUDFLARE_API_TOKEN` | yes | **Yes.** Proved by run 37965253177. `Workers Scripts > Edit` + `Account Settings > Read`, no IP filter. |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Yes. It is an identifier, not a credential. `da978ed1ad70fd76a2486982616e2551`. |
| ~~`PAT_TOKEN`~~ | **deleted** | Not needed. See fault 1. |

**Required Cloudflare permission: `Account > Workers Scripts > Edit`, plus
`Account > Account Settings > Read`.** The dashboard's **"Edit Cloudflare
Workers"** template grants exactly this.

**`Cloudflare Pages > Edit` is wrong** and appears nowhere in the current docs.
It was in three places until 2026-10-07, and following it would have produced a
token that deploys nothing, because `wrangler deploy` publishes a Worker.

### Why nobody can mint this token from the machine

The local wrangler credential is an OAuth token whose scopes were enumerated:
it holds `workers:write` and `pages:write` but **no token-minting scope**. So no
API token can be created from here, and an OAuth token would be the wrong
artifact anyway, since it expires and needs interactive refresh. This step
genuinely needs a human in the dashboard.

Note that the local OAuth login **can** deploy by hand (it holds `workers:write`),
which is the useful fallback when the scheduled path is broken - see section 7.

---

## 7. Deploying and rolling back

Deploy by hand, from the repository root:

```
npm run build
npx -y wrangler@4.148.0 deploy
```

Roll back, or see what is live:

```
npx -y wrangler@4.148.0 deployments list --name bold-unit-b37a
npx -y wrangler@4.148.0 versions list --name bold-unit-b37a
```

Wrangler OAuth credentials live at
`C:\Users\SCSpeakers\AppData\Roaming\xdg.config\.wrangler\config\default.toml`.

**Deploying the feed Worker is a different command from a different directory**,
and confusing the two would replace one with the other:

```
cd workers\feed-egress
npx -y wrangler@4.148.0 deploy
npx -y wrangler@4.148.0 secret put FEED_EGRESS_TOKEN
```

`test/feed-egress-wiring.test.mjs` asserts the two Worker names are different and
that the URL in the workflow matches the deployed one.

**Deploy the site Worker, not `pages deploy`.** The live address is a
`workers.dev` name, so a Pages deploy would publish nothing that anyone sees.

### Verifying a deploy

Immediately after deploying, the edge may still serve the previous version. A
live check run seconds after a deploy can read stale bytes and look like a
failure. Confirm by comparing hashes:

```
node -e "const c=require('node:crypto'),f=require('node:fs');
  const l=f.readFileSync('dist/index.html');
  console.log('local ',c.createHash('sha256').update(l).digest('hex').slice(0,16));
  fetch('https://bold-unit-b37a.mstricklandtech.workers.dev/').then(r=>r.text())
    .then(h=>console.log('live  ',c.createHash('sha256').update(h).digest('hex').slice(0,16)))"
```

This cost a false alarm once already: a check reported 6 cards when the build
had 12, purely because it ran too early.

---

## 8. Traps that have cost time here

Read `environment-log.md` and `METHOD.md` for the full lists. These are the ones
that keep biting.

**Verification and testing**
- **Astro preserves template line breaks.** A sentence written across two source
  lines is emitted with a newline in the middle, so a raw substring search for it
  finds nothing. This produced three false "the text is missing" alarms in one
  session. **Strip tags and collapse whitespace before searching rendered prose.**
- **A grep over a commented config file will match the comments.** `refresh.yml`
  contains `--allow-partial` and `echo ${{ secrets.X }}` only in sentences that
  *forbid* them. A guard over it must strip comment lines first.
- **A positive control that does not exercise the production path proves
  nothing.** One control here read `https:` as a hostname and passed for the
  wrong reason. Make the control call the same function the real test calls.
- **A guard that has only ever been seen passing has not been tested.** Plant a
  real failure, confirm it fails, restore, confirm it passes.
- **A local green run of a fix for a network problem proves nothing** if the
  network problem cannot be reproduced locally. Both paths succeed from a home IP.

**Asynchronous**
- **A timeout is not a refusal.** `status === 0` means no response; `status >=
  400` means the server said no. Conflating them made a diagnostic report a
  healthy feed as "User-Agent sensitive" while it was merely timing out.
- **A transport must not turn a refusal into a success.** If the relay ever
  reports 200 for a 403, the site would publish stale data looking fresh.

**Windows and PowerShell**
- `Set-Content` with no `-Encoding` destroys bytes; `>` writes UTF-16.
- `[System.IO.File]` with a relative path resolves against the process working
  directory, not the PowerShell location. Use absolute paths.
- `gh --jq` with escaped quotes gets mangled. Use plain `gh run view <id>`.
- `gh api --jq .content` returns base64; grepping it for a filename never matches.
- `gh secret set` names may contain only letters, digits and underscores. A
  hyphen fails with HTTP 422.
- The `edit` tool wants `path` as the first argument key.
- Never type a character whose identity is its byte sequence. Build it from its
  number. Typing a literal control-character range once turned a source file
  binary, and it was unreadable from that line onward.

**Publishing**
- `git push` to the branch checked out in a non-bare repo is refused. Use
  `fetch` plus `merge --ff-only`.
- Verify every file you authored is pure ASCII by counting bytes above 127. Read
  the bytes; do not trust a round trip.

### Where the ASCII rule does and does not apply

**It applies to every file you write:** source, tests, workflows, documentation,
and configuration. Read the bytes and count anything above 127.

**It does not apply to `data/articles.json`,** and a "fix" there would be damage.
That file contains excerpts of other people's published writing, which
legitimately contains typographic characters: as of 2026-10-08 it carries
U+2019 curly apostrophes, U+2018 and U+201C/U+201D curly quotes, and U+2122.
The committed version already contained them before this project touched
anything.

**Do not normalise, strip or "fix" them.** Replacing a publication's curly quote
with an ASCII one alters quoted text, and doing it silently means the site
misquotes someone. This is the same trap as the sweep that broke a CSS `indexOf`
assertion: a tidying pass that looks like a correction and is not.

A useful distinction that makes this checkable rather than a matter of taste: an
ASCII audit of a source file should show exactly zero, while an audit of
`data/articles.json` showing a few dozen is expected and correct.

---

## 9. What to do next, in order

**Rewritten 2026-10-09.** The two credential items that used to head this list are
done - see section 6. Automated publishing works. What is left is watching it
stay working, and keeping the record honest.

1. **Watch the next few scheduled runs before trusting it.** The pipeline has
   passed **once**. One green run proves the wiring, not the reliability. Look at
   the next two or three: 00:17, 06:17, 12:17, 18:17 UTC.
   ```
   gh run list --repo Bloodfeather/speakers-bureau --limit 10
   ```
   A healthy run is green with a `data: refresh dataset` commit. A run that saved
   nothing because nothing changed is also healthy - the dataset step says so.
2. **Expect occasional 429 failures and do not treat them as regressions.** The
   throttling is intermittent, not a standing limit: see section 5. When it
   happens the fetch fails, the run goes red, and the deploy is skipped **on
   purpose** so a stale site is never republished. The site stays up and catches
   up on the next run. Judge the pattern over several runs, not one.
3. **Only if 429s prove chronic,** stop making the Worker the only route, so
   neither the Worker nor a single IP carries the whole load. That is the
   remaining architectural option and has not been tried.
4. **Update `docs/DEPLOY.md` and this file** as the state changes. Section 2 is
   the table to edit first. Section 6 of this file and section 4 of
   `docs/DEPLOY.md` were both rewritten on 2026-10-09 because the credential
   story changed underneath them.

### If it breaks again, start here

- **Push refused (`Permission ... denied`)** - the job-level
  `permissions: contents: write` grant has been removed or lowered. That grant is
  the whole mechanism; there is no token secret to fix.
- **`6111 Invalid format for Authorization header`** - the
  `CLOUDFLARE_API_TOKEN` value is malformed. It is not a permissions problem and
  not a trailing newline. 40 chars, `[A-Za-z0-9_-]`, no `Bearer`, no quotes.
- **`9109 Cannot use the access token from location`** - the token has an IP
  filter. Remove it. This is the one that looks like a permissions bug and is
  not.
- **`1000 Invalid API Token`** - the token is genuinely invalid, revoked, or
  expired. Recreate it.

---

## 10. Things that are deliberate, not bugs

Do not "fix" these without asking the owner.

- **Publication names appear on every card** but there is no roster listing them.
  The roster was removed on request; per-card attribution was deliberately kept,
  because the site reproduces a short excerpt of other people's writing and
  attribution is what makes quoting someone honest.
- **`PLACEHOLDER` watermarks on event banners.** These mark artwork that is
  generated rather than supplied. `test/placeholders.test.mjs` enforces the word
  in 21 places.
- **"Last reviewed" appears on `/events/` only**, not site-wide.
- **The site says "not an archive".** That is true and load-bearing.
- **Fail-loud, always.** A red run with an explanation beats a green run on stale
  data.
- **Egress Worker caches nothing.** A refresh serving a stale copy would be
  precisely the failure this project exists to make impossible.
