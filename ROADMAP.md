# ROADMAP - SpeakersBureau

An aggregate site that fronts a handful of independent Substack publications,
themed as a public education / speaking organization.

## The one-paragraph version

A Node script reads a curated list of Substack RSS feeds, validates each one
strictly, normalizes them into a single JSON dataset, and an Astro static site
renders that dataset as a searchable, filterable card index. A scheduled GitHub
Action runs the fetch, commits any change, and deploys to GitHub Pages. Our own
posts are markdown files that can link out to any article in the aggregate.

## Non-negotiable design rules

These come from METHOD.md and from what the feed probes actually proved. Each one
exists because the opposite was observed to lie.

1. **RSS is the contract.** The undocumented `/api/v1/archive` JSON endpoint is
   not used anywhere in this project. It is private and can break without notice.

2. **A feed is valid only if all three hold: Content-Type is XML, the body parses
   as XML, and it yields >= 1 item.** Observed: `nostarch.substack.com/feed`
   returned HTTP 200 `text/html` for a publication that does not exist. Status
   code alone accepted it. All three assertions required.

3. **Fail loud. Never ship a stale cache.** If a fetch or a validation fails, the
   script exits non-zero and the Action goes red. A green build on yesterday's
   data is the one failure mode that looks like success. `failOnFeedError` is the
   single switch, and it defaults to true.

4. **Follow redirects and record the final URL.** Observed: a feed requested at
   one host resolved to a completely different host and publication title. The
   resolved URL is what gets displayed and linked.

5. **Verify against the live feed at least once.** A test suite over invented XML
   proves only that the parser matches the author's imagination. The live run is
   the positive control, and it writes to a throwaway directory under `%TEMP%`,
   never to the real dataset.

6. **Every run records what it actually did** - per feed: status, resolved URL,
   item count, new-item count, or the exact reason it failed. "0 new items" is a
   legitimate result and is distinguishable from "the feed was unreachable".

7. **Never point a test or probe at the real dataset.** Tests write to a temp
   directory and assert the real file's mtime is unchanged.

8. **Render dates in UTC.** A build that produces different HTML depending on the
   machine's timezone is not reproducible, and GH Pages builds run in a different
   zone than this one.

9. **ASCII only in files I author.** Type, config, code, docs, commit messages.
   Text *fetched from the internet* is exempt - the authors' curly quotes and
   em dashes are their words, not typos, and they round-trip correctly through
   UTF-8 JSON. In tests, any such character is built from its code point and the
   code point is asserted back.

## Decisions taken 2026-10-05 (client, after reviewing real captured data)

These came from asking what job the site does, not from assumption. Each one has a
consequence in the architecture, recorded so a later phase does not undo it.

| Decision | Choice | Architectural consequence |
| --- | --- | --- |
| What the site is | **A front door / reading room.** Introduce the org, present the latest writing as a curated feed, link out strongly. | Latest-only is honest. RSS holds only 20 posts per publication, so no "archive" language anywhere on the site. |
| Topic browsing | **Manual topic tags we assign** in `data/sources.yml`. | The pipeline must carry `tag` from the source into each article's `categories`. Pipeline change, not a UI concern. |
| Attribution | **Show the feed's author verbatim, but suppress it when it merely repeats the publication name.** | 23 of 40 articles report the publication as author. Never print "The Grayzone" as if it were a person. One helper, used by every card. |
| Visual direction | **Civic / institutional, warm.** Forum or town-hall rather than bureaucracy. Serif headings, generous whitespace, muted warm palette, thin rules. | - |
| Themes | **Multiple themes shipped, theming structural from the start.** | Themed via CSS custom properties on a root class, never hardcoded hex in components. Retrofitting themes onto baked-in colours is a rewrite, so this is decided now or not at all. |

### What the real data forced, recorded so it is not rediscovered painfully

Measured across the 40 captured articles, 2026-10-05:

- `dek` is empty on **40/40**. Substack RSS carries no subtitle. A card leads with
  title + excerpt. Nothing may depend on a dek existing.
- `author` equals the publication name on **23/40**. See the attribution rule.
- `categories` was empty on **40/40** before the tag plumbing was added.
- The feed returns **20 posts per publication, roughly 6 weeks** (oldest
  2026-08-20, newest 2026-10-05). There is no history in RSS at all.

The last point is the hard scope boundary. We are not a library; we are a
pointing surface. Any copy implying otherwise would be a lie the data tells.

## Architecture

```
data/sources.yml ......... curated feed list (the only file a human edits to add a pub)
        |
scripts/fetch-feeds.mjs ... validate -> normalize -> dedupe -> data/articles.json
        |
src/pages/* .............. Astro renders the dataset (static, no server)
        |
.github/workflows/refresh.yml
   every 4h: fetch, commit if changed, build, deploy to Pages
```

### Why the dataset is a committed JSON file

Astro builds at `npm run build`. If the dataset only existed in CI's memory, a
plain local `npm run build` would produce an empty site, and a failed fetch would
produce an empty site that still builds clean. Committing the dataset means the
site is always buildable offline, every change to it is visible in git history,
and "why is this article on the site" is answerable with `git log`.

## Phases

### Phase 1 - Scaffold
- [ ] `package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`
- [ ] `README.md`, `environment-log.md`, `build-log.md`
- [ ] Verify: `npm install` clean, `npm run build` produces `dist/`

### Phase 2 - Fetch pipeline (the load-bearing part)  [COMPLETE 2026-10-05]
- [x] `scripts/lib/http.mjs` - `get(url)`: per-call timeout, 2 retries with backoff,
      descriptive UA, follows redirects, returns `{ok, status, finalUrl, contentType, body}`
- [x] `scripts/lib/rss.mjs` - strict parse + normalize
- [x] `scripts/lib/validate.mjs` - the three-part rule from design rule 2
- [x] `scripts/lib/text.mjs` - HTML entity decode, tag strip, excerpt at word boundary
- [x] `scripts/fetch-feeds.mjs` - orchestrate, dedupe by guid, sort, write JSON atomically
- [x] Tests: parser, validator (including the real 200-HTML case), text utils, dedupe
- [x] Live positive control against 2 verified feeds, into a temp dir
      (result: 20 + 20 = 40 articles, exit 0; see build-log.md)

### Phase 3 - Site
- [x] Layout + global styles, public-education visual language (tokens + 3 themes,
      browser-verified - see the theme verification entry in build-log.md)
- [ ] `index.astro` - hero, latest, filterable by publication, search
- [ ] Byline rule enforced in ONE shared helper: suppress the author when it
      merely repeats the publication name (23 of 40 articles)
- [ ] Source pages, own-posts pages, 404, robots, sitemap
- [ ] Accessibility pass: keyboard nav, focus states, contrast, no color-only encoding

### Phase 4 - Automation
- [ ] `.github/workflows/refresh.yml` - cron, node cache, commit-on-change, Pages deploy
- [ ] Manual `workflow_dispatch` trigger
- [ ] GitHub repo creation, Pages configured to publish from workflow

### Phase 5 - Handover
- [ ] Swap placeholder sources for the real Substack URLs
- [ ] Naming, copy, domain

## Open items needing the user

- The actual Substack URLs (placeholder feeds in `data/sources.yml` meanwhile)
- Organization name, tagline, real domain
- Whether they want full-text search now or source filtering first