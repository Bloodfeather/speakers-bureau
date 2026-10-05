# DEPLOY.md - publishing SpeakersBureau to GitHub Pages

How to get from "this works on my machine" to "the site updates itself every 4
hours". Written for someone doing this for the first time in a browser.

Every step below is a click in the GitHub web interface. Nothing here requires
the command line, and **nothing here has been performed yet**: this repository
has no remote yet, and the steps in sections 1 through 5 are all waiting on the
repository being created.

---

## 0. What is already done, so you know where to stop

| Piece | State |
| --- | --- |
| The site builds locally (`npm run build`) | Working, verified |
| The fetch pipeline writes `data/articles.json` | Working, verified |
| `data/articles.json` is committed | Yes, on purpose |
| `.github/workflows/refresh.yml` exists | Written, **never executed** |
| This document exists | Yes |
| A GitHub repository | **Not created. That is step 1.** |
| A PAT | **Not created. That is step 4.** |
| Pages enabled | No. Step 5. |
| Real domain wired up | No. Steps 6 and 7. |

The workflow file is not known to work. It has been checked for valid YAML and
for the structure it claims to have, but no run has happened, because a run
needs a repository and a secret. The first manual run in step 8 is the real
test, and it is worth watching.

---

## 1. Create the repository

**Recommended: do this in GitHub Desktop**, since you are already using it and it
handles the local folder and the remote in one step.

1. Open GitHub Desktop and sign in.
2. **File > Add Local Repository...**
3. Choose `C:\Users\SCSpeakers\Desktop\The TARDIS\SpeakersBureau`
   (the path has a space in it; the file picker handles it, a typed command
   might not).
4. Click **Add Repository**. If it is already a git repository on `main`, it
   shows up in the left-hand list immediately.
5. Click **Publish branch** in the toolbar.
6. Fill in the form:
   - **Name**: pick the repo name now and remember it. You need it twice below
     (the `base` path in `astro.config.mjs` and the custom domain decision).
     Lowercase, hyphens, no spaces, for example `speakers-bureau`.
   - **Organization**: your personal account is fine. The Pages URL will be
     `https://<your-username>.github.io/<repo-name>/`.
   - **Keep this code private**: your call. A **public** repository is required
     if you want Pages on the free plan without GitHub Pro. A **private**
     repository needs a paid plan for Pages.
7. Click **Publish repository**.

GitHub Desktop now creates the repository on github.com, adds it as the `origin`
remote, and pushes your `main` branch to it.

### One thing that surprises people

**GitHub Desktop's repository list is separate from repositories created
elsewhere.** A repo you create on the website, or with a command line tool, does
NOT appear in GitHub Desktop's left-hand list until you add it yourself:

- **File > Add Local Repository...**, then paste the GitHub URL in the
  "Repository URL" box, or
- **File > Add Existing Repository...** and paste the clone URL.

If you create the repository on the website instead of in GitHub Desktop, your
local folder needs its `origin` set separately. Since you already have a clean
local repo with 29 commits, **publishing from GitHub Desktop is the path of
least resistance** and keeps the history intact.

---

## 2. Decide public or private first

This affects step 5 and cannot be changed later without breaking the URL.

- **Public**: Pages works on the free plan. The feed content is public anyway,
  because it is all public Substack writing.
- **Private**: Pages needs GitHub Pro, Team, or Enterprise. Your source code is
  private but the published site is public either way.

---

## 3. Confirm what was pushed

Back in the project folder, or in GitHub Desktop's History tab, you should see
all 29 files including:

- `data/articles.json` (the generated dataset)
- `.github/workflows/refresh.yml`
- `docs/DEPLOY.md` (this file)

If `.github/workflows/refresh.yml` is missing from github.com, the `.github`
folder was probably never committed. Check in the file browser.

---

## 4. Create the PAT

The scheduled Action runs on a fresh GitHub runner every 4 hours. That runner
has **no stored credentials and no access to your GitHub Desktop session**, so
it cannot push unless you give it a token. This cannot be left implicit; there is
no default that works.

**Why a secret at all?** `GITHUB_TOKEN` would also be able to push, and it is a
reasonable alternative. The workflow uses a PAT instead because it is scoped to
one repository and does not depend on the repository's default workflow token
permissions. Either way the step is identical: create a credential, store it as
a repository secret, reference it by name.

### Creating it

1. Go to <https://github.com/settings/personal-access-tokens/new>
   (Settings > Developer settings > Personal access tokens > Fine-grained
   tokens > Generate new token).
2. **Token name**: `SpeakersBureau CI`
3. **Expiration**: 1 year, or the maximum your account allows. Set a calendar
   reminder, because **when this token expires the scheduled workflow starts
   failing and only shows up as a red action six hours later**.
