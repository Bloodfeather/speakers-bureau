# SpeakersBureau

A small, fast, static website that points at independent writing.

The site collects the current RSS feeds of a handful of independent Substack
publications, puts them into one reading order, adds the topic labels we assign
by hand, and links straight out to where each article actually lives.

It is a **front door**, not a library. That distinction is the most important
thing in this document, and the rest of the project is built around it.

---

## The one thing to understand before anything else

**Each publication's RSS feed returns only its most recent 20 posts.** That is a
hard limit of how Substack feeds work. It is not a setting we chose and not
something a future version can fix by trying harder.

So the site holds a **window** - roughly the last six weeks of writing - and not
an archive. When a post falls out of its publication's feed, it falls out of this
site too, and nobody is told it happened.

Every word of copy on the site respects that:

- The word "archive" appears only where we say plainly that this is **not** an
  archive.
- No page says "all articles", "every article ever", or "browse all".
- Counts and date ranges shown on the pages are computed from the dataset at
  build time, never typed by hand, so they cannot drift away from what is
  actually there.

If you are editing site copy, this is the rule that matters. A phrase that
implies history is not a style problem; it is the site claiming something the
data does not support.

---

## We do not own these publications

We do not host any article text. We do not republish full text.

Every article link leaves this site, opens in a new tab, and lands on the
author's own publication. We show the title, a short excerpt taken from the
feed's own summary field, the publication name, the topic label we assigned, and
the date. That is the whole relationship.

Adding a publication here is a **link to their public feed**, not permission to
republish them. If you ever want more than that, the answer is a conversation
with the people who write the words, not a code change.

---

## Where the writing comes from

The pipeline, end to end:

```
data/sources.yml          the feed list - the only file a human edits to add a pub
        |
scripts/fetch-feeds.mjs   validate, normalise, dedupe, sort, write JSON
        |
data/articles.json        the dataset (committed on purpose)
        |
src/pages/*.astro         Astro renders it to static HTML in dist/
```

A feed is accepted only if **all three** of these are true:

1. the HTTP `Content-Type` says XML,
2. the body parses as XML, and
3. it contains at least one item.

All three are required because a Substack publication that does not exist
returns **HTTP 200 with an HTML page**, not a 404. "It loaded in the browser"
proves nothing. This was observed, not theorised.

If any feed fails validation, the fetch script exits non-zero and writes
**nothing**. The site never rebuilds on half-valid data, and a green build on
yesterday's content - the one failure that looks like success - is designed to be
impossible.

`data/articles.json` is committed on purpose. That way the site can always be
built offline, every dataset change shows up in the project's history, and
"why is this article on the site?" is answerable with `git log`.

---

## The commands you will actually run

All of these are run from the project folder, in a terminal opened there.

| Command | What it does |
| --- | --- |
| `npm install` | Installs dependencies. Run this once after cloning, and again if `package.json` changes. |
| `npm run dev` | Starts Astro's local dev server. The site is at `http://localhost:4321/`. Edit a file and it reloads. |
| `npm run build` | Builds the static site into `dist/`. This is exactly what GitHub runs. |
| `npm run fetch` | Fetches every enabled feed, validates it, rewrites `data/articles.json`, and prints a per-source report. Exits non-zero if any feed fails. |
| `npm test` | Runs the test suite (206 tests). No network access; it does not touch `data/articles.json`. Run `npm run build` first: several tests read `dist/`. |
| `npm run events:check` | Validates `data/events.json` and prints every problem it finds, plus whether every referenced image file exists on disk. |
| `npm run preview` | Serves the already-built `dist/` locally, so you can check the real build output. |

Notes worth knowing:

- `npm run fetch` talks to the internet and is the only command here that
  changes `data/articles.json`.
- `npm test` never writes to the real dataset. It works in a temp folder and
  asserts the real file is untouched.
- `npm run build` needs `data/events.json` to be valid, because the events
  loader **throws** on a malformed file rather than rendering a partial calendar.

