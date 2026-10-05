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
