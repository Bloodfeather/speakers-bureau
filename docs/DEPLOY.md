# Publishing this site to GitHub Pages

This document takes you from "the site works on my computer" to "the site
updates itself every four hours, on its own, forever."

Everything here is a click in the GitHub website, except where it says
otherwise. You do not need a command line.

Read section 0 first. It tells you which parts are finished and which parts have
never been tried.

---

## 0. Honest status: what is done, and what is not

| Thing | State |
| --- | --- |
| The site builds on your computer | Works. Verified. |
| The feed fetcher writes `data/articles.json` | Works. Verified against live feeds. |
| `data/articles.json` is saved into the project's history | Yes, deliberately. |
| The automated publish file `.github/workflows/refresh.yml` | Written. **Never run.** |
| A GitHub repository for this project | **Not created. Section 1.** |
| A token so the automation can save its work | **Not created. Section 4.** |
| Automatic publishing switched on | Not yet. Section 5. |

**The honest part, stated plainly:** the automated publishing has never been
executed. It could not be - at the time it was written there was no GitHub
repository for it to run in, and no secret for it to use. It has been checked
to be valid and to contain the right steps, but "the file looks right" and "it
runs" are different things.

**The step most likely to fail first is the save-and-upload step in section 4's
token.** That is the piece nobody can check without a real repository. If
something goes wrong, look there first. The publish setting in section 5 is the
second most likely.

Section 8 is where you find out. Do not skip it.

---

## 1. Push this project to GitHub

You use GitHub Desktop, so do this in GitHub Desktop. It creates the GitHub
repository and links your local folder to it in one go.

1. Open GitHub Desktop and sign in.
2. **File > Add Local Repository...**
3. Choose the folder:

   ```
   C:\Users\SCSpeakers\Documents\GitHub\Speakers\Speakers
   ```

4. Click **Add Repository**. If the folder is already a git repository on the
   `main` branch, it appears in the list on the left straight away.
5. Click **Publish branch** in the top toolbar.
6. Fill in the form:
   - **Name**: choose the repository name now and write it down. You need it in
     sections 5 and 6. Use lowercase and hyphens, no spaces. For example
     `speakers-bureau`.
   - **Organization**: your own account is fine.
   - **Keep this code private**: your choice. Read section 2 before deciding.
7. Click **Publish repository**.

GitHub Desktop now creates the repository on github.com, sets it as the
`origin` for your local folder, and uploads your `main` branch.

### One thing that surprises people

**GitHub Desktop's list and the GitHub website are separate lists.** A
repository created on the website does not appear in GitHub Desktop's list
automatically. If you ever create one on the website, add it by hand with
**File > Add Existing Repository...** and paste the web address.

Publishing from GitHub Desktop is the shortest route here because your local
history is already intact.

---

## 2. Public or private: decide now

Decide this before section 5. Changing it later breaks the site address.

- **Public** - automatic publishing works on GitHub's free plan. This is the
  simple option, and the content is public anyway, since all of it is public
  writing by other people.
- **Private** - automatic publishing needs a paid GitHub plan. Your source code
  would be private, but the published website would still be public.

If you are not paying for a plan, the answer is **public**.

---

## 3. Check what actually got uploaded

Look at the repository on github.com in your browser. You should see:

- `data/articles.json` - the collected articles
- `.github/workflows/refresh.yml` - the automation. Hidden, because GitHub
  hides folders starting with a dot. Click into `.github`, then `workflows`, and
  confirm `refresh.yml` is there.
- `data/sources.yml` - the list of publications
- `README.md` and `docs/DEPLOY.md`

If `refresh.yml` is missing, the `.github` folder was never uploaded. That is
the single most common cause of the problem described in section 9, so check it
now rather than later.

---

## 4. Create the token, and save it in the repository

### What a token is, in one sentence

**A personal access token is a password that GitHub generates so that an
automated job can act as you, instead of needing your username and password.**

Why the automated job needs one: GitHub runs the scheduled job on a brand new,
empty computer, roughly six times a day. That computer has never seen your
laptop and has no access to your GitHub Desktop session. It has no memory of
your login. Without a token it has nothing to log in with, so it cannot save its
work back to your repository.

You create the token once. It does not expire quickly if you set a long
expiry, and nothing you do in GitHub Desktop needs it - it is only for the
automated job.

### Step 4a - generate the token

1. In your browser go to:

   ```
   https://github.com/settings/personal-access-tokens/new
   ```

   (The same page by clicking through: your profile picture > **Settings** >
   **Developer settings** > **Personal access tokens** > **Fine-grained
   tokens** > **Generate new token**.)