4. **Resource owner**: your account.
5. **Repository access**: **Only select repositories**, then choose
   `SpeakersBureau` (whatever you named it). Not "All repositories".
6. **Repository permissions**. Set exactly one:
   - **Contents: Read and write** - this is the minimum for pushing the
     dataset commit, and it is the ONLY permission required.

   Leave everything else at "No access". In particular:
   - **Workflows: Read and write** - **not needed**. The workflow never edits
     its own definition. Granting it would be a real privilege increase for no
     reason.
   - **Administration**, **Secrets**, **Pages**, **Actions** - all **not needed**.
     Pages deployment uses the workflow's own OIDC identity, not the PAT.
7. Click **Generate token** and copy it. It is shown once.

### Adding it as a repository secret

1. Go to `https://github.com/<your-username>/<repo-name>/settings/secrets/actions`
2. Click **New repository secret**.
3. **Name**: `PAT_TOKEN`
   **This exact name.** The workflow references `${{ secrets.PAT_TOKEN }}`; a
   secret named `PAT` or `GITHUB_TOKEN` will not be found, and the workflow will
   fail at the push step rather than at the start.
4. **Secret**: paste the token.
5. Click **Add secret**.

The token value is never displayed again and never appears in logs.

### If you ever add branch protection

If branch rules are ever enabled on `main` and they require review or restrict
who can push directly, the scheduled push will be **rejected**. Two options:

- Allow the bypass so the workflow can push (Settings > Branches > edit the rule
  > "Do not allow bypassing the above settings" must be **unchecked**, and
  `github-actions` must be listed as an allowed bypass actor), or
- Leave protection on and accept that the automated commit fails until someone
  pushes manually.

Nothing is configured today, so this only matters later.

---

## 5. Enable Actions, then set Pages to publish from the workflow

### Actions must be enabled at all

1. `https://github.com/<user>/<repo>/settings/actions`
2. Under **Actions permissions**, "Allow all actions and reusable workflows"
   must be selected.

### Pages source

1. `https://github.com/<user>/<repo>/settings/pages`
2. Under **Build and deployment > Source**, choose **GitHub Actions**.

**Do not choose "Deploy from a branch".** That setting publishes from `main` and
ignores the artifact this workflow uploads. With it set to "Deploy from a
branch" the site may appear to work while actually serving an old commit, which
is the exact failure this project is trying to make impossible.

3. Save. GitHub will reserve `https://<user>.github.io/<repo>/`.

### A GitHub gotcha worth knowing

**GitHub disables scheduled workflows on public repositories after 60 days of
inactivity.** The site keeps deploying because the commits count as activity,
but if the repo ever goes fully idle for two months the schedule silently stops
and the workflow shows as disabled. It can be re-enabled from the Actions tab.

---

## 6. Set BASE_PATH (repository variable)

`astro.config.mjs` reads `process.env.BASE_PATH` and falls back to `/` when it
is unset. This is deliberate: local development runs at the root, and only CI
serves from a subpath.

- **User or organization repo** (`<user>.github.io/<repo>/`): still served from
  a subpath, so `BASE_PATH` must be `/<repo-name>`. Almost always needed.
- **Custom domain** (see step 7): the site is served from the root, so
  `BASE_PATH` must be `/` or empty.

Set it as a **repository variable** (not a secret):

1. `https://github.com/<user>/<repo>/settings/variables/actions`
2. **New repository variable**
3. **Name**: `BASE_PATH`
   **Value**: `/speakers-bureau` (your repo name, no domain, no trailing slash)
4. Save.

If you get this wrong the symptom is unmistakable: the page loads but is
unstyled, because every asset URL 404s. The workflow prints a `::warning::`
annotation when `BASE_PATH` is empty, which is the intended signal.

---

## 7. Set the domain

**Not required to get the site live.** Do this after the first successful
deploy, so you can confirm Pages works before adding DNS.

1. `https://github.com/<user>/<repo>/settings/pages`
2. **Custom domain**: enter the domain, for example `www.speakersbureau.org`.
3. Save, then enable **Enforce HTTPS** once the certificate is issued.

GitHub then shows the DNS records required. For a **subdomain** (recommended to
start, because apex domains are fussier), add one CNAME:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `www` (or your subdomain) | `<user>.github.io` |

DNS can take up to 24 hours, usually minutes. GitHub's Pages status is visible
on the same settings page, and it turns green only when it can serve a
certificate.

For an **apex domain** (`speakersbureau.org` with no subdomain) the DNS setup is
four A records plus an optional ALIAS/ANAME record, and GitHub's instructions
change over time. Read what the Pages settings page currently says rather than
following any list including this one, including this one.

**After the domain is live**, go back and set `BASE_PATH` to `/` (step 6), since
the site is no longer served from a subpath.