---

## Adding a publication

This is a small, deliberate edit. There is no other place to change.

**Step 1 - edit `data/sources.yml`.**

Copy one of the existing blocks and paste it at the end of the `sources:` list,
keeping the two-space indentation exactly as it is:

```yaml
  - id: publicationname
    name: Publication Name Shown On Cards
    feedUrl: https://publicationname.substack.com/feed
    tag: commentary
```

What each field is for:

- `id` - short, lowercase, hyphenated, and **stable forever**. It becomes an
  internal link in the site, so renaming it later breaks links that were
  already published.
- `name` - the human-readable publication name, shown on every card from it.
- `feedUrl` - the real RSS URL (see the trap below).
- `tag` - the topic we assign by hand. Optional, but recommended. Substack feeds
  carry no categories of their own, so this hand-assigned tag is the **only**
  topic system the site has.
- `enabled` - optional, defaults to `true`. Set it to `false` to keep an entry
  and its notes without reading from it.

**Step 2 - run `npm run fetch` and read the report.**

This is not optional and "it loaded in a browser" is not a substitute.

```
[ OK ] publicationname (Publication Name Shown On Cards)
       configured: https://publicationname.substack.com/feed
       resolved:   https://publicationname.substack.com/feed
       http:       200  items: 20  new: 3
       tag:        commentary
```

A rejected feed names its own reason under `reason:`. If you see `[FAIL]`, read
that line; it is the whole diagnosis.

**Step 3 - commit.** The dataset file and the feed list both go to git.

### The trap that catches everyone

A `substack.com/@name` **profile** URL is **not** a feed URL.

| You saw | That is a page | The feed URL is |
| --- | --- | --- |
| `https://substack.com/@evanmulch` | a profile page, plain HTML | `https://evanmulch.substack.com/feed` |
| `https://substack.com/@unitedpatriotsalliance` | a profile page, plain HTML | `https://unitedpatriotsalliance.substack.com/feed` |

Both of the profile forms above were tried against the live feeds and failed.
The subdomain form worked. Paste the subdomain form into `feedUrl`.

### The other trap: a bad URL does not 404

A Substack publication that does not exist answers with **HTTP 200** and an HTML
page, so every naive check passes it. The three-part rule in
`scripts/lib/validate.mjs` is what catches it. Verify with `npm run fetch` and
read the report rather than trusting a browser.

### Redirects are normal

A feed URL can redirect to a completely different host, and the final host is
what actually serves the publication. The pipeline follows redirects and records
the resolved URL, which is what gets displayed and linked. This is expected
behaviour, not a bug.

---

## The events calendar

A second dataset, `data/events.json`, with the opposite provenance: **no script
writes it.** A human writes it, or an assistant writes it from instructions.

The entries currently in it are real, dated civic events in the Upstate of South
Carolina, drawn from the organiser's own notices. Every one carries a `url` to the
page it came from, and the page tells the reader so and links to it. **If you add an
event, add its source URL too.** A civic date with no source is an assertion with
nothing behind it, and the validator cannot tell the difference - it checks shape,
never truth.

**Check facts against the source before you commit them.** On 2026-10-05 an audit
of this file found a wrong county on a polling-place instruction, a start date four
days early on the early-voting window, and two events whose notes claimed no time
had been published when the organiser had published one. All four passed
`npm run events:check` and 192 passing tests, because every automated check here
validates *shape*. The only thing that catches a wrong fact is reading the source.

Because the file has no writer, the schema is enforced hard:

- `scripts/check-events.mjs` (run it with `npm run events:check`) validates the
  file, reports **every** problem at once instead of stopping at the first, and
  checks that every referenced image actually exists in `public/img/events/`
  *and that nothing in that folder is unreferenced*.
- An unknown key is a hard error. A misspelled `loction` would otherwise render a
  row with no venue and a green build, which is the failure this guards.