2. **Token name**: `SpeakersBureau CI`
3. **Expiration**: 1 year, or the longest your account allows.
4. **Set a calendar reminder for when it expires.** This matters more than it
   sounds: when the token expires, the automation starts failing, and you will
   not find out until you happen to look at the Actions tab weeks later.
5. **Resource owner**: your own account.
6. **Repository access**: choose **Only select repositories**, then pick this
   project. Do **not** choose **All repositories**. This token only needs to
   work on this one repository.
7. **Repository permissions**. Turn on exactly one:

   **Contents: Read and write**

   That is the only permission needed. It is the minimum required to save a
   commit. Leave every other permission at **No access**. In particular, leave
   **Workflows** at No access - this automation never edits its own definition,
   so it does not need it, and turning it on would hand out more access than
   required for no benefit.
8. Click **Generate token**, then copy the token. **It is shown once only.**
   If you lose it, delete it and make a new one. It takes a minute.

### Step 4b - save the token in the repository

1. Go to:

   ```
   https://github.com/<your-username>/speakers-bureau/settings/secrets/actions
   ```

   Swap `speakers-bureau` for whatever you named the repository in section 1.

2. Click **New repository secret**.
3. **Name**: type exactly

   ```
   PAT_TOKEN
   ```

   **This exact name, character for character.** The automation looks for
   `PAT_TOKEN` by name. If you call it `PAT` or `GITHUB_TOKEN` or
   `PAT-TOKEN`, the automation will not find it. It will fail at the moment it
   tries to save its work, several steps into the run, which looks like a
   mysterious failure rather than a typo.
4. **Secret**: paste the token you copied.
5. Click **Add secret**.

The token value is never shown again and never appears in any log. If you ever
need to replace it, delete the secret and add a new one.

---

## 5. Turn on automatic publishing, and point it at the automation

Two separate settings. Both are needed.

### 5a - Actions must be allowed to run

1. Go to:

   ```
   https://github.com/<your-username>/speakers-bureau/settings/actions
   ```

2. Under **Actions permissions**, select **Allow all actions and reusable
   workflows**.
3. Save.

### 5b - The website must be published by the automation, not from a branch

1. Go to:

   ```
   https://github.com/<your-username>/speakers-bureau/settings/pages
   ```

2. Find **Build and deployment**, then **Source**.
3. Choose **GitHub Actions**.
4. Save.

**Do not choose "Deploy from a branch".** That option publishes whatever is
sitting in `main` and ignores the finished website the automation uploads. If
it is set to branch, the site can look like it is working while actually serving
an old version, which is exactly the kind of quiet failure this project is
built to avoid.

5. GitHub reserves your address at the same time. It will look like:

   ```
   https://<your-username>.github.io/speakers-bureau/
   ```

### A GitHub habit worth knowing about

GitHub switches scheduled jobs off on a public repository after **60 days with
no activity at all**. Because the automation saves a commit whenever anything
changed, your repository stays active and this will not bite you. But if the
repository ever goes completely idle for two months, the schedule quietly stops
and the automation shows as switched off. You can switch it back on from the
Actions tab.

---

## 6. The base path: telling the site where it lives

This is the part people get wrong, and it has one visible symptom: **the site
loads but looks completely unstyled**, because the style file cannot be found.

Here is the reason. There are two kinds of GitHub website address:

| Kind | Address | Extra path? |
| --- | --- | --- |
| **Project repository** - a normal repository | `https://alice.github.io/speakers-bureau/` | **Yes**, the site lives in a folder called `speakers-bureau` |
| **User or organisation repository** - the repository name IS `alice.github.io` | `https://alice.github.io/` | No, the site is at the root |

Almost certainly you have a **project repository**, because that is what
section 1 created. So the site lives one folder down, and the build has to be
told that folder name.

**The base path is the repository name only.** For `alice.github.io/speakers-bureau/`
the base path is `/speakers-bureau`. Not the username. Not the full web address.
No trailing slash. Just the folder name, with a slash in front.

### How to set it

The build reads it from an environment variable called `BASE_PATH`, and falls
back to `/` (the root) when that variable is empty. `/` is correct for local
work on your own machine, and wrong for a project repository. So you tell
GitHub about it:

1. Go to:

   ```
   https://github.com/<your-username>/speakers-bureau/settings/variables/actions
   ```

2. Click **New repository variable**.
3. **Name**: `BASE_PATH`
4. **Value**: `/speakers-bureau` - your repository name from section 1, with a
   slash in front and nothing else.
5. Save.