---

## 8. The first manual run - the actual test

Everything above makes the workflow *possible*. This step is what proves it
works.

1. `https://github.com/<user>/<repo>/actions`
2. Click **refresh** in the left-hand list.
3. Click **Run workflow**, pick branch `main`, confirm.
4. **Watch it.** This is not optional. The workflow has never executed, and the
   things most likely to be wrong are the git push and the Pages source setting,
   neither of which any local check can catch.

### Reading the result

**Green, with a commit** - the normal case. Look for a commit on `main` titled
`data: refresh dataset (+N added, -N removed, N articles)`, then a "Deploy to
pages" entry with a link to the live site. Visit that link.

**Green, no commit** - also normal. Nothing new was published by any feed, so
there is nothing to commit and no commit is made. This is the designed
behaviour; the deploy still runs and the site is still republished.

**Red at "fetch feeds (fail loud)"** - a feed failed validation. The step log
names each source, its HTTP status, its resolved URL and the exact reason.
Nothing was committed and **nothing was deployed**; the previously published
site stays live, which is the intended behaviour (see the decision note at the
top of `refresh.yml`). Fix the feed in `data/sources.yml`, push, and re-run.

**Red at "commit and push"** - the token or permissions are wrong. Verify the
secret is named exactly `PAT_TOKEN`, and that the token still exists and has
not expired. If branch protection was enabled, see the note in step 4.

**Red at "deploy to pages"** - usually the Pages source setting (step 5) or a
missing `pages: write` permission on the job.

### Waiting for the schedule

Cron schedules are not precise. The first scheduled run can take up to about 15
minutes past the hour, and the deploy lands a couple of minutes after that. The
cron is `17 */4 * * *`, so roughly six runs a day: around 00:17, 04:17, 08:17,
12:17, 16:17 and 20:17 UTC.

---

## 9. Verifying it is actually updating

After the first scheduled run:

- `git log --oneline -5` locally after fetching shows a new `data: refresh`
  commit when anything changed.
- The Actions tab shows a run roughly every 4 hours. **Runs are not proof of
  success.** A run that skips the commit because nothing changed is still
  working. Look at the step list, not just the colour.
- Commit messages carry real counts. If you see `+0 added, -0 removed` with a
  commit, that means a non-article field changed (a resolved URL, or an item
  count), which is legitimate and rare.

---

## Open items that block a complete deployment

### `astro.config.mjs` has a placeholder domain

```js
site: 'https://example.org',
```

**This must be changed to the real domain before handover.** It is not
cosmetic. Astro uses `site` to build the absolute URLs that go into:

- `<link rel="canonical">` on every page
- `sitemap.xml`
- RSS feed URLs
- Open Graph image URLs

Left as `https://example.org`, every canonical tag on the live site points at a
domain that does not belong to you. That is bad for search indexing, and it is
the kind of thing that looks fine in a browser and is wrong to a crawler.

Change it to the final domain, including `www` if the domain uses it, with no
trailing slash:

- `https://www.speakersbureau.org` for a custom domain
- `https://<user>.github.io` for a Pages URL with no custom domain (note: with
  no custom domain, `site` is the user page root and `base` carries the repo
  name)

**Not changed in this phase**, deliberately: the domain is not decided yet, and
guessing it into a config file would be worse than leaving a marked placeholder.

### The repo name is also the URL path

`base` must be `/<repo-name>` for a project repo. A mismatch between the repo
name and `BASE_PATH` produces an unstyled page rather than a 404, which is a
confusing failure to debug.

### Package versions are not pinned

The workflow uses major version tags (`actions/checkout@v4`,
`actions/setup-node@v4`, `actions/upload-pages-artifact@v3`,
`actions/deploy-pages@v4`) rather than pinned SHAs. This is the common practice
and keeps the file readable, but it does mean a future upstream release could
change behaviour. If this ever needs to be reproducible forever, pinning to
commit SHAs is the upgrade.

### Pre-existing dependency advisories

`npm audit` reports 3 vulnerabilities in the Astro 5.18 tree (1 low, 1 high, 1
critical) that predate this project and have not been triaged. They do not block
deployment. **`npm audit fix --force` must not be run**: it bumps majors and can
break the build.

---

## Where things are

| Thing | Where |
| --- | --- |
| The workflow | `.github/workflows/refresh.yml` |
| The fetch pipeline | `scripts/fetch-feeds.mjs` (exits 1 on any feed failure) |
| The dataset | `data/articles.json` (committed on purpose) |
| The feed list you edit | `data/sources.yml` |
| The design decisions | `ROADMAP.md` |
| The session history | `build-log.md` |

---

**Last reminder before you start**: step 8 is the real test. Everything before
it makes the workflow possible; nothing before it proves it works.