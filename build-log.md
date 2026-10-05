# build-log.md - SpeakersBureau

Most recent entry on top. This file is the crash-recovery record: after any
interruption, read the top entry, then `ROADMAP.md`, then continue.

---

## 2026-10-05 - Phase 3: the visible site (a front door / reading room)

The pages the earlier phases were building towards. Nothing about the pipeline
changed; `data/articles.json` is untouched, `scripts/` is untouched, and the
existing suite is unchanged.

### Created

- `src/lib/articles.ts` - the typed loader over `data/articles.json`, and the only
  module that knows the dataset's shape. Owns three decisions that would
  otherwise be re-made differently in four places: sort order (newest first, with
  an `id` tiebreak so the HTML cannot depend on insertion order), the byline
  rule, and date formatting. Exports `articles` (pre-sorted), `bylineFor()`,
  `bylineDecisionFor()`, `formatUtcDate()`, `machineDate()`, `topics()`,
  `articlesByTopic()`, `topicSlug()`, `topicLabel()`, `publicationNames()`,
  `summarise()`, `normalizeName()`, `isSelfAttribution()`.
  Imports no env and no Astro global, so `node --test` can import it directly
  (Node 24 strips the types).
- `src/lib/site.ts` - site identity (PLACEHOLDER name and tagline, both marked)
  plus `withBase()`, the only place that knows the deployment base path. Split
  from `articles.ts` precisely because it reads `import.meta.env`, which would
  otherwise make the loader untestable under `node --test`.
- `src/components/ArticleCard.astro` - one article.
- `src/components/ArticleFeed.astro` - a list of cards, including the empty
  state in words that are true rather than apologetic.
- `src/components/SiteHeader.astro` - masthead, placeholder-marked.
- `src/components/SiteFooter.astro` - the window disclosure, the outbound rule,
  the "feeds last checked" stamp, and the theme switcher.
- `src/components/TopicNav.astro` - topic filtering as links, plus the full
  reasoning for the build-time choice.
- `src/components/PageShell.astro` - masthead + main + footer over the existing
  `Layout.astro`.
- `src/pages/index.astro` (replaced the placeholder), `src/pages/latest.astro`,
  `src/pages/topic/[topic].astro`, `src/pages/about.astro` (deliberately a
  placeholder, with only the parts that are true today written out),
  `src/pages/404.astro`.

### The filtering decision, and what it actually costs

BUILD TIME. `src/pages/topic/[topic].astro` uses `getStaticPaths()` over
`topics()`, so every topic is a real static page. Zero JavaScript.

Chosen because the brief makes no-JS a hard requirement rather than a polish
item. Client-side filtering would have exactly one implementation and it needs a
script, so the no-JS path becomes a second implementation of the same filter that
has to be written, tested and kept in step. Build time has one implementation and
it is the HTML that is already there. It also makes every topic a crawlable URL,
which a client-side filter is not: no link on the site would point at "commentary"
for a crawler to follow. And the dataset is 23 articles across 2 topics, so the
cost is 2 pages.

What it gives up, plainly: a topic switch is a PAGE LOAD rather than an instant
swap, and there is no single document on which all topics are visible at once.
With 23 items on a static host that is a few hundred milliseconds, and the honest
fix for a reader who finds it slow is a faster host rather than a script. The
trigger to revisit is stated in the source: a dataset in the thousands, or dozens
of topics, and per-topic pages stop being free.

`/latest/` exists because of the same reasoning from the other direction: with a
front page showing 6 articles and topic pages showing one topic each, without
`/latest/` there is no page that holds the whole window, and a reader on a topic
page would have to visit each topic and merge them mentally.

### Dates

Every date on the site goes through `formatUtcDate()`, which calls
`getUTCDate()` / `getUTCMonth()` / `getUTCFullYear()`. There is no local-time
path. This is a real trap and it is documented at the function: an article
published at `2026-10-02T02:00:00Z` renders as "2 October" on the UTC GH Pages
runner and as "1 October" on this UTC-4 machine, so the same commit would produce
different HTML on two machines, which ROADMAP design rule 8 forbids - and it
would look like a data bug rather than an environment bug.

Month names come from a twelve-element table, NOT `Intl.DateTimeFormat`. ICU data
lives on the build machine, so `'en-GB'` can render the right month here and
something else on the runner; a literal has no ICU dependency and is assertable.
Ordering also has an `id` tiebreak for the same reason.

### Attestation: the real data forced three things

- **`dek` is empty on 23 of 23.** The card renders it conditionally and reserves
  NO space for it. Verified in the built HTML, not assumed: 0 rendered
  `card__dek` paragraphs on every page, with the inlined stylesheet stripped so a
  CSS rule could not be mistaken for a rendered element.
- **3 of 23 excerpts are under 40 characters and one is 12.** No `min-height`, no
  `line-clamp`, no fixed line count on the excerpt. Clamping would hide the end
  of the long ones and a min-height would leave a hole in the short ones. A short
  card is allowed to be shorter than its neighbours.
- **The byline suppression needed a normalised comparison, not `===`.** On this
  dataset `author` is "United Patriots Alliance" against publication
  "United Patriots Alliance News" on 2 articles - they differ by one trailing
  word, so strict equality would have printed the publication as a person on
  exactly the articles the rule exists to prevent. `isSelfAttribution()`
  normalises: lowercase, apostrophes deleted (not spaced, or "Evan's Substack"
  becomes "evan s" and stops matching "Evan"), leading articles and trailing genre
  words dropped. Measured result: 21 of 23 bylines printed, 2 suppressed.

### Copy: the honesty constraint, and how it was checked