You can also do this by hand, by setting `base` in `astro.config.mjs`. **If you
do it that way, there is exactly one place to change it: the `base` line of that
file.** Do not also type the folder name anywhere else in the project, and do
not add it to links in the page files. Two copies of the same path is two
chances to disagree.

You will know if you got it wrong the moment you visit the site: it appears, but
with no colours and no formatting at all. The automation also prints a warning
in the log when `BASE_PATH` is empty, which is the intended signal.

---

## 7. A real domain (optional, do it later)

**You do not need this to get the site live.** Do it only after section 8 has
worked, so you know the site works before you add domain records to your
registrar.

1. Go to `https://github.com/<your-username>/speakers-bureau/settings/pages`
2. In **Custom domain**, type your domain, for example `www.example.org`.
3. Save. Turn on **Enforce HTTPS** once GitHub has issued the certificate.

GitHub then shows you the DNS records to add at whoever sells your domain. For a
subdomain such as `www.example.org`, that is one record:

| Type | Name | Points to |
| --- | --- | --- |
| CNAME | `www` | `<your-username>.github.io` |

DNS changes take from a few minutes to 24 hours. GitHub shows the certificate
status on the same settings page and only turns green when it can serve the
site.

For a bare domain with no `www`, GitHub's DNS setup is different and their
instructions change over time. Follow what the Pages settings page currently
says rather than any written-down list.

**Once your own domain works, set `BASE_PATH` to `/`** (section 6), because the
site is then at the root of your domain rather than in a folder.

---

## 8. Run it once by hand: the actual test

Everything above makes the automation *possible*. This step is what proves it
*works*.

1. Go to:

   ```
   https://github.com/<your-username>/speakers-bureau/actions
   ```

2. Click **refresh** in the list on the left.
3. Click **Run workflow**, choose `main`, confirm.
4. **Watch it run.** This is not optional. Nothing before this point tested the
   automation at all.

Expect about three to five minutes.

### What each outcome means

**Green, and it saved a commit** - the normal case. You are looking for a commit
on `main` whose message starts `data: refresh dataset (+N added...`, followed by
a step called **deploy to pages** with a link. Open that link.

**Green, but no new commit** - also normal. Nothing new was published by any
publication since last time, so there was nothing to save. The website is
still rebuilt and republished.

**Red at "fetch feeds (fail loud)"** - a publication feed failed its checks. The
log names each publication, its status, and the exact reason. Nothing was saved
and **nothing was published**, so the site you had stays up, which is the
intended behaviour. Fix the entry in `data/sources.yml`, save it in GitHub
Desktop, and run again.

**Red at "commit and push the dataset"** - the token is the problem, almost
certainly. See section 9.

**Red at "deploy to pages"** - the publishing setting in section 5b is wrong, or
the site could not be built.

### About the schedule

Timed jobs on GitHub are not precise. The first automatic run can be up to
about 15 minutes later than its nominal time. It runs roughly every four hours:
around 00:17, 04:17, 08:17, 12:17, 16:17 and 20:17 UTC.

---

## 9. When something does not work

### The automation does not appear under the Actions tab at all

**Symptom:** you open the Actions tab and there is no `refresh` in the list.
Often the tab is completely empty.

**Why:** GitHub has not been told that this repository uses Actions. This is
also the symptom when the `.github` folder was never uploaded, because a missing
file means there is no automation to show.

**Fix:**
1. Check `refresh.yml` exists at
   `https://github.com/<your-username>/speakers-bureau/blob/main/.github/workflows/refresh.yml`.
   If the page 404s, the folder was not uploaded: open GitHub Desktop, and make
   sure `.github` is included in the next publish.
2. Go to `.../settings/actions` and set **Allow all actions and reusable
   workflows**.

### The run went red and the publish step is greyed out

**Symptom:** a red job called `fetch and commit dataset`, and below it
`build and deploy to pages` shown as **skipped** or greyed.

**Why, and this is deliberate:** the two steps are tied together on purpose. If
the fetch fails, the site is **not** republished, and GitHub keeps serving the
version that was published last. Publishing anyway would put a fresh-looking
timestamp on content that is days out of date, which would be a lie with a
success badge on it. A greyed publish step next to a red fetch step is the
system working correctly, not a second problem.

**Fix:** the answer is in the red step's log. Scroll to
**fetch feeds (fail loud)** and read the report. Each failing publication is
listed with the reason, for example a feed that returned an HTML page instead of
RSS. Correct that entry in `data/sources.yml`, publish it from GitHub Desktop,
then run the automation again by hand.

**What you must not do:** do not "fix" it by making the fetch step ignore
failures. There is no switch for this, and that is on purpose.

