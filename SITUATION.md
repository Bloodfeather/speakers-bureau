# SITUATION.md

**Written 2026-10-08. Read this before changing anything in this project.**

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
| Test suite | **274 passing, 0 failing** at time of writing. |
| Build | Exit 0, 7 pages, deterministic (two builds produce identical SHA-256 per file). |
| Event data | `npm run events:check` exits 0. |
| Feed refresh, manual from a home IP | **Works.** 4 sources, 49 articles. |
| Feed refresh, from GitHub's own network | **Broken. Permanently. See section 4.** |
| Feed refresh, via the egress Worker | **Rate limited. See section 5. This is the live problem.** |
| Automated publishing | **Never once succeeded.** See section 6. |
| Repository secrets | 4 of 4 names are set. One is almost certainly still wrong. See section 6. |

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

## 5. The live problem: the egress Worker is rate limited

The fix for section 4 is `workers/feed-egress/worker.js`, a Worker that fetches
feed URLs and relays the bytes. It parses nothing and decides nothing; all
validation, retry policy and normalization stay in `scripts/`, under test.

**That fixed the 403 and introduced a second problem.** Funnelling every
scheduled request through one Worker means all scheduled traffic arrives from a
small set of Cloudflare addresses, and the origins throttle it:

```
feed                    residential   via Worker
unitedpatriotsalliance    200           200
evanmulch                 200             0
malone                    200             0
melthevcl                 200           200
```

Every scheduled run since the Worker went in has failed with HTTP 429:

```
2026-10-07T06:00Z   (old, pre-Worker: the 403)
2026-10-07T15:33Z   429
2026-10-07T21:18Z   429
2026-10-08T06:05Z   429
2026-10-08T15:37Z   429
```

An earlier note in `build-log.md` frames this as residue from diagnostic probing.
**That framing was wrong.** It is chronic, not incidental. The response being
implemented is to request less often and less burstily: a stagger between feeds,
a longer retry window for 429, and a move from a 4-hourly to a 6-hourly
schedule.

If that proves insufficient, the next option is to stop making the Worker the
sole route, so that neither path carries the whole load. See section 9.

---

## 6. Automated publishing has never worked

Not once. Every `refresh` run has been red. Getting to an unattended 4-hourly
loop is the single outstanding goal of this project.

The four repository secrets, and the true state of each:

| Secret | Set | Works? |
| --- | --- | --- |
| `FEED_EGRESS_TOKEN` | yes | **Yes.** Proved by a green refresh job. |
| `PAT_TOKEN` | yes | **Unknown.** Secret values cannot be read back, and this is only exercised when dataset *content* changes. Expect a loud, safe failure if it is wrong: nothing written, deploy skipped, live site untouched. |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Yes, as far as it can be: verified to match the account wrangler deploys to. It is an identifier, not a credential. |
| `CLOUDFLARE_API_TOKEN` | yes | **No.** See below. |

### The Cloudflare token problem

The deploy step fails with:

```
ERROR  A request to the Cloudflare API (/accounts/***/workers/...) failed
       Authentication error [code: 10000]
  It looks like you are authenticating Wrangler via a custom API token set in an
  environment variable.
```

A hand-run verification against the token returned:

```json
{"success":false,"errors":[{"code":6003,"message":"Invalid request headers",
  "error_chain":[{"code":6111,"message":"Invalid format for Authorization header"}]}]}
```

**Code 6111 is the key detail.** It means Cloudflare rejected the *shape* of the
header before looking at the token at all. A wrong-but-well-formed token gets
10000. So this is a string-formatting problem, not an authentication or
permissions problem. Most likely the pasted value carries a trailing newline, a
space, or a stray quote. The token itself may be perfectly good.

**Required permission: `Account > Workers Scripts > Edit`, plus
`Account > Account Settings > Read`.** The dashboard's **"Edit Cloudflare
Workers"** template grants exactly this and is the fast path.

**`Cloudflare Pages > Edit` is wrong** and appears nowhere in the current docs.
It was in three places until 2026-10-07, and following it would have produced a
token that deploys nothing, because `wrangler deploy` publishes a Worker.

### Why nobody can mint this token from the machine

The local wrangler credential is an OAuth token whose scopes were enumerated:
it holds `workers:write` and `pages:write` but **no token-minting scope**. So no
API token can be created from here, and an OAuth token would be the wrong
artifact anyway, since it expires and needs interactive refresh. This step
genuinely needs a human in the dashboard.

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

1. **Fix `CLOUDFLARE_API_TOKEN`.** Have the owner verify it locally without
   exposing it:
   ```powershell
   $env:CF = Read-Host "paste token"
   "length      : $($env:CF.Length)"
   "needs trim  : $($env:CF -ne $env:CF.Trim())"
   "charset ok  : $($env:CF -match '^[A-Za-z0-9_-]+$')"
   $env:CF = $env:CF.Trim()
   curl.exe -s -H "Authorization: Bearer $env:CF" https://api.cloudflare.com/client/v4/user/tokens/verify
   ```
   A valid Cloudflare API token is **40 characters**, `[A-Za-z0-9_-]` only.
   `Read-Host` keeps it out of shell history. Expect `"success":true`.
2. **Watch the rate limiting.** Confirm the stagger, the longer retry window and
   the 6-hourly interval actually clear the 429s across several scheduled runs.
   This cannot be verified in one run; it needs a few days of evidence.
3. **If 429s persist,** stop making the Worker the only route, so neither the
   Worker nor a single IP carries the whole load. This is the remaining
   architectural option and has not been tried.
4. **Exercise `PAT_TOKEN`.** It is still unverified. The first run that finds a
   genuine content change will test it.
5. **Update `docs/DEPLOY.md` and this file** as the state changes. Section 2 is
   the table to edit first.

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