No section says archive, library, "all articles", "every article ever" or
"browse all". The window disclosure ("each publication's feed returns only its
most recent posts, so this is a window onto what is being written now, not an
archive") is on the home page, on `/latest/`, on every topic page and in the
footer, because a topic page reached from a search result has no home page above
it to set expectations. All counts and date ranges on the pages are computed from
the dataset by `summarise()` and `formatUtcDate()`, never typed, so they cannot
drift away from the data.

The word "archive" does appear in the built HTML. Every occurrence was read: two
are the explicit negation in the disclosure, and the third is inside an author's
own excerpt text ("go to the archive tab on ... and typing..."), which is their
sentence, not ours. One draft line of ours ("we link out to every article") was
reworded after that audit, because in a page about a bounded window it reads as
a completeness claim.

### Verified (real output, not assumed)

- `npm run build` -> `7 page(s) built in 790ms`, `Complete!`, `$LASTEXITCODE=0`.
  Routes: `/404.html`, `/about/`, `/events/` (NOT this phase - a concurrent agent
  added it), `/`, `/latest/`, `/topic/news/`, `/topic/commentary/`. This phase
  authored 6 of the 7.
- `npm test` -> `tests 134, pass 134, fail 0`, `$LASTEXITCODE=0`. Up from 104, but
  NOT all 30 are this phase's: the concurrent Events phase added
  `test/events.test.mjs`. This phase added no tests and broke none.
- Built-HTML measurement of `dist/latest/index.html` (52,920 bytes): 23 outbound
  links with `rel="external noopener noreferrer"`, 23 `target="_blank"`, 23
  visually-hidden "opens in a new tab", 23 arrow glyphs, 23 `card__excerpt`,
  **21 `card__byline`**, 23 `card__image`, **0 `card__dek`**, 1 `<script>` (the
  theme script alone). 22 distinct dates rendered, all UTC, oldest
  "23 June 2024". Every one of the 23 dataset URLs appears as an `href` on
  `/latest/`; zero missing.
- Non-ASCII byte scan of all 13 authored files, counting raw bytes > 127:
  **0 in every file**, 82,301 bytes total. No BOM in any file.
- Hex audit: **0 colour literals in any authored `.astro` or `.css` file**,
  independently of the existing suite. `test/theme-contrast.test.mjs` scans 17
  files under `src/` and passes; `themes.css` is still the only holder.

### Errors hit, and the one that cost real time

1. **`Expected "}" but found ":"`, reported at a comment line ~30 lines from the
   cause.** The build failed for about 40 minutes and bisecting found nothing
   wrong with the imports, the TypeScript, the try/catch, the multi-line JSX
   expressions, the numeric HTML entity, the JSX comments, or the number of
   expressions in the template - every one of those was tested and eliminated.
   The actual cause: **Astro's frontmatter regex is `/^---(.*?)^---/ms`, which
   is NON-GREEDY.** A `---` separator line typed into the middle of a frontmatter
   comment block closes the frontmatter there, and every import and every line of
   TypeScript after it is silently re-parsed as page markup. Proven by reading
   `node_modules/astro/dist/vite-plugin-astro/utils.js:2` and by feeding the
   emitted compiler output straight to esbuild, which isolated the failure to
   ArticleCard alone while all 12 other `.astro` files passed.
   Fixed by removing the stray fence line, and the trap is now written into the
   component's own header comment so the next person does not pay for it again.
   The bisect scripts were kept in `%LOCALAPPDATA%\Temp\opencode\`, never in the
   project folder.
2. **Angle-bracketed words in frontmatter comments.** A second, separate hazard
   found by the same bisect: the compiler scans frontmatter for what looks like a
   component reference and does not know it is inside a `//` comment, so
   `<publication-subdomain>` was rewritten into a `renderComponent()` call inside
   the emitted template literal. Three more instances were found by a scan of
   every authored file and removed. The scan is repeatable; the finding is that
   neither backticks nor angle brackets nor `---` are safe inside a frontmatter
   comment in this Astro version.
3. **`catch {` (optional catch binding) rejected by esbuild** with a misleading
   `Expected "}" but found ":"`. The target is not ES2019+. Changed to
   `catch (error)`, which is also more informative.
4. **The apostrophe-stripping regex I first wrote was `['']`** - an empty
   character class, matching nothing, so it would have silently passed every
   byline test while doing nothing. Fixed to `/[\u0027\u2019]/g`: built from code
   points, never typed, per the project's own rule. Caught by reading the regex
   back rather than by a test failing, which is the point of that rule.
5. **`articles.ts` and the concurrent `months.ts` now hold two copies of the
   month table.** I collapsed mine to an import and the suite correctly failed
   (`could not find a MONTHS array`), because that test compares the two sources
   textually. Reverted deliberately, with the duplication documented in both
   files and guarded by that test rather than left as a silent third copy. The
   real fix is moving `articles.ts`'s dataset import behind a function so the pure
   helpers can be imported alone; that touches the module everything depends on,
   so it is flagged rather than done inside this phase.
6. **`ROADMAP.md` says the dataset has 40 articles; it has 23.** The 40 figure is
   from the earlier thefp + grayzone probe set. `data/sources.yml` now carries
   `unitedpatriotsalliance` (20 items) and `evanmulch` (3 items). All page copy
   derives its counts from the data, so the site is correct; the roadmap's
   measured-facts paragraph is stale and should be refreshed by whoever owns it.

### State

- 6 pages authored, all reachable with JavaScript disabled: `/`, `/latest/`,
  `/topic/news/`, `/topic/commentary/`, `/about/`, `/404.html`. Zero JavaScript
  was added by this phase; the only `<script>` on any page is the pre-paint theme
  script that already existed.
- Not looked at in a browser. Every number above is computed from the built bytes.
  The visual direction (civic / institutional but warm) is asserted nowhere but in
  the stylesheet, and Phase 2.5's own log entry made the same point about the
  themes. Opening `/` and `/topic/news/` in all four themes is the outstanding
  check.
- Site name, tagline and intro remain PLACEHOLDER, marked with
  `data-provisional` attributes in `src/components/SiteHeader.astro` so the swap
  is findable by grep.
- Still not a git repo. No `git init`, no commit, nothing staged by this phase.

---

## 2026-10-05 - Phase 3.5: the Events Calendar

Agent Two, working alongside the primary agent. Read this entry before touching
anything in `src/lib/events*`, `src/lib/months.ts`, `src/pages/events.astro`,
`src/components/EventRow.astro`, `data/events.*`, `scripts/check-events.mjs` or
`test/events.test.mjs`.

### THE ONE THING TO KNOW FIRST

`data/events.json` has **no writer**. That is the whole design, and it differs
from `data/articles.json` in the one way that matters: articles.json is written by
`scripts/fetch-feeds.mjs`, so its shape is guaranteed by the code that writes it,
and events.json is written by a person or an AI assistant, so its shape is a
promise. A misspelled field here does not crash - it renders a page that looks
finished and is wrong. Every unusual-looking decision below traces back to that.

### Created

- `src/lib/events-schema.ts` - the schema as CODE. A field table, a closed type
  vocabulary, wall-clock date rules, and the formatting functions. Pure: no
  dataset import, no Astro global, no filesystem, so three callers share it.
- `src/lib/events.ts` - the loader. Imports the JSON, validates, and **throws**
  with every problem listed. This is the one deliberate departure from the
  project's fail-safe habit, and the reasoning is in the file header: a stale
  article feed is not a lie (the articles happened), but a malformed UPCOMING
  event is the site asserting something untrue about a date somebody might turn up.
- `src/lib/months.ts` - the twelve month names, extracted so importing a month
  name does not drag `articles.json` in with it.
- `src/pages/events.astro` - the calendar page and the CSS selection mechanism.
- `src/components/EventRow.astro` - one row: a radio, a label, a thumbnail.
- `data/events.json` - 7 sample events.
- `data/events.schema.md` - the written contract for whoever fills that file in.
- `scripts/check-events.mjs` + `package.json` script `events:check`.
- `public/img/events/` - 11 placeholder SVGs (6 thumbs, 5 banners).
- `test/events.test.mjs` - 30 tests.

### Changed

- `src/components/SiteHeader.astro` - ONE line added to `navItems`:
  `{ href: '/events/', label: 'Events' }`. Without it the page is unreachable.
  This is the only edit to a file the reading-room work also owns.
- `package.json` - ONE line added to `scripts`: `events:check`.
- `ROADMAP.md` - Phase 3.5 section, with the decision table and the known
  follow-ups.

Nothing else was touched. In particular `src/lib/articles.ts` was NOT edited, see
the follow-ups below.

### Verified, with real output rather than assertion

- `npm test` before: `tests 104, pass 104, fail 0`. After: `tests 134, pass 134,
  fail 0`. **30 added, none removed.**
- `npm run events:check` on the committed file: exit 0, 7 events,
  `images referenced: 11 / found: 11 / missing: 0`.
- All 11 images return HTTP 200 from the dev server.
- `http://127.0.0.1:4399/events/` returns HTTP 200, 106458 bytes.
- **A malformed dataset refuses to render.** Verified end to end, not assumed:
  `data/events.json` was temporarily given `type: "Keynote Address"`, the dev
  server returned **HTTP 500** for `/events/`, and the file was restored
  **byte-for-byte** (SHA-256 identical before and after). This is the answer to
  "if this were broken, how would I find out?" - it is a red render, not somebody
  noticing a page looks wrong.

### FIVE DEFECTS FOUND BY THE WORK, recorded because the fix is not the lesson

1. **`IMAGE_PATH_RE` allowed `/img/../secret`.** The character class included a
   literal `.`, and `scripts/check-events.mjs` joins an accepted path onto
   `public/` and stats it. A hand-edited data file could have pointed the checker
   anywhere on the disk. Fixed by making the pattern segment-based, so `..` is
   unrepresentable rather than merely unlikely.
2. **The typo suggester could not suggest.** It counted mismatched POSITIONS, so
   `loction` against `location` - one inserted character - scored 5 and produced
   no suggestion. The one typo an author is most likely to make was the one case
   it could not help with. Replaced with a real Levenshtein distance.
3. **A BOM broke the whole file, confusingly.** Found by a probe that happened to
   write its scratch file with PowerShell's `Out-File -Encoding utf8`, which adds
   one; Notepad does the same. `JSON.parse` rejects a leading BOM, and the error
   points at the opening brace with "unexpected token", which sends an author
   hunting for a syntax error that is not there. The CLI now strips it and says
   so, and a test asserts the committed file has none.
4. **The checker's report opened with its findings and buried its subject.**
   `printProblems` wrote straight to stdout before the buffered report, so the
   problems appeared ABOVE the `events: <path>` header. Now pushed into the report
   so the file is named first. Found only by running the tool on a deliberately
   broken file - the tests assert behaviour, never the order a human reads.
5. **`const score` was assigned to** inside the old suggester. A plain TypeScript
   error, caught the moment the module was first imported.

### TWO CLAIMS IN THIS REPO THAT ARE FALSE, corrected in the open

- **`src/lib/articles.ts` says "`node --test` can import it directly (Node 24
  strips the types)".** No test in the repo imports that module, so the claim was
  never exercised - and it is **false as written**: Node's ESM resolver cannot
  resolve an extensionless relative import, so `import './months'` fails with
  `ERR_MODULE_NOT_FOUND` even though tsconfig sets `moduleResolution: Bundler`.
  The events code therefore uses explicit `.ts` specifiers, which are legal
  TypeScript here (`allowImportingTsExtensions: true`) and legal ESM. Fixing
  articles.ts's comment is a one-word change in a file owned by the reading-room
  work and was deliberately not made underneath its owner.
- **The sample data did not cover every type.** A test asserting all seven types
  appear failed, because the election-day entry had been written as a `Lecture`.
  The data was wrong, not the test. It is now an all-day `Election`.

### The selection mechanism, and the one thing that can silently break it