### The site gives a 404, or loads with no styling

**Symptom, two forms.** Either the address 404s entirely, or the page appears
with no colours and no formatting - plain unstyled text.

**Why:** two different causes, one symptom each.

- **404 on the whole address:** the Pages source in section 5b is not set to
  **GitHub Actions**. Check `.../settings/pages`.
- **Page loads, no styling:** the base path in section 6 is wrong or not set.
  Every style and script file is requested from the wrong folder, so none of
  them are found. Set `BASE_PATH` to `/your-repository-name` exactly.

**Quick check:** the site's own log page is in the same place whether or not it
is styled. If the address works but the page is unstyled, it is the base path,
every time.

### A permission or sign-in error when it tries to save the commit

**Symptom:** the red step is `commit and push the dataset`, and the log says
something about authentication, a rejected push, or permission denied.

**Why, in order of likelihood:**
1. The secret is not named exactly `PAT_TOKEN`. A near-miss name is not found.
2. The token expired.
3. The token was deleted or revoked.
4. The token has the wrong permission, or is not restricted to this repository.
5. Branch protection rules were added later and block the push (see below).

**Fix:** open
`https://github.com/<your-username>/speakers-bureau/settings/secrets/actions`.
You should see a secret named `PAT_TOKEN` and no others. If it is missing, or
if the token has expired, create a new token in section 4a and update the
secret in 4b. Confirm it has exactly one permission on: **Contents: Read and
write**.

**If you ever add branch protection to `main`:** rules that require review, or
that stop anyone pushing directly, will reject the automation's push. Either
allow the automation to bypass the rule, or accept that the automated commit
will fail until someone saves it by hand. No protection rules are set up today,
so this only matters if you add them later.

### Nothing happens for hours and no runs appear

**Why:** GitHub switches scheduled jobs off after 60 days of no repository
activity, and queued timed jobs can be delayed when GitHub is busy.

**Fix:** open the Actions tab and run it by hand (section 8). If the schedule
still does not appear, re-enable it there. As long as the automation is saving
commits, the repository is never idle.

### The build fails on the events file

**Symptom:** the `build` step is red and the log mentions `events.json`.

**Why:** a hand-edited event has a misspelled key, a missing image, or a bad
date.

**Fix:** on your own computer, run:

```
npm run events:check
```

It lists **every** problem at once rather than stopping at the first, including
any image file it could not find. `data/events.schema.md` is the written
contract for the file.

---

## 10. Confirming it is genuinely updating

After the first automatic run:

- In GitHub Desktop, click **Fetch origin**. A new `data: refresh dataset`
  commit appears when anything changed.
- The Actions tab shows a run about every four hours. **A run is not proof of
  success.** Open it and read the steps. A run that saved nothing because
  nothing changed is still a healthy run.

---

## 11. Known loose ends

### The site address in the configuration file is a placeholder

`astro.config.mjs` currently has:

```js
site: 'https://example.org',
```

This must become your real address before the site is finished. It is not
cosmetic. The build uses it to write the absolute addresses that go into the
"this is the canonical page" tags on every page, the sitemap, and the social
preview links. Left as it is, every one of those points at a domain that is not
yours - bad for search engines, and invisible in a browser.

Set it to the final address with no trailing slash:

- your own domain, including `www` if you use it:
  `https://www.example.org`
- or, with no domain of your own, `https://<your-username>.github.io`

It has been left as a marked placeholder on purpose. Guessing a domain into a
config file would be worse than an obvious blank.

### Third-party actions are referenced by version, not pinned

`refresh.yml` uses version tags such as `actions/checkout@v4` rather than pinned
commit hashes. That is the usual practice and it keeps the file readable, but it
does mean a future release from that project could change behaviour. If exact
reproducibility ever matters, pinning to commit hashes is the fix.

### The dependency audit reports known problems

`npm audit` reports problems in the Astro dependency tree that predate this
project and have not been triaged. They do not stop the site from publishing.

**Do not run `npm audit fix --force`.** It upgrades across major versions and
can break the build.

---

## Where things are

| Thing | Where |
| --- | --- |
| The automation | `.github/workflows/refresh.yml` |
| The feed fetcher | `scripts/fetch-feeds.mjs` |
| The collected articles | `data/articles.json` |
| The publication list you edit | `data/sources.yml` |
| Build configuration | `astro.config.mjs` |
| Why the project is built this way | `ROADMAP.md` |
| Work log | `build-log.md` |
| What this project is | `README.md` |

---

**Before you start:** section 8 is the real test. Everything before it only
makes the automation possible. Nothing before it proves it works.