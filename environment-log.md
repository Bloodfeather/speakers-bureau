# environment-log.md - SpeakersBureau

Project-scoped record of machine facts, each verified on the date shown.
Machine-general traps live in the global `ENVIRONMENT.md`; project facts live
here. If a fact below goes stale, re-run the command in the same row and fix
this file in the open.

Verified: 2026-10-05
Working dir: `C:\Users\SCSpeakers\Desktop\The TARDIS\SpeakersBureau`

## Toolchain

| Fact | Command | Result |
| --- | --- | --- |
| Node | `node --version` | `v24.21.0` |
| npm | `npm --version` | `11.19.0` |
| git | `git --version` | `git version 2.55.0.windows.5` |
| Python | `python --version` | `Python 3.13.14` |

All four resolve by bare name on `PATH`, no absolute path needed.

Node 24 satisfies the `engines.node: ">=22"` floor in `package.json`.

## Not installed

- **GitHub CLI (`gh`) is NOT installed.** `gh --version` returns
  `CommandNotFoundException` ("The term 'gh' is not recognized"). Anything in
  this repo that assumes `gh` must be done by hand in a browser instead. This
  matters for ROADMAP Phase 4, which lists repo creation and Pages
  configuration as tasks.

## Git configuration

- Global identity is already set, so a commit needs no `-c` override:
  `git config --global user.name` -> `Bloodfeather`
  `git config --global user.email` -> `mstricklandtech@gmail.com`
- `credential.helper` is **not** in global config
  (`git config --global --get credential.helper` returns empty).
  It is `manager` (Git Credential Manager) in **system** config:
  `git config --system --show-origin --get credential.helper` ->
  `file:C:/Program Files/Git/etc/gitconfig manager`
  So pushes should authenticate without a PAT being pasted on the command line.

## Network

- No proxy: `HTTP_PROXY` and `HTTPS_PROXY` are both empty. Direct network
  access to `*.substack.com` feeds is assumed and must still be proven by the
  Phase 2 live positive control, not assumed from an empty variable.

## Path hazards

- **The project path contains a space**: `C:\Users\SCSpeakers\Desktop\The TARDIS\SpeakersBureau`.
  Every shell command that references it must be quoted. Unquoted, PowerShell
  splits it at `The` and resolves to a nonexistent directory.
- PowerShell 5.1 is the shell. It does not throw on a failed native command:
  check `$LASTEXITCODE` after every `npm`/`git`/`node` call.

## Module resolution: `.ts` specifiers, when a src/lib module must load in bare Node

Verified 2026-10-05 (by hitting it, not by reading it).

- `tsconfig.json` extends `astro/tsconfigs/strict`, which sets
  `moduleResolution: "Bundler"` and `allowImportingTsExtensions: true`. So
  **Vite/Astro** resolve an extensionless relative import (`./months` ->
  `months.ts`) without complaint.
- **Bare Node does not.** Node's ESM resolver has no idea `months` means
  `months.ts`, and fails with `ERR_MODULE_NOT_FOUND`. Node 24 DOES strip
  TypeScript types when loading a `.ts` file, so `./months.ts` works in both.
- **Consequence:** any module under `src/lib/` that `npm test` or a `scripts/`
  CLI must import has to use explicit `.ts` specifiers. That diverges from the
  extensionless style used in `.astro` files, and it is load-bearing: the day
  someone "tidies" those specifiers, `node --test` breaks while `npm run build`
  keeps working, which is the worst possible split - the fast check passes and the
  slow one fails.
- **Corollary about this repo's own comments:** `src/lib/articles.ts` claims
  "node --test can import it directly (Node 24 strips the types)". No test
  imports that module, so the claim was never exercised, and it is false as
  written for the extensionless-import reason above. Do not inherit a claim about
  a code path - run it.
- `import x from './data.json' with { type: 'json' }` works in bare Node 24 and in
  the Astro build. That import-attribute form is the one in use here.

## Windows file encodings that will bite a hand-edited data file

- **`Out-File -Encoding utf8` and Notepad write a UTF-8 BOM on this machine.**
  `JSON.parse` rejects a leading BOM outright, and the resulting error points at
  the opening brace with "unexpected token" - which sends an author looking for
  a JSON syntax error that is not there. Observed live on 2026-10-05 via a probe
  that happened to write its scratch file that way.
  `scripts/check-events.mjs` strips it and diagnoses it;
  `test/events.test.mjs` asserts the committed `data/events.json` has none.
- When probing with PowerShell, prefer `node -e` with `fs` over PowerShell's
  file cmdlets for anything that must land byte-exact. Where a BOM does get
  introduced by accident, `[System.IO.File]::ReadAllText`/`WriteAllText` and
  `Get-FileHash` are the way to prove the repair rather than assume it.

## State at session start (2026-10-05)

- The project directory contained exactly one file, `ROADMAP.md`.
- It was **not** a git repository (no `.git`), and git init has deliberately not
  been run yet - the user is handling git.
- No `node_modules`, no `dist`, no `data/`, no `scripts/`, no `test/`.

## File authoring rule

Files in this project are authored only with the `write` / `edit` tools. The
shell never produces file content: no `Set-Content`, `Out-File`, `Add-Content`,
here-strings, or `>` redirection. On PS 5.1 an omitted `-Encoding` defaults to
ANSI and destroys bytes at write time.

Everything I author is ASCII only. Dashes are `-`. Curly quotes, en dashes and
em dashes are not used anywhere, in code, comments, docs or commit messages.
Text fetched from the internet is exempt: it is the authors' characters, not
ours, and it round-trips correctly through UTF-8 JSON.