- `src/lib/events.ts` throws on a malformed file, so a mistake fails
  `npm run build` instead of quietly shipping a half-rendered calendar.
- Event times are local wall clock, written as `YYYY-MM-DDTHH:MM`. Offsets are
  rejected. The file therefore holds no absolute instant, so it cannot become
  wrong because of a timezone.

The full written contract, including how to add a new event type, is in
`data/events.schema.md`.

---

## How the themes work

There are four theme choices in the footer switcher, all of them pure CSS with
no JavaScript required:

| Choice | What it is |
| --- | --- |
| Civic | The house style. Warm and institutional, serif headings, muted warm palette. The default. |
| Ledger | High-contrast print look. Near-monochrome with one brick accent. |
| Slate | Cool neutral, built dark-first. |
| Match system | Follows your operating system's light or dark setting, using the Civic colour scheme either way. |

The switcher is `src/components/ThemeSwitcher.astro`: a fieldset of radio inputs.
Clicking an option repaints the page immediately because CSS matches
`html:has(#theme-ledger:checked)`. With JavaScript available, the choice is also
remembered between visits.

**Colour values live in exactly one file: `src/styles/themes.css`.** Nothing
else in the project defines a colour. If you want a new theme, or want to
retune an existing one, that file is the only place to touch - do not hardcode a
colour into a component, or the theme stops being a theme.

---

## Pages

Seven static pages, no server, no database, no login:

| Path | What it is |
| --- | --- |
| `/` | Home: what this is, the latest writing, topic filters. |
| `/latest/` | Every article in the window, in one page. |
| `/topic/news/`, `/topic/commentary/` | One page per topic that is actually present in the data. |
| `/events/` | The events calendar. |
| `/about/` | Who we are. Deliberately a placeholder so far. |
| `/404` | Not found. |

Topic filtering happens **at build time**, so every topic is a real page with a
real URL that a search engine can index. Switching topic is a page load rather
than an instant swap. That is the deliberate trade, chosen so the site works
completely with JavaScript turned off.

---

## Publishing to GitHub Pages

A scheduled GitHub Action refreshes the dataset roughly every four hours,
commits it if anything changed, builds the site, and publishes it to GitHub
Pages.

That involves a GitHub personal access token and a handful of one-time settings
in the GitHub web interface. The click-by-click instructions, and what to do when
each step fails, are in **[`docs/DEPLOY.md`](docs/DEPLOY.md)**.

**The workflow has never been run.** It has been checked for valid YAML and for
its structure, but no run has happened, because that needs a repository and a
token first. Treat the first manual run as a real test.

---

## Where things are

| Thing | Path |
| --- | --- |
| The feed list a human edits | `data/sources.yml` |
| The fetched articles | `data/articles.json` |
| The events calendar | `data/events.json` |
| The events writing contract | `data/events.schema.md` |
| The fetch pipeline | `scripts/fetch-feeds.mjs` |
| Feed fetching, RSS parsing, validation, text helpers | `scripts/lib/` |
| The events checker | `scripts/check-events.mjs` |
| Site identity, tagline, base-path helper | `src/lib/site.ts` |
| Article loading, sorting, byline rule, date formatting | `src/lib/articles.ts` |
| Events schema as code | `src/lib/events-schema.ts` |
| Events loader (throws on bad data) | `src/lib/events.ts` |
| Month names, shared by both loaders | `src/lib/months.ts` |
| Pages | `src/pages/` |
| Components | `src/components/` |
| Base stylesheet | `src/styles/global.css` |
| **All colour values** | `src/styles/themes.css` |
| Event artwork | `public/img/events/` |
| Tests | `test/` |
| The scheduled publish workflow | `.github/workflows/refresh.yml` |
| Site build configuration | `astro.config.mjs` |
| The plan and the decisions behind it | `ROADMAP.md` |
| The work log | `build-log.md` |

---

## Requirements

Node.js 22 or newer. The project is developed and built on Node 24, and the
deploy workflow pins Node 24.
