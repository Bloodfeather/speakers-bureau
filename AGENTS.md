# THE CITIZEN'S READING ROOM

**The canonical repository for this project is:**

```
C:\Users\SCSpeakers\Documents\GitHub\Speakers\Speakers
```

Work here. If you were sent here from somewhere else, or you find yourself
holding a second copy of this project, that is the bug - read
`WHERE-THIS-REPO-LIVES.md` before doing anything else.

---

# AGENTS - Citizens Reading Room

An Astro static site that aggregates articles from independent Substack
publications and publishes a civic events calendar for the Upstate of South
Carolina. Built to a schedule and deployed to Cloudflare Pages at
`scspeakersbureau.org`. The schedule and the dataset commit run on GitHub
Actions; only the publish step is Cloudflare.

## THE FOUR NON-NEGOTIABLES

**1. ASCII ONLY. No exceptions.**

Write only the 128 ASCII characters in every file, comment, log, commit message
and reply. A dash is `-`, never an em dash. Quotes are straight. Punctuation is
`,` `:` `;` `.` with single spaces.

This is not a style preference. On Windows PowerShell 5.1 an em dash is written
as three bytes that decode as three different characters, and the damage is
invisible from inside the shell that wrote it.

**If you cannot see it, do not type it - build it from its number.**
`String.fromCharCode(0x200b)`, never a literal zero-width space. A character whose
identity is its byte sequence can be normalised away by anything between you and
the file, and the file that results parses, runs, passes its tests, and is wrong.
When you build a test fixture from a code point, assert the code point you built.

**2. FILE CONTENT IS WRITTEN WITH `write` AND `edit`. NEVER WITH A SHELL.**

`Set-Content`, `Out-File`, `Add-Content`, `.Replace() | Set-Content`, here-strings
and `>` redirection are for reading, for process control, and for piping text to a
program's stdin. They are not for authoring a file.

On PowerShell 5.1 an omitted `-Encoding` writes UTF-16 or ANSI, and `>` writes
UTF-16 - observed 2026-10-05, when a `git show` redirected with `>` produced a
67,202 byte file from a 32,925 byte blob, which then made every file comparison in
the project report a false difference. Read files with the `read` tool and the
`ReadAllText`/`ReadAllBytes` methods.

**3. DO NOT DELETE FILES WITHOUT EXPLICIT PERMISSION.**

Including build output, images, fixtures and orphan assets. If something is
genuinely dead, say so and let the client decide.

**4. COUNT, DO NOT INFER.**

A number reported about the filesystem must come from counting the thing.
Distinguish top-level entries from total files and say which you counted. If a
figure carries a `~`, it came from arithmetic rather than observation - go count.

Observed 2026-10-05: an agent reported destroying 20,000 files, having counted
2,508 top-level directories and subtracted. 122,803 files and 6.88 GB were present
throughout, including the exact fixtures it claimed to have deleted. A count of
containers is not a count of contents.

## WORKING ON THIS PROJECT

**Use agents for construction and review; reserve your own attention for design
and for deciding what is true.** Each agent's context is a limited resource.

**Every claim about this project must be verified in this repository.** There was
a second working copy on the Desktop for several days. Every "the build passes"
and "the file has X" statement is about
`C:\Users\SCSpeakers\Documents\GitHub\Speakers\Speakers` unless the statement says
otherwise in those words.

**Read `build-log.md` before changing anything.** Newest entry on top. It records
what was tried, what broke, and what was measured. It is the reason several
certain-looking approaches were not taken.

**Read `ROADMAP.md` for the design decisions** and their reasons. Several look
like over-engineering and are not.

## COMMANDS

Run everything from the repository root.

```powershell
npm install          # once
npm run fetch        # pull the publication feeds. Requires network. Writes data/articles.json
npm run dev          # local dev server
npm run build        # static build into dist/ - this is the deployable artefact
npm run preview      # serve the built dist/ locally
npm test             # the suite. ALWAYS run `npm run build` first: several tests read dist/
npm run events:check # validate data/events.json and its images. Writes nothing
npm run events:placeholders  # generate placeholder artwork for events that lack it
```

`npm test` uses the glob form `node --test "test/*.test.mjs"`. The directory form
fails on Windows. Test output on Windows prefixes its counts with U+2139
(INFORMATION SOURCE, `String.fromCharCode(0x2139)`), so the summary lines read
`0x2139 tests N` rather than `# tests N`. A grep for `#` on a passing run finds
nothing, which reads exactly like a failed suite.

## THE SITE'S RULES

These are product requirements, not preferences. They exist because getting them
wrong publishes a lie.

**Nothing works only with JavaScript.** Navigation is ordinary links. The events
calendar is interactive with scripting off, using radio inputs and CSS `:has()`.
The only script on the site persists the reader's theme choice, and deleting it
costs only the saved preference.

**RSS holds no history.** Each publication's feed returns only its most recent
posts - about 20 each, roughly six weeks. This site is a WINDOW, not an archive.
Never use the words "archive", "library" or "browse all". When a post falls out
of a feed it leaves this site too.

**The built HTML must not depend on when it was built.** No `new Date()` in any
rendering path. The past/upcoming split on the events page comes from
`reviewedOn`, a date a human puts in the file. A build whose output differs
between two machines from one commit is a defect, and the suite checks this by
running the date code under several timezones and comparing bytes.

**Shape validation cannot find a wrong fact.** `events:check` verifies that a date
is well-formed, never that it is true. Four real errors in the 2026 election data
passed every check and a 192-test suite. Reading the source is the only thing that
catches a wrong county.

**Every event carries a `url` to the notice it came from.** A civic date with no
source is an assertion with nothing behind it.

**Colour values live only in `src/styles/themes.css`.** Three themes plus a
system option, all structural from the start via custom properties.

## HARD-WON MACHINERY TRAPS

Read `environment-log.md` for the full list. The ones that have actually cost time:

- **`[System.IO.File]` with a relative path resolves against the PROCESS working
  directory, not the PowerShell location set with `Set-Location`.** This has read
  the wrong repository twice in one session. Use absolute paths.
- **Astro frontmatter regex must be non-greedy across the whole block.** A `---`
  inside a frontmatter comment ends the frontmatter.
- **Never spell an Astro comment delimiter inside a comment.** It closes the
  comment early and the rest of the note renders as page copy. This shipped on the
  live events page and survived 206 tests, because every test asserted structure
  and nothing asserted that a kind of text was ABSENT.
  `test/no-comment-leak.test.mjs` now enforces it.
- **`git push` to the branch checked out in a non-bare repo is refused.** That is
  the setting protecting the client's files. Use `fetch` + `merge --ff-only`.
- **The shared scratch directory `%LOCALAPPDATA%\Temp\opencode\` holds other live
  sessions' files.** Use your own subdirectory under it and never delete anything
  in it.

## BEFORE YOU FINISH

- `npm run build` exits 0 and produces the expected pages.
- `npm test` exits 0, with a build first.
- `npm run events:check` exits 0 if you touched event data.
- Every file you authored is ASCII. Read the bytes and count bytes above 127.
- `git status --short` shows only what you intended to change.
- `build-log.md` has a new entry, newest on top, recording what you measured -
  not what you assumed.