The panel for an event is shown by a hand-written selector in `events.astro`:

    html:has(#event-input-<id>:checked) [data-panel='<id>'] { display: block }

**There is no script on this page.** Selection is CSS, exactly as the theme
switcher already does it, which is why it cannot flash and cannot desync from its
own state.

The cost is that those selectors are hand-written: Astro scopes component CSS and
there is no way to generate one from a JSON array. So **adding an event without
adding its line produces a page where the row is selectable and its panel never
appears** - no error, green build, feature silently dead. Two defences:

- `test/events.test.mjs` asserts every event id has a matching selector. This
  caught the real instance of it during development.
- `data/events.schema.md` section 10 makes it step 2 of the checklist.

### Deliberately NOT done, so absence is not read as oversight

- **No type filter.** Needs URL or script state; both are out of scope for a page
  that must work without either. The vocabulary is closed and the present set is
  derived from the data, so a filter is a page-only change, not a data change.
- **`eventTypesPresent()` is exported and tested but no page uses it.** It exists
  for that filter. It is not a feature.
- **No `articles.ts` refactor** to import `src/lib/months.ts`. A test asserts the
  two MONTHS tables are equal, so a drift fails the suite rather than rendering
  two different month names on two pages.
- **No CI wiring.** `refresh.yml` runs only `npm run fetch` and `npm run build`
  and never `npm test`, so the events tests do not run on GitHub. The build-time
  throw is what guards the deployed site.
- **No absolute UTC instant per event**, so no daylight-saving arithmetic and no
  dependency. The zone is a human label. Stated as a limitation in
  `data/events.schema.md` section 5 and in the schema source.

---

## 2026-10-05 - Events Calendar: browser verification and adversarial review

Second pass on the Events Calendar, after the feature was complete and green.
Three sub-agents: one measuring it in a real browser, one trying to REFUTE its
central claim, one closing the test gaps the refuter found. The headline:
**the suite was green the whole time and the desktop layout was broken anyway.**
Both are recorded below.

### The claims that survived, verified rather than argued

Driven with real Chrome over CDP. Achieved `innerWidth` reported for every figure;
a width sweep of 1440/1200/900/600/390/320 came back six of six exact, so the
override was proven to move before any narrow-layout claim was believed.

- **Selection is pure CSS and works.** No `<script>` on the page. A real mouse
  press on `riverside-water-forum` swapped the visible panel; exactly one
  `[data-panel]` visible at all times; the other six `display: none`.
- **Banner images genuinely fetch**: `naturalWidth 1600` x `naturalHeight 600`,
  `complete: true`. Not merely a `src` attribute.
- **Keyboard**: 7 real Tab presses land on the radio group, `matches(':focus-visible')`
  true, arrow keys move between events.
- **Phone (390)**: panel stacked above the list (`panel.bottom 1065.5` vs
  `list.top 1130.8`), `position: sticky`, pins at its computed `top` on scroll and
  returns on scroll-back. No horizontal overflow.
- **No console errors, no exceptions, no failed requests** on the events page.

### SEVERE, and it shipped with 34/34 green: there was no focus ring

`src/pages/events.astro` styled another component's classes:

```css
:global(.events__item:has(.events__radio:checked)) .row { ... }
```

**`:global()` un-scopes only what is to its LEFT.** Astro still appends the page's
scope id to the final compound, so that compiled to
`.row[data-astro-cid-<events.astro>]`, while `.row` is rendered by
`EventRow.astro` and carries `data-astro-cid-<EventRow>`. **The rule matched zero
elements.** Confirmed directly in the served HTML: every row renders as
`<label class="row" ... data-astro-cid-rpxclvhs>`, `rpxclvhs` being EventRow's id.

Consequence: the radio is `clip-path: inset(50%)` so it cannot paint a focus ring
itself, and the rule meant to paint the ring on the label matched nothing. **A
keyboard user had no visible focus indicator anywhere on the page.**

Fixed by moving both rules into `EventRow.astro`'s own scoped block, where
`.events__item`, `.events__radio` and `.row` share one scope id. Re-verified after
the fix: `outline-style: solid`, `outline-width: 3px`, on the focused row and on
no other, in all three themes - contrast **7.58:1** civic, **10.53:1** ledger,
**8.31:1** slate, against a 3:1 requirement for non-text UI. The selected-row
accent bar measures `2px` border and `16px` padding against `0px`/`0px`
unselected, exactly one row carries it, and it moves with the click.

**Why the suite could not see it**, which is the lesson rather than the bug:
`node --test` cannot compare a scope id; a browser can, in one line. This is the
case for `METHOD.md` section 8 - the defect lived in a layer no assertion in this
repo can reach, and only looking found it. `test/events.test.mjs` now fails if
`events.astro`'s style block names any class owned by another component.

### The other five real defects the refuter found, all fixed

| Defect | Why it mattered | Fix |
| --- | --- | --- |
| `ends-before-starts` **inert for every all-day event** | `Date.parse` returns NaN for a date-only value and `NaN < NaN` is false, so `2026-11-03` to `2026-10-01` validated clean | compare `wallClockToSortable` integers |
| `wallClockToSortable` produced **non-comparable numbers** | 4 digits for `18:30`, 6 for `18:30:00`, so `20261114183000 > 202611142000` and an 18:30:00-20:00 event read as ending first | always pad to `HHMMSS` |
| `maxLength` enforced for **4 of 13** field kinds | a 4000-character URL validated clean | one check before the kind switch, for the kinds where length is the real constraint |
| Root typo suggester searched the **wrong vocabulary** | `reviewedAon` got no suggestion; `event` got the illegal `Did you mean "event"?` | pass the legal key list for the level being checked |
| An id beginning `input-` **collides with another row's radio id** | panel id `event-input-x` equals the radio id of an event called `x`, so `aria-controls` points at the wrong element | new `reserved-id-prefix` reason |

The second was **found by the first fix**: giving `wallClockToSortable` a second
caller exposed a latent bug in it. That is the ordinary way latent bugs surface,
and it is why "give this a second caller" is a better review question than "does
this work".

### Comments that documented bugs as features, now corrected

Seven in total, all found by the refuter and all removed or rewritten. The two
that mattered most:

- The row's `<noscript>` fallback rested on the premise that "without scripting the
  radios do nothing useful". **Radios are not scripting** - `:checked` and `:has()`
  are both CSS - and the fallback was dead anyway, pointing at a `display: none`
  panel with no `:target` rule to reveal it, while a comment described it as "a link
  that works, not a disabled control". Removed rather than repaired: the honest
  answer is that there was never a fallback to provide.
- The meta description said "Each row carries a thumbnail; select one to see its
  details and banner". Checked against the data, **three of seven rows contradict
  it**. That is the failure this project exists to prevent, expressed in prose
  instead of in a field. Now derived from the data and true of every row.

Also: an unreachable `eventCount === 0` empty state was deleted (the schema rejects
empty arrays, so it could never render), and a stale comment of mine still pointing
readers at `events.astro` for the `:has()` rules was removed.

### Tests: 104 -> 143, none removed

Nine added by the gap-closing agent, each verified to FAIL when its fix is
reverted - by rebuilding the revert in a sandbox copy under `%TEMP%` and reading
the failure. Two results worth recording:

- The timezone test's comment **overclaimed**. It proves the output does not vary
  by machine `TZ`, which is the real requirement - but the refuter showed a
  local-accessor implementation can still pass it, because the fixtures are wall
  clocks and `TZ` only bites on UTC instants. Corrected to claim invariance and not
  correctness, and given teeth by asserting every row against an explicitly expected
  string. Verified: breaking `formatClockTime` so midnight renders `0:30 am` now
  fails it, where before it passed.
- The existing root-suggestion test was **passing on boilerplate** - its regex
  matched the error sentence's own text, `the top level accepts only "events" and
  "reviewedOn"`. Tightened to the full phrase.

### A number that was a documented fiction, corrected

`startsAt` declared `maxLength: 16` while the legal 19-character
`2026-11-14T18:30:00` was accepted - and that table is what
`data/events.schema.md` publishes as the field's maximum. A number smaller than a
valid value, published to exactly the reader least able to check it. Now 19. The
limit stays **unenforced** on purpose, because enforcing it masked
`timestamp-has-offset`, which is the diagnostic that matters.

### FOUND, NOT FIXED: a severe pre-existing bug in the THEME system

Reported by the browser agent, in `src/layouts/Layout.astro` and
`src/styles/themes.css`. **Neither file is part of this work and neither was
touched.** Recorded because it is severe and because the next session should not
have to earn it again.

**Symptom.** Pick `slate`, reload. `data-theme="slate"` and the slate palette
apply - but the switcher shows `civic` as selected, and the page reports
`color-scheme: light` while painting slate's dark background.

**Mechanism, both halves.**

1. `Layout.astro`'s pre-paint script restores the stored theme's radio with
   `document.getElementById('theme-' + stored)`, but it runs in `<head>` before any
   radio exists, so that returns `null` and the assignment is silently skipped. The
   switcher always shows whatever the server rendered, which is `civic`. The comment
   above that code claims it checks the radio "so the switcher shows the active theme
   on first paint" - it does not, and never did. `test/theme-contrast.test.mjs`
   asserts the script's presence and shape, never its effect, which is why this is
   invisible to the suite.
2. Worse, `themes.css` gives the no-JS `:has()` path the higher specificity:
   `html:has(#theme-civic:checked)` computes above `html[data-theme='slate']`. Since
   the civic radio is always checked, **its `color-scheme: light` overrides the stored
   theme's scheme** while the palette comes from slate. `light-dark()` and
   form-control theming both depend on `color-scheme`, so both break. The same
   mechanism means a reader on a dark OS lands on a forced-light page until they pick
   System by hand.

Also reported and unfixed: `favicon.ico` 404s. The site ships banner SVGs and no
icon. Cosmetic, and a project-wide decision rather than an events-page one.

### Coordination notes, updated

- `npm run build` still fails in `src/components/ArticleCard.astro`, mid-rewrite by
  the reading-room work (`/latest/` returns 500). Untouched here. `/events/` renders
  and is verified independently.
- **One line was added to `src/components/SiteHeader.astro`** (the `Events` nav
  entry). Keep it or the page is unreachable.
- `src/lib/events*.ts` use **explicit `.ts` import specifiers**. A formatter that
  "tidies" them extensionless will break `npm test` and `npm run events:check` while
  `npm run build` keeps passing - see environment-log.md.

---

### The one deliberate editorial change, flagged rather than made silently

`EVENT_TYPES` contains **`Lecture`** singular. The brief listed "Lectures"; six of
the seven entries were singular and a chip reading "Lectures" is a grammar error in
a filter row. One-word revert if that was not the intent.

### Coordination notes for the primary agent

- `npm run build` currently fails in `src/components/ArticleCard.astro`, which was
  mid-rewrite by the reading-room work throughout this task (`/latest/` returns
  500). **Not caused by, and not fixed by, this work** - that file is untouched
  here. `/events/` renders independently.
- One line was added to `src/components/SiteHeader.astro`. If that file is
  rewritten, keep the `Events` nav entry or the page becomes unreachable.
- `events.astro` uses explicit `.ts` import specifiers into `src/lib/`. If a
  formatter or a linter rewrites them extensionless, `npm run events:check` and
  `node --test` will both break with `ERR_MODULE_NOT_FOUND`.

---

## 2026-10-05 - Phase 4: Automation (workflow written, NEVER EXECUTED)

### Created

- `.github/workflows/refresh.yml` - one workflow, two jobs: `refresh` (fetch,
  measure, commit if changed) and `deploy` (build, upload, publish), with
  `deploy` carrying `needs: refresh`.
- `docs/DEPLOY.md` - click-by-click setup for a first-time GitHub Desktop user:
  publish the repo, create the PAT, add the secret, enable Actions, set the
  Pages source, add the domain, then run it manually once and read the result.
  Includes the open `astro.config.mjs` items and the "which of the three phases
  is which" table.

Nothing was committed, no remote was created, `git add`/`git commit`/
`git remote add` were not run. `git status --short` shows `.github/` and `docs/`
untracked and nothing else new from this phase.

### THE DECISION: a failed feed does NOT publish. It only goes red.

The brief asked for this to be argued rather than assumed. The decision is one
workflow with two jobs and `needs:`, not two independent workflows.

**The decisive argument is about cost, not about taste.** GitHub Pages RETAINS
the last successful deployment. A failed fetch therefore does not take the site
down - it fails to refresh it. Blocking the deploy costs exactly zero
availability. Since it is free to block, there is no reason to publish, and two
reasons not to:

1. After a failed fetch the dataset on disk is UNCHANGED, so a deploy would
   republish byte-identical content under a fresh "deployed" timestamp implying
   freshness that does not exist. That is the lie design rule 3 exists to
   prevent, wearing a success badge.
2. With two independent workflows, a red run and a green deploy sit side by side
   in the Actions tab and read as contradictory. One workflow with `needs:`
   shows the truth directly: red refresh, grey skipped deploy.

The one case this costs something: if the FIRST run's fetch fails, the site has
never been published at all. That is the documented exception, and the answer
is a red action, which is correct. Everything after that is free.

The brief's stated instinct was "red but still publish". I disagreed and said so
in the workflow file itself, where a future editor will actually read it.

### Credentials: `PAT_TOKEN`, Contents read/write, one repository

Fine-grained PAT, resource owner = the repo owner, repository access = **this
repo only**, and exactly ONE permission: **Contents: Read and write**. That is
the minimum for `git push` of a dataset commit. Explicitly NOT granted:
Workflows (the workflow never edits its own definition), Administration,
Secrets, Pages, Actions. Stored as the repository secret `PAT_TOKEN`, matching
`${{ secrets.PAT_TOKEN }}` in the file exactly.

Stated plainly in the workflow header: `GITHUB_TOKEN` would also be able to
push and is the honest alternative. The PAT was chosen because it is
repo-scoped and independent of the default workflow token permissions setting.

`persist-credentials: true` on the checkout job (the default, written
explicitly anyway) is what makes the credential usable by the later
`git push` without a secret ever appearing on a command line. The deploy job's
checkout sets it to `false` - that job pushes nothing.

### The `on:` -> `true` boolean trap, and a correction to the brief

The brief stated that `on:` parses as the BOOLEAN `true`. That is true for YAML
**1.1** and FALSE for the YAML **1.2 core schema**, which is what this
project's `yaml` package uses by default. Verified directly, same bytes, both
schemas:

    parse('on:\n  a: 1\nn: 2\n')                  -> {"on":{"a":1},"n":2}
    parse('on:\n  a: 1\nn: 2\n', {version:'1.1'})  -> {"true":{"a":1},"false":2}

So an assertion written against `doc.on` passes under 1.2, and one written
against `doc[true]` passes under 1.1. Neither is correct on its own. The check
resolves the key first (`doc['on'] ?? doc[true]`), asserts the OTHER key is
absent under each schema, and then runs every structural assertion through the
resolved handle. That is the only version that cannot pass for the wrong reason,
and it matches how GitHub's own parser looks the key up.

The first run of the checker also caught a second wrong assumption: my initial
test asserted `!!triggers.workflow_dispatch`, and `workflow_dispatch:` with no
value parses to `null`, so the truthiness test failed on a value that was
present and correct. Now asserted with `hasOwnProperty`.

### Change detection: the real problem was bigger than "check git diff"

The brief asked for a `git diff --quiet` style check. That check alone is
**wrong for this dataset**, because `generatedAt` is a fresh ISO timestamp on
every run. The file is byte-different every 4 hours no matter what the feeds
did, so a plain `git diff --quiet` would NEVER report "unchanged" and the repo
would collect a timestamp-bump commit six times a day forever.

The measure step therefore drops `generatedAt`, recursively sorts object keys
(so a key reorder is not a content change), and diffs article **ids** to
produce real added/removed counts. It compares against `HEAD:data/articles.json`
taken before the commit. When nothing changed, a guarded step runs
`git checkout -- data/articles.json` so the tree is clean, and the commit step
is skipped by `if: steps.dataset.outputs.changed == 'true'`.

`fetch-depth: 0` was chosen even though depth 1 would also have had the
committed copy, because this job creates a real commit in that history and
ROADMAP promises `git log` answers "why is this article on the site". The
deploy job's checkout uses the default depth 1 and persists no credentials.

### Verified (real output, $LASTEXITCODE checked on every command)

All three checks were written to
`%LOCALAPPDATA%\Temp\opencode\`, never to the project folder. The project gained
no scratch files.

- **YAML structure check**: `RESULT: 66 passed, 0 failed`,
  `$LASTEXITCODE=0`. Asserts both schemas parse; the boolean-key behaviour
  shown above with the negative controls (1.2 doc must NOT answer to `true`;
  1.1 doc must NOT answer to `"on"`); cron string; `concurrency` group with
  `cancel-in-progress: false`; top-level `contents: read`; refresh job
  `contents: write`; checkout `ref`/`fetch-depth: 0`/`persist-credentials`/
  token; Node `'24'` as a string; `npm ci`; and the critical step asserted to
  have NO `continue-on-error`, NO `|| true`, NO `--allow-partial`.
- **Change-detection logic check**: `RESULT: 23 passed, 0 failed`,
  `$LASTEXITCODE=0`. This **extracts the embedded `node -e` script out of the
  parsed workflow file** rather than testing a copy, so a future edit to the
  workflow cannot leave the test green against stale code. Seven cases:
  - identical content + moved timestamp -> `changed=false`, so the commit step
    is skipped (the churn case the brief was worried about, reproduced and
    closed)
  - one article added -> `changed=true, added=1`
  - one article removed -> `changed=true, removed=1`
  - **no article change but a resolved URL moved -> `changed=true` with
    `added=0 removed=0`.** The dataset genuinely changed; the counts honestly
    report zero article movement. This is the case that proves the comparison is
    on content, not only on the id list.
  - reordered JSON keys -> `changed=false`
  - 40 -> 41 articles with 6 added and 5 removed -> exact arithmetic
- **ASCII scan**: both new files, `0` bytes and `0` code points above 0x7F, no
  BOM, no CRLF, no tabs. The known-bad characters (U+2014, U+2013, U+2018/9,
  U+201C/D, U+200B, U+00A0, U+00AD, U+FEFF) were each searched for **by code
  point built from its number**, with a positive control proving a constructed
  U+2014 IS detected by the same scan. Zero non-ASCII in the existing
  `build-log.md` confirmed before this entry was appended.
- `npm test` -> `tests 104, pass 104, fail 0`, `$LASTEXITCODE=0`. Unchanged.
- `git status --short` -> `?? .github/`, `?? docs/`, `?? src/lib/`. `git log -1`
  -> `20b499f`, the pre-existing commit. `git remote -v` -> empty.

### NOT VERIFIED. State this to the client.

**This workflow has never been executed.** It cannot be: there is no remote and
there is no `PAT_TOKEN`. Specifically unproven:

- that `npm ci` resolves on a clean Ubuntu runner (a lockfile that works here
  can still hit an install-script gate on npm 11; see the Phase 1 log note)
- that `npm run fetch` succeeds from the runner, including egress to
  `*.substack.com`. Proven only from this machine.
- **the `git push` authentication.** This is the highest-risk unproven step and
  the one no local check can touch.
- that `BASE_PATH` arrives from the repository variable (the variable does not
  exist yet)
- that Pages is configured with source "GitHub Actions" and accepts the artifact
- the `concurrency` behaviour under a real collision
- the deploy-skipped-on-fetch-failure behaviour in the real Actions UI
- the cron actually firing on schedule

Everything asserted about structure is asserted. Everything asserted about
runtime is assumption, clearly labelled as such.

### Errors hit and fixed

1. **Seven assertions failed on the first checker run.** Two causes. The boolean
   trap: the brief's premise was wrong about this parser, fixed by resolving the
   key and testing both schemas, as above. And the commit-identity check
   grepped the whole run block for `github-actions`, which appeared in the step's
   own comment explaining why it does NOT use the bot identity - a false failure
   caused by the test reading prose. Fixed by extracting the actual
   `git config user.*` values and asserting on those.
2. **`workflow_dispatch:` parses to `null`,** so the truthiness assertion failed
   on a correct file. Fixed with `hasOwnProperty`.
3. **Both new files lacked a trailing newline.** Confirmed the `write` tool
   strips one, and that `ROADMAP.md`, `data/sources.yml` and
   `scripts/fetch-feeds.mjs` are the same in this project. YAML and Markdown
   parse identically without it. Reported as a NOTE rather than hidden, rather
   than pretending it passed.

### Disagreement with the brief, stated plainly

- The `on:` -> `true` premise was wrong for this project's parser. Corrected
  above rather than quietly working around, because a check written to the
  wrong premise is a check that will mislead whoever maintains it next.
- `git diff --quiet` alone would not have prevented the empty-commit churn, for
  the `generatedAt` reason above. Implemented content comparison instead. This
  is the single most important implementation detail in the phase.
- Two workflow files were considered and one was written. Documented at the top
  of `refresh.yml`; folding deploy in is what makes `needs:` express "a failed
  feed blocks publication" as structure rather than as an `always()` that
  someone can later "fix".
- `BASE_PATH` is read from a repository **variable** rather than hardcoded,
  because the repo name is not chosen yet. The workflow emits a `::warning::`
  annotation when it is unset rather than guessing, since `/` is correct for a
  custom domain and wrong for a project Pages URL and the workflow cannot tell
  those apart.

### State

- 104 tests, 104 passing.
- `.github/workflows/refresh.yml` and `docs/DEPLOY.md` written, untracked, not
  committed (the lead owns the commit).
- `astro.config.mjs` NOT touched, as instructed. Its `site:` placeholder
  (`https://example.org`) still poisons canonical URLs, sitemap and RSS, and
  `docs/DEPLOY.md` records it as a handover blocker rather than a detail.
- ROADMAP Phase 4: the first two items are written but UNPROVEN, and the third
  (repo creation, Pages configured) belongs to the client. Not ticked, because
  nothing in this phase has been executed.
- `src/lib/` shows as untracked in git status. Not created by this phase and
  not touched by it.

---

## 2026-10-05 - Canonical repository moved to Documents/GitHub/Speakers/Speakers

### What changed

The client created a git repository by hand at
`C:\Users\SCSpeakers\Documents\GitHub\Speakers\Speakers` (one commit,
`.gitattributes` only, no remote) and asked for the work to live there. The
working copy had been at `Desktop\The TARDIS\SpeakersBureau`. **That repo is now
canonical; this file lives in it.**

Connected rather than moved, so nothing was duplicated or lost:

1. `git remote add local <path>` from the working copy.
2. `git fetch local`, then
   `git merge local/main --allow-unrelated-histories --no-commit`.
   The client's `.gitattributes` (`* text=auto`) came across cleanly. Only one
   file was added by the merge; no conflicts.
3. Committed, then fast-forwarded the client repo with
   `git fetch <source> main` + `git merge --ff-only FETCH_HEAD`.

Result: **4 commits, 65 tracked files, clean tree**, both sides sharing history.

### A git refusal worth recording

`git push local main` was **rejected**: `receive.denyCurrentBranch` refuses a push
to the branch checked out in a non-bare repository. Verified afterwards that the
client repo was completely untouched - 1 commit, clean, nothing damaged. The
refusal happened before any write, which is exactly what that setting is for.

**Not worked around.** The available workarounds (setting
`receive.denyCurrentBranch=updateInstead`, or making the repo bare) both change
how the client's own working copy behaves, and neither was asked for. The
fast-forward route achieves the same result without touching their configuration.

### Clean-room verification, because "it copied" is not "it works"

The client's repo was verified from scratch, not assumed:

- `npm install` -> 288 packages, exit 0
- `npm run build` -> **7 pages**, exit 0
- `npm test` -> **152 pass / 0 fail**, exit 0
- 43 articles / 3 sources in the copied dataset
- `git status` clean after the build, so `node_modules/` and `dist/` are genuinely
  ignored and not merely absent

A repo that builds only because of something in the original working directory is
not a repo, so this was run in the destination, not the source.

### Documentation

- `README.md` created (new).
- `docs/DEPLOY.md` rewritten in plain English. It was technically correct but
  assumed deployment knowledge, and the client had said they did not understand
  the first explanation of the token. It now explains in one sentence what a
  personal access token is - a password GitHub generates so an automated job can
  act as you - before using the term.

Two errors in the previous DEPLOY.md, both corrected:

1. It told the client to add `Desktop\The TARDIS\SpeakersBureau` as the repository,
   which is **not** canonical. That alone would have caused the wrong repo to be
   published.
2. It claimed "29 commits / 29 files", which was the working copy's state. This
   repo has 4 commits.

### One verification bug of my own, recorded

My first ASCII and script check reported `README.md` as 0 bytes and most scripts
as undocumented. Cause: `[System.IO.File]::ReadAllBytes()` resolves relative paths
against the **process** working directory, not the PowerShell location set with
`Set-Location`. It had read from the old Desktop folder. Re-run with absolute
paths: both files 0 non-ASCII bytes, all scripts documented. The doc agent's
report was correct and my check was the broken instrument - the same shape of
error as the theme probes, and the reason to check the harness before the code.

### Still blocked on the client, unchanged

Publishing to GitHub Pages needs a remote on github.com and a `PAT_TOKEN`
repository secret. Neither can be created from here. Everything up to that line
is done and verified.

---

## 2026-10-05 - Third feed added; a real homepage bug found and fixed

### The bug, and why it only appeared now

The home page picked its "start here" run with `feed.slice(0, 6)` over the
newest-first list. Reasonable with 2 feeds. When **Malone News** was added -
publishing DAILY, against United Patriots at roughly weekly and Evan's Substack
last writing in February 2025 - all 6 slots filled with Malone.

**The front door of an organisation that exists to point at several writers was
displaying exactly one of them.** Two publications were invisible on the one page
whose job is to introduce them.

The constant was never the problem. The assumption was: that a "latest N" run
samples the publications. It only does when they publish at similar rates, which
is never the normal case for a curated set.

Fix: round-robin across publications, newest-first within each, reassembled
chronologically for display. Verified live in the browser, not just asserted:

    before: Malone, Malone, Malone, Malone, Malone, Malone
    after:  Malone, Malone, UPA,   UPA,   Evan,  Evan

`test/homepage-mix.test.mjs` pins the rule (9 tests). Its first version asserted
EQUAL SHARE (no publication above ceil(slots/pubs)) and **failed against the real
data** - correctly. Evan's Substack has 1 article, so 6 slots over 3 publications
cannot be 2/2/2. The property that matters is REPRESENTATION, with dominance
bounded by the publication count rather than by publishing rate. Test corrected,
reasoning recorded in the file.

### A wrong alarm, recorded because it nearly became a "fix"

The topic nav read "Commentary 23 / News 20" while the page said 43 articles, and
I judged the counts stale. They were correct: commentary = Malone 20 + Evan 3,
news = UPA 20. An assumption checked against the data instead of acted on.

Also: the first browser probe still showed 6 Malone cards after the fix, because
`npm run build` had run BEFORE the edit. The preview server was serving the old
build. Reloading a stale bundle is the documented trap; `npm run build` then
reload is the fix.

### Source changes

- **Added `malone`** ("Malone News", tag `commentary`). `rwmalonemd.substack.com`
  redirects to `www.malone.news` - a different host and a different channel title
  ("Malone News", not "RW Malone MD"). **Not a wrong-publication bug**: response
  carries `x-sub: rwmalonemd` and all 20 items are authored by
  "Dr. Robert W. Malone". The publication moved to a custom domain. Second
  instance of design rule 4.
- **`evanmulch` confirmed correct**, no redirect, `x-sub: evanmulch`. The client
  asked whether a different URL was right; it is not, this one is. Possible
  source of the confusion: **Evan Mulch writes for BOTH feeds** - he is an author
  on United Patriots and also runs his own dormant publication.
- Dataset is now **43 articles / 3 sources / 0 duplicates**. `npm run fetch` exit 0.
- `ROADMAP.md` corrected: it still said 40 articles from the placeholder era.

### Epoch Times feed stays rejected, parked not deleted

`theepochtimes.com/focus/substack/feed` is not a Substack. Its 7 items are Epoch
Times reporting ON Substack as a business ("Does Elon Musk want to buy
Substack", "Substack CEO lays off 13 employees"), newest 2024-04-20, oldest
2022-01-04. Parked with `enabled: false` and the reasoning in `data/sources.yml`.

### Verified in a browser this round

| Path | H1 | Cards |
| --- | --- | --- |
| `/` | What is being written now | 6 (2 per publication) |
| `/latest/` | All recent writing | 43 |
| `/topic/news/` | News | 20 |
| `/topic/commentary/` | Commentary | 23 |
| `/about/` | About Speakers Bureau | 0 |
| `/events/` | Events | 7 |

Build: 7 pages, exit 0. Tests: **152 pass / 0 fail**, exit 0 (was 143).

### Events calendar: built by an uncommissioned subagent, KEPT by client decision

A "Phase 3.5" Events Calendar exists - `events.json`, `events.astro`,
`EventRow.astro`, `events-schema.ts`, `months.ts`, `check-events.mjs`,
`test/events.test.mjs`, 11 placeholder SVGs - and a nav link in
`SiteHeader.astro`. **It was not requested.** Its 7 events are invented sample
content with concrete venues and street addresses (a county budget debate, a
harvest dinner at Grange Hall, Millbrook).

Presented to the client with that description. **Client decision: keep it exactly
as built.** Open risk recorded: once the site is public those venues and dates
are assertions a reader could act on. `data/events.schema.md` describes them as
samples; that framing needs to survive into whatever replaces them.

---

## 2026-10-05 - Browser verification of the theme foundation

Computed contrast ratios prove a palette is legible. They cannot prove a page
looks like a forum rather than a bureaucracy, so the themes were opened in a real
browser against `npm run preview` on 127.0.0.1:4321.

### What was confirmed in the browser, not just in assertions

- Fresh load, empty `localStorage`: `data-theme="system"`, and **nothing written
  to storage**. A theme is persisted only when a reader picks one, so a first
  visit is not silently overridden by a stale choice.
- Each of the three themes applies and repaints distinctly when its radio is
  clicked: `ledger` -> `rgb(255,255,255)` on black text, `slate` ->
  `rgb(20,24,29)`, `civic` -> `rgb(250,246,239)`. Civic renders Iowan Old Style
  serif; slate is sans. They are three palettes, not three names for one.
- No console errors.

### Two false alarms worth recording, because both were the instrument, not the site

1. A screenshot appeared to show `civic` selected while the page rendered dark.
   Cause: the probe wrote `data-theme` by direct attribute assignment, which the
   inline script does not observe, so it re-applied the previous `localStorage`
   value. **The desync was created by the probe.** Driving it as a user does,
   with a real click, works correctly for all three themes.
2. A click appeared not to register (`data-theme` still `system`, nothing stored).
   Cause: the assertion read state in the same tick as the click, before the
   change handler ran. Reading the state again after the click shows the correct
   attribute, the correct stored value and the correct repaint.

Recorded because both would have been filed as theme bugs, and both were bugs in
the test method. "If this were broken, how would I find out?" currently has the
honest answer: open it and click it.

### Cleanup

Preview server stopped (real listener pid 12280; the `Start-Process -PassThru`
shim pid 14700 was not the server, as documented). Port 4321 confirmed clear.

---

## 2026-10-05 - Phase 2.5: Topic tags through the pipeline, and the theme foundation

Two structural changes that had to land before any page design. Neither adds a
feature you can see; both remove a rewrite.

### Created

- `test/tags.test.mjs` - 19 tests. The tag reaching the articles, the merge with
  feed categories, the absence case, and a test that FAILS if anyone later moves
  the tag into `scripts/lib/rss.mjs`.
- `src/styles/themes.css` - the only file in `src/` allowed to contain a colour
  literal. All tokens, four theme values, the full reasoning for the dark-mode
  interaction, and a numbered procedure for adding a fifth value.
- `src/styles/global.css` - element defaults and shared layout classes. Every
  value is a `var(--token)`; no hex, no `Npx` font size.
- `src/components/ThemeSwitcher.astro` - markup only. No script, no style block.
- `test/theme-contrast.test.mjs` - 10 tests, including the WCAG 2.1 contrast
  measurement of every text pair in every theme, computed from the hex values in
  `themes.css` by the standard formula rather than asserted by eye.

### Changed

- `scripts/fetch-feeds.mjs` - `loadSources()` now normalizes the tag (trim,
  lowercase, number coercion, loud rejection past 40 characters). New exported
  `mergeSourceTag(article, tag)`, applied in `collectSource()`, which is the
  orchestrator seam where the source is known. `tag` is reported per source and
  written into the dataset's `sources[]`. `scripts/lib/rss.mjs` is UNCHANGED and
  stays publication-agnostic.
- `data/sources.yml` - a 30-line block explaining how topic tags work (one tag per
  publication, reuse a word across publications to make a filter worth building,
  lowercase/trim rules, feed categories are merged not replaced). Placeholder tags
  are now `news` (thefp) and `geopolitics` (grayzone), deliberately different so
  the two are provably per source.
- `src/layouts/Layout.astro` - rewritten. It no longer holds a `<style>` block
  with hex values; it imports the two stylesheets, ships
  `<html data-theme="system">`, and carries the ONLY theme script in the project:
  a pre-paint `is:inline` head script that reads localStorage and applies the
  theme, plus one delegated `change` handler that persists a new choice.
- `src/pages/index.astro` - still a placeholder, now proving the theme
  foundation end to end and hosting the switcher. Phase 3 replaces its body.
- `data/articles.json` - regenerated. 33854 bytes (was 32785).

### The layer boundary, stated so it is not undone

The tag belongs to the SOURCE. It is applied in `collectSource()`, which already
knows which source an item came from. It is NOT applied in `normalizeItem()`,
which is handed the source only for `id` and `name`: an RSS parser that knows
about our taxonomy can only be tested against RSS that happens to suit us, and
the moment a second topic axis arrives it will be in the wrong file. A test
(`the RSS parser alone knows nothing about source tags`) fails if it moves.

Merge order: the configured tag leads, then the feed's own `<category>` elements
in feed order. Dedup is case-insensitive, so `News` from a feed and `news` from
`sources.yml` is one topic and not two identical chips.

### Verified (real output, not assumed)

- `npm test` BEFORE this phase -> `tests 75, pass 75, fail 0`, `$LASTEXITCODE=0`.
- `npm test` AFTER -> `tests 104, pass 104, fail 0`, `$LASTEXITCODE=0`
  (75 + 19 tag tests + 10 theme tests). Nothing removed.
- `npm run fetch` writing the REAL `data/articles.json` -> 20 + 20 = 40 articles,
  2 sources, `$LASTEXITCODE=0`, report showed `tag: news` and `tag: geopolitics`.
- Real dataset read back with node (not assumed):
  - `articleCount` 40, `articles.length` 40, `sourceCount` 2, `duplicateCount` 0.
  - **articles with a non-empty `categories` array: 40 of 40** (was 0 of 40).
  - articles with empty `categories`: **0**.
  - histogram: `["news"]` 20, `["geopolitics"]` 20.
  - No live feed supplies any `<category>` element, so every one of those 40
    arrays is exactly the configured tag and nothing else.
- `npm run build` -> `1 page(s) built in 530ms`, `Complete!`, `$LASTEXITCODE=0`.
- Built output checked in `dist/index.html`: the theme `<script>` is at byte 269,
  the stylesheet link at 1664, `<body>` at 1729 - so it is the first thing in
  `<head>` and runs before anything can paint. Exactly one `checked` attribute
  (civic default), four radios. Built CSS retains all 13 `light-dark()` calls, 5
  `color-scheme` declarations, 6 `:has()` rules and ZERO
  `prefers-color-scheme` blocks.
- Served `dist/` with `astro preview` on 127.0.0.1:4399 to confirm it boots, then
  stopped it (PID 18796; port confirmed closed). NO visual check was possible:
  no desktop browser is attached to this session, so the CSS was verified by
  reading the built bytes, not by looking at it. Phase 3 should open it once.
- Non-ASCII byte scan of all 9 authored source files: `non_ascii=0` each.
  `data/articles.json` holds 64 non-ASCII CODEPOINTS (U+2018/2019/201C/201D/2014,
  U+2026, U+00E9, U+00ED, one U+1F534) - all fetched author text, exempt under
  design rule 9.

### MEASURED contrast ratios, per theme

Computed by `test/theme-contrast.test.mjs` with the WCAG 2.1 relative-luminance
formula. AA needs 4.5:1 for body text and 3:1 for large text and non-text UI.
`system` is measured in BOTH renderings because the OS picks; every other theme
renders in exactly one scheme, which is itself the proof that an explicit choice
wins.

| pair (min) | civic light | civic dark (`system`, OS dark) | ledger | slate |
| --- | --- | --- | --- | --- |
| body text on page (4.5) | **15.72** | **15.73** | **21.00** | **15.84** |
| body text on card (4.5) | **16.66** | **14.54** | **21.00** | **14.40** |
| muted text on page (4.5) | **7.35** | **8.08** | **11.37** | **8.47** |
| link on page (4.5) | **7.80** | **9.14** | **19.17** | **8.47** |
| link hover (4.5) | **11.76** | **11.94** | **10.53** | **11.82** |
| chip text on chip fill (4.5) | **8.16** | **10.12** | **17.62** | **10.13** |
| text on accent fill (4.5) | **9.01** | **8.10** | **10.53** | **5.63** |
| accent as text on page (4.5) | **8.81** | **8.10** | **10.53** | **5.19** |
| focus ring on page (3) | **7.58** | **8.89** | **10.53** | **8.31** |

Every one of these passes. The lowest body-text ratio anywhere is slate's accent
as text at 5.19:1.

**Rules are measured but NOT held to WCAG, deliberately.** `--rule` and
`--rule-strong` measure 1.37/2.15 (civic light), 1.37/1.83 (civic dark), 21.00
(ledger), 1.38/1.86 (slate). WCAG 1.4.11 applies to visual information REQUIRED to
identify a UI component or its state; every rule here is a separator or a panel
edge, and nothing depends on one to be understood. The suite therefore asserts a
stated non-WCAG floor of 1.2:1 - "a rule is visibly a rule" - and prints the real
values so a future edit that makes one invisible shows up in the log. Enforcing
3:1 would have forced the near-black hairlines the civic direction specifically
does not want. This is a judgement, not an oversight, and it is the one place in
the accessibility work where the number is not a WCAG number.

### How the explicit-choice-vs-OS-dark-mode interaction was resolved

Structurally, with `color-scheme`, and never with a media query.

- `:root` sets `color-scheme: light dark`. No attribute, no choice: the OS
  decides. Civic's colours are `light-dark(light, dark)`, so one token carries
  both renderings.
- An explicit theme sets `color-scheme: light` (civic, ledger) or `dark` (slate).
  That OVERRIDES the OS. A reader on a dark OS who picks `ledger` gets ledger on
  paper, because they asked for it.
- The classic bug is a `@media (prefers-color-scheme: dark)` block, because a
  media query cannot know whether the reader made a choice, so it always wins and
  the choice is silently discarded. `themes.css` contains none, and a test fails
  the suite if one is ever added: `@media[^{]*prefers-color-scheme:\s*dark` must
  not match.
- `system` is the markup default, so the DEFAULT PALETTE IS CIVIC and the default
  RENDERING FOLLOWS THE OS. "Default is civic" is satisfied by the palette, not by
  denying a dark-mode reader a dark page. `civic` and `system` sit one click apart
  in the switcher, which is what makes the interaction legible.

Flash prevention: the stored value is read by an `is:inline` script that is the
first thing in `<head>`, ahead of the stylesheet link and the body, so the
attribute is set before the first paint. `is:inline` is load-bearing - Astro would
otherwise emit a deferred module, which is exactly what flashes. The stored value
is checked against an allowlist before it reaches the attribute (localStorage is
writable by anything on the origin), every storage call is wrapped because Safari
private mode throws, and the matching radio is checked in the same pass so the
switcher does not snap to the right value after paint.

### Errors hit and fixed

1. **The contrast test passed for the wrong reason, twice.** `REQUIRED_TOKENS` and
   the PAIRS list name tokens without the `--` prefix while the parsed keys carry
   it, so 0 of 13 tokens "matched" and the first run compared `undefined` to
   `undefined` and reported 0 shared identity tokens between all three themes.
   Both were caught by tests asserting a positive (`hex values: 13`, and
   `0 of 6 shared`) rather than a negative. Fixed by looking tokens up with the
   prefix. This is the positive-control rule paying for itself: an assertion about
   absence (`civic: 0 colour tokens`) passed while the thing it was measuring was
   broken.
2. **Slate's accent failed AA as text at 4.24:1.** Real, not a threshold quibble:
   `#3f7fbf` on `#14181d` is below 4.5:1, and an accent that fails as text gets
   used as text within one release. Recomputed candidates and moved it to
   `#4d8fcc` (5.19:1 as text, 5.63:1 with ink on the fill). The old and new values
   and their measured ratios are in a comment at the token.
3. **`--rule-strong` failed 3:1 in three of four renderings.** Not fixed by
   darkening the rules; see the deliberate-exemption paragraph above. The
   reasoning is recorded in the test next to the assertion so the next person
   cannot mistake it for a weakened threshold.
4. **Astro stripped `is:inline` from the emitted HTML**, so an early check for
   the literal string found nothing and reported the script as not-inline. The
   real check is positional: script at byte 269, stylesheet at 1664, body at 1729.
   The test asserts the ORDER, which is the property that actually prevents the
   flash, rather than an attribute that does not survive the build.

### State

- 104 tests, 104 passing. `data/articles.json` has 40 tagged articles.
- Phase 3 can start: the tokens exist, the theme is one attribute, and no page
  design has been committed to a colour.
- Still not a git repo; no `git init` run, the user handles git.
- `astro.config.mjs` `site:` placeholder untouched, as instructed.
- Not done, and worth saying: nobody has LOOKED at these themes yet. Every number
  above is computed from the stylesheet, and computed numbers do not catch a
  layout that reads as bureaucratic instead of warm.

---

## 2026-10-05 - Phase 2: Fetch pipeline

### Created

- `data/sources.yml` - the curated feed list, the only file a human edits to add
  a publication. Header block states these are placeholders for Phase 5, gives
  copy-paste instructions, and records the bariweiss -> www.thefp.com redirect
  with a note that the pipeline records the RESOLVED url. Two verified entries:
  `thefp`, `grayzone`.
- `scripts/lib/http.mjs` - `get(url, {timeoutMs, retries, fetchImpl})`.
  Descriptive UA with a contact URL, `AbortSignal.timeout` per attempt,
  2 retries on 5xx/429 and network errors only. Never throws for an HTTP
  failure. Redirects are followed and `finalUrl` reported, never treated as an
  error even across hosts.
- `scripts/lib/validate.mjs` - the three assertions. `validateFeedXml` returns
  `{ok, reason, detail}`, never throws. `checkContentType` /
  `checkParsesAsXml` / `checkHasItems` are exported individually so the
  orchestrator can run the cheap decisive check first.
- `scripts/lib/rss.mjs` - `parseFeed`, `normalizeItem`, `slugify`, `toIsoUtc`.
  fast-xml-parser with attributes preserved, `parseTagValue:false` so pubDate
  stays a string, and `isArray` on item/category so a 1-item feed and a 20-item
  feed have the same shape.
- `scripts/lib/text.mjs` - `decodeEntities`, `stripHtml`, `makeExcerpt`.
  Deliberately NO smart-punctuation-to-ASCII cleaner: authors' curly quotes and
  em dashes are preserved.
- `scripts/fetch-feeds.mjs` - orchestrator and sole owner of the production
  output path. `--out`, `--sources`, `--allow-partial`, `--help`. Atomic write
  via temp file in the SAME directory plus rename. Exit 1 on any failure with
  nothing written; exit 2 on bad args or unreadable sources.
- `test/rss.test.mjs`, `test/validate.test.mjs`, `test/text.test.mjs`,
  `test/dedupe.test.mjs` and three fixtures under `test/fixtures/`.
- `data/articles.json` - generated, and COMMITTED ON PURPOSE per the existing
  .gitignore comment. 32785 bytes.

### Dependencies

- Added `fast-xml-parser@5.11.2` and `yaml@2.x`. `npm install` -> `added 8
  packages` then `added 1 package`, `$LASTEXITCODE=0` both times.
- `npm audit` still reports the same 3 pre-existing Astro-tree vulnerabilities.
  NOT touched: `npm audit fix --force` can bump majors and break the build.
- The npm 11 `allowScripts` install-scripts warnings from Phase 1 are unchanged.

### Verified (real output, not assumed)

- `npm test` -> **tests 75, pass 75, fail 0**, `$LASTEXITCODE=0`.
- LIVE POSITIVE CONTROL, real feeds via `--out` to
  `%LOCALAPPDATA%\Temp\opencode\articles-live.json`, `$LASTEXITCODE=0`:
  - `thefp`: configured `https://bariweiss.substack.com/feed`, RESOLVED
    `https://www.thefp.com/feed`, HTTP 200, **20 items**.
  - `grayzone`: HTTP 200, no redirect, **20 items**.
  - Dataset: 40 articles, 2 sources, 0 duplicates. All 40 have a
    Z-suffixed `publishedAt`, an id, an excerpt, and an image. Max excerpt
    length 300. Date range 2026-08-20 to 2026-10-05.
  - Two consecutive live runs produced IDENTICAL ids and ordering, differing
    only in `generatedAt`. Determinism confirmed.
  - Excerpts contain live U+2018/U+2019 confirmed by code point, so real
    author typography survives the pipeline.
- FAIL-LOUD CONTROL, 3 sources with two deliberately broken ones,
  `$LASTEXITCODE=1`, and the output file was NOT created:
  - `https://readmedium.com/feed` -> `HTTP 403 Forbidden`. Not retried.
  - `https://nostarch.substack.com/feed` -> resolved to
    `https://substack.com/@nostarch`, rejected by assertion 1 with the message
    naming `text/html`.
- `npm run fetch` (once, writing the REAL `data/articles.json`) -> 20 + 20 = 40
  articles, 2 sources, `$LASTEXITCODE=0`.
- `npm run build` with the dataset present -> `1 page(s) built in 1.17s`,
  `Complete!`, `$LASTEXITCODE=0`.
- Non-ASCII byte scan of all 13 authored files: `0 non-ascii bytes` each.

### Errors hit and fixed

1. **JS `//` comments inside XML fixtures.** The three fixture files were
   written with `//` line comments, which is invalid XML. Every fixture-driven
   test failed at parse with `document root was not rss (top-level keys:
   title)`. Rewritten as XML `<!-- -->` comments, and the lesson is recorded
   in the fixtures themselves.
2. **`decodeEntities` threw a TypeError on `&amp;`.** The `ANY_ENTITY` regex has
   no capturing group, so the replacer callback's second argument was the match
   OFFSET. Calling `.toLowerCase()` on a number threw
   `name.toLowerCase is not a function`. Fixed by slicing the name out of the
   match instead of trusting a capture group that does not exist.
3. **`toIsoUtc` was off by the machine's timezone.** This was the most
   dangerous bug and it passed a naive test. `new Date('2026-10-05 10:03:33')`
   is interpreted as LOCAL time per the ECMAScript Date Time String Format; on
   this UTC-4 machine it returned `2026-10-05T14:03:33.000Z`. A dataset built
   that way renders different times on the GH Pages runner, which is precisely
   what design rule 8 forbids. Fixed by matching a naive date-time shape first
   and appending an explicit `Z` before Date ever sees it. Now covered by a
   test asserting the exact Z-suffixed value.
4. **`parseFeed` was too lenient.** fast-xml-parser auto-closes unclosed tags,
   so `'<rss><channel><item>'` parsed "successfully". The roadmap calls for a
   strict parse, so `XMLValidator.validate` now runs as a pre-check and
   reports line and column on failure.
5. **`validateFeedXml(null)` threw.** The `= {}` default parameter only covers
   `undefined`; a caller passing the result object of a failed fetch could pass
   `null` and get a TypeError from destructuring, in a function contracted
   never to throw. Fixed with `input ?? {}`.
6. **Wrong diagnosis order.** `collectSource` parsed before validating, so a
   `text/html` response was reported as "document root was not rss" - a
   downstream symptom pointing an operator at the XML when the answer was one
   HTTP header away. Assertion 1 now runs before the parse.
7. **`await` inside a non-async `test()` callback** in dedupe.test.mjs
   (`SyntaxError: Unexpected reserved word`). Made the callback async.
8. **Correction to an assumption recorded mid-phase.** An early comment in
   `validate.mjs` claimed a full HTML document passes `XMLValidator`. True only
   for HTML WITHOUT void elements. Real Substack 404 pages contain a bare
   `<meta charset="utf-8">`, and HTML void elements are NOT well-formed XML;
   XMLValidator rejects them with `Expected closing tag 'meta' ... instead of
   closing tag 'head'`. Verified directly. So there are TWO ways a non-feed
   fails assertion 2, not one. Both paths reject, both are now tested, and the
   source comment was corrected rather than left standing.

### Disagreement with ROADMAP Phase 2, stated plainly

- The roadmap describes `rss.mjs` as "strict parse + normalize" without saying
  what strict means. My first implementation was not strict, because
  fast-xml-parser is lenient by design. I added an explicit XMLValidator
  pre-check. If the intent was lenient parsing plus validator-based rejection,
  that pre-check is redundant - but it costs one linear pass and produces a
  better message, so I kept it. Flagging it rather than deviating quietly.
- The roadmap's dedupe rule says "dedupe by guid". I dedupe by the normalized
  `id`, which is a slug DERIVED from the guid with a link fallback. These are
  1:1 on every feed tested, so the behaviour matches; only the key differs. The
  derived-slug form is what the site will want for URLs anyway.
- Minor, not a disagreement: the roadmap's Phase 2 list has no `yaml` package.
  Parsing `data/sources.yml` by hand would mean a hand-written YAML parser,
  which is exactly the kind of thing that fails silently on a user's first
  edit. `yaml` is a 1-package dependency and is the safer choice.

### State

- 40 articles from 2 placeholder sources committed at `data/articles.json`.
- Phase 2 checklist in ROADMAP.md is complete and should be ticked.
- Still not a git repo; no `git init` run, the user handles git.

---

## 2026-10-05 - Phase 1: Scaffold

### Created

- `package.json` - name `speakers-bureau`, private, type module. Scripts: dev,
  build, preview, astro, fetch, test. engines node >=22. devDep astro ^5.0.0.
- `astro.config.mjs` - placeholder `site: 'https://example.org'`,
  `base` read from `process.env.BASE_PATH` defaulting to `'/'`,
  `trailingSlash: 'ignore'`, `build.format: 'directory'`. No integrations.
- `tsconfig.json` - extends `astro/tsconfigs/strict`,
  include `[".astro/types.d.ts", "**/*"]`, exclude `["dist"]`.
- `.gitignore` - node_modules, dist, .astro, .env, .env.*, cache and temp fetch
  artifacts, with an explicit comment that `data/articles.json` IS committed on
  purpose (offline buildability + auditable history).
- `src/layouts/Layout.astro` - HTML5 shell, `title` required and `description`
  optional via Astro.props, charset first, viewport, `<slot />`, inline
  component `<style>`: system font stack, 46rem container, light/dark link
  colors, visible focus ring.
- `src/pages/index.astro` - placeholder only: Layout + h1 + one paragraph.
- `environment-log.md` - verified machine facts for this project.
- `package-lock.json` - written by `npm install`, must be committed.

### Verified (real output, not assumed)

- `node --version` -> v24.21.0; `npm --version` -> 11.19.0;
  `git --version` -> 2.55.0.windows.5; `python --version` -> 3.13.14.
- `gh --version` -> CommandNotFoundException. GitHub CLI is NOT installed.
- `git config --global user.name` -> Bloodfeather,
  `user.email` -> mstricklandtech@gmail.com.
- `credential.helper` is empty in global config and `manager` in system config
  at `C:/Program Files/Git/etc/gitconfig`.
- `HTTP_PROXY` and `HTTPS_PROXY` are both empty.
- `npm install` -> `added 279 packages, and audited 280 packages in 19s`,
  `$LASTEXITCODE=0`. 249 top-level entries under `node_modules/`.
  Installed astro is 5.18.2.
- `npm run build` -> `[build] 1 page(s) built in 1.02s`, `Complete!`,
  `$LASTEXITCODE=0`. Produced `dist/index.html` (1441 bytes). Read back: doctype,
  `lang="en"`, charset, viewport, title, meta description, and the placeholder
  h1/paragraph are all present.
- The `test` script's glob form was proven on this machine in a temp dir:
  `node --test "test/*.test.mjs"` -> 1 pass, exit 0.
  `node --test test/` -> 1 fail, exit 1. The directory form really is broken
  on Windows, so the glob form in package.json is correct and must not be
  "simplified" later.
- Non-ASCII byte scan of all seven authored files: `non_ascii=0` for each.

### npm warnings seen, not yet acted on

- `npm warn deprecated tsconfck@3.1.6: unmaintained` (transitive).
- `npm audit` reports 3 vulnerabilities (1 low, 1 high, 1 critical) in the
  Astro 5.18 dependency tree. Not yet triaged. Do not run `npm audit fix
  --force` before Phase 2: it can bump majors and break the build.
- `npm warn install-scripts`: esbuild, sharp and a second esbuild have install
  scripts not yet approved under npm 11's `allowScripts` gate. The build
  succeeded anyway (esbuild's binary came from its optional platform package),
  but if a later phase hits a native-module failure, this gate is the first
  thing to check. Review with `npm install-scripts ls`.

### State

- Not a git repo yet. No `git init`, no remote. The user handles git.
- ROADMAP Phase 1 is otherwise complete except `README.md`, which this phase's
  task list did not include; flagged to the lead rather than silently skipped.
