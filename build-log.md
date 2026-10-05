# build-log.md - SpeakersBureau

Most recent entry on top. This file is the crash-recovery record: after any
interruption, read the top entry, then `ROADMAP.md`, then continue.

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
