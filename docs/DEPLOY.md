# Publishing this site to Cloudflare

> **THIS DOCUMENT IS PARTLY OUT OF DATE. READ THIS FIRST.**
>
> The site is published to **Cloudflare Workers with Static Assets**, not to
> Cloudflare Pages. That was settled by what is actually deployed - the live
> address is a `workers.dev` one - and it is now recorded in `wrangler.jsonc` at
> the repository root, which is the authoritative statement of how the site is
> published.
>
> **What that means for the instructions below:**
>
> - **Section 4 is now a tombstone.** There is **no GitHub token to create**.
>   `PAT_TOKEN` was deleted on 2026-10-09 and must not be recreated; the automatic
>   `GITHUB_TOKEN` pushes the dataset. Section 4 explains why.
> - **Sections 1-3 are still correct.** The GitHub repository, the public/private
>   decision, and checking what got uploaded are all unchanged.
> - **Section 5 is wrong.** There is no drag-and-drop upload for Workers static
>   assets. The site was first published by hand, which is how it came to be on
>   Workers, but that route does not exist for the platform we now target. The
>   automatic route in section 8 is the route.
> - **Section 7 is correct and now carries the most important warning in this
>   document:** do **not** set Client IP Address Filtering on the Cloudflare
>   token. That single setting broke the deploy for a day.
> - **Section 8 lists one setting too many.** There is no
>   `CLOUDFLARE_PAGES_PROJECT` variable any more, and no `PAT_TOKEN` secret. Two
>   secrets remain, both Cloudflare.
>
> The repository is at <https://github.com/Bloodfeather/speakers-bureau> and the
> live site is at the `workers.dev` address in that repository's description.
>
> **Automated publishing works as of 2026-10-09** (run 37965253177, the first
> fully green run in the project's history). See `SITUATION.md` section 6 for the
> three stacked faults that had to be cleared to get there.

# (superseded heading) Publishing this site to Cloudflare Pages

This document takes you from "the site works on my computer" to "the site
updates itself every six hours, on its own, forever," published at
**scspeakersbureau.org**.

Almost everything here is a click in a website. You should not need a command
line.

Read section 0 first. It tells you which parts are finished and which parts have
never been tried.

---

## 0. Honest status: what is done, and what is not

| Thing | State |
| --- | --- |
| The site builds on your computer | Works. Verified. |
| The feed fetcher writes `data/articles.json` | Works. Verified against live feeds. |
| `data/articles.json` is saved into the project's history | Yes, deliberately. |
| The domain is set in `astro.config.mjs` | Done. `scspeakersbureau.org`. |
| The publish file `.github/workflows/refresh.yml` | **Working.** First fully green run 2026-10-09. |
| A GitHub repository for this project | Created. |
| A GitHub token, so the automation can save its work | **Not needed, and must not be created.** See section 4. |
| A Cloudflare account and Worker | Created. `bold-unit-b37a`. |
| Cloudflare tokens for the automation | Created. Sections 6 and 7. |
| Automatic publishing switched on | **On.** Every 6 hours, and on every push to `main`. |

**The honest part, stated plainly:** this document was written before any of it
had been executed, and it was wrong about one thing that mattered - it told you
to create a GitHub token. That instruction cost three days. Everything is now
verified by a real green run, and section 4 has been rewritten to say so.

---

## How the two systems fit together

This is the part that is genuinely unusual, so read it before anything else.

Your site is **built on GitHub** and **hosted at Cloudflare**. Both are needed:

- **GitHub** runs the timer and saves your work. Every six hours it fetches the
  feeds, and if anything changed it saves a commit. That commit is why you can
  always answer "why is this article on my site?"
- **Cloudflare** stores the website itself and serves it to visitors.

So there is no single company holding everything. That is normal for this kind
of setup and costs nothing - both have generous free tiers.

### The settings the automation needs

| Name | Kind | What it is | State |
| --- | --- | --- | --- |
| `FEED_EGRESS_TOKEN` | Secret | Shared key that lets the fetch reach the feeds. | Set |
| `CLOUDFLARE_API_TOKEN` | Secret | Lets the automation publish the built site to Cloudflare. Section 7. | Set |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Tells Cloudflare which account is yours. Section 6. | Set |

**Three settings, all present. There is no GitHub token among them** - the
automatic `GITHUB_TOKEN` pushes the dataset, and a `PAT_TOKEN` must not be
created. See section 4.

`FEED_EGRESS_TOKEN` was added on 2026-10-07 to fix a problem you should know
about, because it will look like something is broken otherwise.

### Why there is a Worker in the middle of the fetch

GitHub's own servers cannot read these feeds. Every publication answers **HTTP
403** to a request from a GitHub Actions runner, with a page titled "Just a
moment...", while an ordinary website answers normally from the very same
computer. That is an automated security check at the network level, reacting to
the fact that the request comes from a datacentre rather than from a person. It
is not a refusal by the publications, and it is not something you did wrong.

So the request is made from a small helper of ours that runs on Cloudflare
instead, and it passes. **This is already working** - the most recent scheduled
run fetched all four publications successfully.

If you ever see `HTTP 403 Forbidden` for every feed at once, this is why, and the
fix is not to change anything in the project. Check that `FEED_EGRESS_TOKEN` is
still set, and that the helper is still deployed.

The helper deliberately fetches and returns the raw feed **without interpreting
it**. Which articles appear on the site is still decided by the project's own
code, which is tested. That separation is intentional and should be preserved.

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
   - **Name**: choose the repository name now and write it down. Use lowercase
     and hyphens, no spaces. For example `speakers-bureau`.
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

---

## 2. Public or private: decide now

Decide this before section 8. Changing it later breaks the automation.

- **Public** - scheduled jobs work on GitHub's free plan. This is the simple
  option, and the content is public anyway, since all of it is public writing by
  other people.
- **Private** - scheduled jobs need a paid GitHub plan.

If you are not paying for a plan, the answer is **public**.

---

## 3. Check what got uploaded

Look at the repository on github.com in your browser. You should see:

- `data/articles.json` - the collected articles
- `.github/workflows/refresh.yml` - the automation. Hidden, because GitHub
  hides folders starting with a dot. Click into `.github`, then `workflows`, and
  confirm `refresh.yml` is there.
- `data/sources.yml` - the list of publications
- `README.md` and `docs/DEPLOY.md`

If `refresh.yml` is missing, the `.github` folder was never uploaded. That is the
single most common cause of the problem described in section 12, so check it now
rather than later.

---

## 4. There is no GitHub token to create. This section was removed 2026-10-09.

**You do not need to create a `PAT_TOKEN`, and you should not.** If one exists in
your repository settings, delete it.

This section used to walk through generating a fine-grained personal access token
with *Contents: Read and write*, saving it as `PAT_TOKEN`, and setting a calendar
reminder for its expiry. All of that is unnecessary, and following it is what
broke this project for three days.

### Why it was never needed

The `refresh` job in `.github/workflows/refresh.yml` grants itself
`permissions: contents: write`. A job-level grant **overrides** the repository's
default workflow-token permission, which is `read`. That means the automatic
`GITHUB_TOKEN` - which every Actions run receives with no setup at all - already
has everything `git push` requires.

The workflow file said so all along:

> `GITHUB_TOKEN would also be able to push, and that is the honest alternative.`

### Why the token made things worse

The checkout step used this expression:

```
token: ${{ secrets.PAT_TOKEN || github.token }}
```

That looks like a safe fallback and is the exact opposite. The `||` only falls
through when the left side is **unset**. While `PAT_TOKEN` existed - even set to
a token that was invalid, expired, or scoped to the wrong repository - it always
won, and the working `GITHUB_TOKEN` underneath was never reached.

The result was 25 consecutive failed runs, every one failing at the same place
with the same message:

```
remote: Permission to Bloodfeather/speakers-bureau.git denied to Bloodfeather.
```

And because a guard step existed that asserted `secrets.PAT_TOKEN` was *set*, the
failure read as "this credential needs repairing" when the correct answer was
"delete this credential".

### What to do instead

Nothing. There is no secret to create, nothing to paste, and nothing to put a
calendar reminder on. The push works because the job grants `contents: write`,
which is visible in the workflow file and reviewable in a pull request.

If the push is ever refused, that grant is what to check - not a token.

---

## 5. Create the Cloudflare Pages project, and see the site live

**This is the part that gets you a working website today, before any automation
exists.** Do this section even if you intend to read the rest.

You will drag the already-built `dist` folder onto Cloudflare. You do not need
to build anything first - the folder is ready.

### Step 5a - create the project

1. Go to <https://dash.cloudflare.com> and sign in.
2. In the left menu click **Workers & Pages**.
3. Click **Create application**, then **Get started**, then **Drag and drop your
   files**.
4. Type your project name. This name matters and you will need it in section 8,
   so choose it carefully and write it down. Use lowercase letters, hyphens and
   nothing else. For example:

   ```
   scspeakersbureau
   ```

5. Drag the whole `dist` folder onto the upload box, or click it and pick the
   folder. Either works.
6. Click **Deploy site**.

Wait a minute or two, then visit:

```
https://scspeakersbureau.pages.dev
```

That is your site, live, on the internet.

**Write down the project name you chose.** It is the value of
`CLOUDFLARE_PAGES_PROJECT` in section 8. If Cloudflare tells you the name was
taken and it added characters, use the name it actually gave you.

### Why dragging the folder in is the right first step

You are creating the project as a "Direct Upload" project. That is exactly what
the automatic publishing in section 8 needs, and the two work together: you can
drag a folder in by hand today, and the automation can replace it every six
hours tomorrow, into the same project, at the same address.

**One thing to know, so it does not surprise you later:** you cannot connect a
Direct Upload project to Cloudflare's own Git-based building later. You do not
want to. The automation in section 8 builds the site on GitHub and uploads the
finished result, which is what gives you the "a failed feed must not publish"
guarantee described in section 13. Connecting Cloudflare directly to GitHub
would take that control away.

### Step 5b - attach your domain

You can do this now or later. Doing it now means you never have to think about
`pages.dev` addresses again.

1. In **Workers & Pages**, click your project.
2. Find **Custom domains** and use **Set up a custom domain**.
3. Enter `scspeakersbureau.org`.
4. Follow the instructions Cloudflare shows.

**If you already use Cloudflare for your domain** - that is, if you have already
pointed your domain's nameservers at Cloudflare - this is a single click and
Cloudflare handles the certificate for you.

**If your domain is registered somewhere else**, Cloudflare will give you a
nameserver to set at your registrar. That is a bigger change than it looks and
it affects your email and every other service using that domain, so it is worth
doing deliberately rather than in a hurry.

**Do not do this section yet if you are unsure.** The site is already fully live
at the `pages.dev` address from step 5a. The domain is a convenience, and there
is no rush. This document will still be here.

Once the domain works, nothing else in this project changes. The site is served
from the root of the domain, which is the one arrangement that needs no extra
configuration - section 10 explains why there is nothing to set.

---

## 6. Find your Cloudflare Account ID

1. Go to <https://dash.cloudflare.com>.
2. Click **Workers & Pages**, then your project.
3. Look for the **Account ID**. Depending on the dashboard layout it is shown in
   the project overview, or on the **Zone Overview** page for your domain, in
   the right-hand **API** section.
4. Copy it. It is a long string of digits and letters.

Save it now, you need it in section 8. If you cannot find it, section 12 has
where else to look.

---

## 7. Create the Cloudflare API token

### What this token is, and why it is not your password

This is a password **for Cloudflare's API**, scoped to exactly one job:
publishing your website. It is not your Cloudflare login, it cannot read your
email, and it cannot change your DNS.

Two things about it are deliberate:

- It has **one permission**: publish Pages sites. It cannot read billing, cannot
  read your DNS records, and cannot touch Workers, storage or databases.
- It is **restricted to your one account**, so it cannot publish anywhere else
  even if it leaked.

### Step 7a - generate it

1. Go to the **API Tokens** page in the Cloudflare dashboard:
   <https://dash.cloudflare.com/?to=/:account/api-tokens>
2. Click **Create Token**.
3. Under **Custom Token**, click **Get started**.
   **Or, faster and less error-prone: use the "Edit Cloudflare Workers" template**
   in the list above it. That template already grants exactly the permissions
   this project needs, and you can skip straight to step 7.
4. **Token name**: `SpeakersBureau Worker Publisher`
5. **Permissions**. These are the minimum for this project:

   | Account | Permission | Access |
   | --- | --- | --- |
   | Account | Workers Scripts | Edit |
   | Account | Account Settings | Read |

   **Not** "Cloudflare Pages". Earlier versions of this document said Pages, which
   was wrong: this site is published as a Worker, not as a Pages project, so a
   Pages-only token deploys nothing. If you get "Not enough permissions to
   deploy", check this table first.

   You do **not** need Workers KV Storage, Workers R2 Storage or Workers Routes:
   this site uses none of them.

6. **Client IP Address Filtering: LEAVE THIS EMPTY.** Do not set it to your home
   or office address. See the warning below - this is the setting that broke the
   deploy for a day.
7. **Account Resources**: restrict it to the account that owns your project.
8. Click **Continue to summary**, then **Create Token**.
9. **Copy the token now. It is shown once only.** If you lose it, delete it and
   make another.

### The IP filter is the trap. Do not set it.

Cloudflare offers **Client IP Address Filtering** under the token's *Additional
settings*. It is a sensible-looking security feature and it **will break this
project**, because the deploy runs from a GitHub Actions runner in a Microsoft
Azure datacentre, not from your computer.

The symptom is distinctive and worth memorising:

```
Authentication error [code: 10000]
Cannot use the access token from location: 40.75.133.96 [code: 9109]
```

That address is an Azure range. The token works perfectly from `curl` on your own
machine and fails only in CI - **that asymmetry is the tell.** A token that works
locally and fails in the pipeline is an IP-filter problem, not a permissions
problem.

**Set it to "Not restricted".** One more subtlety, from Cloudflare's own
community: an **empty** condition block is *not* the same as no filter. An empty
block defaults to deny and produces the identical `9109`. If you use the
**"Edit Cloudflare Workers"** template and never open the IP section, you are
safe.

### If the token is rejected, decode the code before changing anything

These four codes mean four different things, and guessing between them is what
cost the most time here:

| Code | Means | Fix |
| --- | --- | --- |
| `6111` | The header value is **malformed** - checked before the token is looked up | Value must be exactly 40 chars of `[A-Za-z0-9_-]`, with no `Bearer ` prefix and no quotes |
| `1000` | The token is genuinely **invalid, revoked or expired** | Create a new one |
| `9109` | The token has an **IP filter** | Remove the IP restriction |
| `10000` | **Permissions** are wrong | Check the table in step 5 |

**`6111` is not caused by a trailing newline or space** - an earlier version of
this document said so, and it was measured to be wrong (whitespace returns
`1000`). `6111` means the value contains something outside the token charset:
most often a pasted `Bearer ` prefix, surrounding quotes, or a truncation.

To check a token before pasting it into a secret, without exposing it:

```powershell
$env:CF = Read-Host "paste token"
"length     : $($env:CF.Length)"                       # want exactly 40
"has bearer : $($env:CF -match 'Bearer')"              # want False
"charset ok : $($env:CF -match '^[A-Za-z0-9_-]+$')"    # want True
curl.exe -s -H "Authorization: Bearer $env:CF" https://api.cloudflare.com/client/v4/user/tokens/verify
```

Expect `"success":true` from the last line. `Read-Host` keeps the value out of
your shell history.

---

## 8. Add the remaining three settings to the repository

Two secrets and one variable. Go to:

```
https://github.com/<your-username>/<your-repository>/settings
```

### Two secrets

Click **Secrets and variables > Actions**. Make sure you are on the **Secrets**
tab. Click **New repository secret** twice, once for each:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The token you copied in section 7 |
| `CLOUDFLARE_ACCOUNT_ID` | The ID you copied in section 6 |

Both names must be exact. `CLOUDFLARE_TOKEN` will not be found.

**Do not add a `PAT_TOKEN` secret.** It is not needed and its presence is what
broke the pipeline for three days - see section 4.

### No variable is needed

On the old hosting platform there was a `CLOUDFLARE_PAGES_PROJECT` variable
holding the project name. **It no longer exists and should not be created.** The
Worker name lives in `wrangler.jsonc`, committed alongside the build it
describes, where a typo is reviewable in a pull request rather than hidden in a
settings page.

Two sources of truth for one name is worse than one source of truth and a code
review. If you find a `CLOUDFLARE_PAGES_PROJECT` variable, delete it.

### Do NOT create a `BASE_PATH` variable

On the previous hosting platform this project needed a `BASE_PATH` setting that
told it which folder the site lived in. **Cloudflare serves from the root of the
domain, so there is no folder and nothing to set.**

The automation checks for this and **stops with an error** if it finds one,
because a leftover value would make every style and script load from a path that
does not exist, and the site would appear completely unstyled. If you ever see
that error, you are looking at a `BASE_PATH` variable that should be deleted,
not created.

### Finally, allow the automation to run

Go to:

```
https://github.com/<your-username>/<your-repository>/settings/actions
```

Under **Actions permissions**, select **Allow all actions and reusable
workflows**, and save.

### A GitHub habit worth knowing about

GitHub switches scheduled jobs off on a public repository after **60 days with no
activity at all**. Because the automation saves a commit whenever anything
changed, your repository stays active and this will not bite you. But if the
repository ever goes completely idle for two months, the schedule quietly stops.
You can switch it back on from the Actions tab.

---

## 9. Nothing to configure: the site is already at the root

On the old platform there was one setting people got wrong, and its symptom was
a site that loaded with no colours and no formatting at all. That is gone.

Cloudflare serves your site from the root of your domain. There is no folder to
tell the build about, so there is nothing to configure. Every internal link and
every style file already points at the right place.

You do not need to do anything in this section. It is here so that you do not go
looking for a setting that does not exist, and do not create one.

---

## 10. Turn on the automatic publishing

There is no switch to flip. The automation is already written and is already
looking at your repository. Once the four settings from section 8 exist, the next
scheduled run will publish.

The schedule runs roughly every six hours, at about 17 minutes past the hour:
00:17, 06:17, 12:17 and 18:17 UTC. That is four times a day.

The 17 is deliberate rather than round. GitHub's own automated jobs all queue at
the top of the hour, so a job scheduled at :00 starts more slowly. Seventeen
past spreads the load. It has nothing to do with how often the site checks.

---

## 11. Run it once by hand: the actual test

Everything above makes the automation *possible*. This step is what proves it
*works*.

1. Go to:

   ```
   https://github.com/<your-username>/<your-repository>/actions
   ```

2. Click **refresh** in the list on the left.
3. Click **Run workflow**, choose `main`, confirm.
4. **Watch it run.** This is not optional. Nothing before this point tested the
   automation at all.

Expect about three to five minutes.

### What each outcome means

**Green, and it saved a commit** - the normal case. You are looking for a commit
on `main` whose message starts `data: refresh dataset (+N added`, followed by a
step called **deploy to cloudflare pages** with a link to the deployment. Open
that link, then open your site and refresh it. The **Last updated** time in the
footer should move.

**Green, but no new commit** - also normal. Nothing new was published by any
publication since last time, so there was nothing to save. The website is still
rebuilt and republished.

**Red at "require the cloudflare credentials"** - a setting from section 8 is
missing or misspelled. The message names which one. This is the automation
working: it tells you exactly what is wrong instead of failing obscurely later.

**Red at "refuse to build with a subpath"** - a `BASE_PATH` variable exists and
should be deleted. See section 8.

**Red at "fetch feeds (fail loud)"** - a publication feed failed its checks. The
log names each publication, its status, and the exact reason. Nothing was saved
and **nothing was published**, so the site you had stays up, which is the
intended behaviour. Fix the entry in `data/sources.yml`, save it in GitHub
Desktop, and run again.

**Red at "commit and push the dataset"** - the GitHub token is the problem, almost
certainly. See section 12.

**Red at "deploy to cloudflare pages"** - the Cloudflare token is the problem, or
the project name is wrong, or the site could not be built. See section 12.

### About the schedule

Timed jobs on GitHub are not precise. The first automatic run can be up to about
15 minutes later than its nominal time.

---

## 12. When something does not work

### The automation does not appear under the Actions tab at all

**Symptom:** you open the Actions tab and there is no `refresh` in the list.

**Why:** GitHub has not been told that this repository uses Actions. This is also
the symptom when the `.github` folder was never uploaded, because a missing file
means there is no automation to show.

**Fix:**
1. Check `refresh.yml` exists at
   `https://github.com/<your-username>/<your-repository>/blob/main/.github/workflows/refresh.yml`.
   If the page 404s, the folder was not uploaded: open GitHub Desktop and make
   sure `.github` is included in the next publish.
2. Go to `.../settings/actions` and set **Allow all actions and reusable
   workflows**.

### The run went red and the publish step was skipped

**Symptom:** a red job called `fetch and commit dataset`, and below it
`build and deploy to cloudflare pages` shown as **skipped** or greyed.

**Why, and this is deliberate:** the two steps are tied together on purpose. If the
fetch fails, the site is **not** republished, and Cloudflare keeps serving the
version that was published last. Publishing anyway would put a fresh timestamp on
content that is days out of date, which would be a lie with a success badge on
it. A greyed publish step next to a red fetch step is the system working
correctly, not a second problem.

**Fix:** the answer is in the red step's log. Scroll to **fetch feeds (fail
loud)** and read the report. Each failing publication is listed with the reason.
Correct that entry in `data/sources.yml`, publish it from GitHub Desktop, then
run the automation again by hand.

**What you must not do:** do not "fix" it by making the fetch step ignore
failures. There is no switch for this, and that is on purpose.

### An error about cloudflare credentials or the project name

**Symptom:** red step called **require the cloudflare credentials**.

**Why, in order of likelihood:**
1. One of the Cloudflare settings is missing. The message names which.
2. A name is misspelled. `CLOUDFLARE_TOKEN`, `CLOUDFLARE_PROJECT_NAME` and
   `ACCOUNT_ID` are all wrong and none of them will be found.
3. `wrangler.jsonc` is missing from the repository. The check says so by name.

**Fix:** open
`https://github.com/<your-username>/<your-repository>/settings/secrets/actions`
and compare the names character by character with the table in section 0. There
are three settings, all Cloudflare.

### The site gives a 404, or loads with no styling

**Symptom, two forms.** Either the address 404s entirely, or the page appears
with no colours and no formatting.

**Why, in order of likelihood:**
1. **Unstyled, everything else fine:** a `BASE_PATH` variable exists. Delete it.
   See section 8.
2. **404 on the `pages.dev` address:** the project name is not what you think it
   is, or the project was never created. Check **Workers & Pages** in the
   Cloudflare dashboard for the real name.
3. **404 on your own domain only:** DNS has not finished propagating, or the
   custom domain was never attached. DNS changes can take from a few minutes to
   24 hours.

### A permission or sign-in error when it tries to publish

**Symptom:** the red step is `deploy to cloudflare workers` and the log mentions
authentication, a 403, or "Not enough permissions to deploy".

**Decode the error code first.** These mean four different things, and guessing
between them is what cost the most time on this project:

| Code | Means | Fix |
| --- | --- | --- |
| `6111` | Header value **malformed** | 40 chars of `[A-Za-z0-9_-]`, no `Bearer `, no quotes |
| `1000` | Token **invalid / revoked / expired** | Create a new token, section 7 |
| `9109` | Token has an **IP filter** | Remove Client IP Address Filtering |
| `10000` | **Permissions** wrong | See the list below |

**Why, in order of likelihood:**
1. **The token has an IP address filter.** This produces `9109` and the tell is
   that the token works from your own machine but not from the runner. It is the
   single most misleading failure here, because it reads like a permissions bug.
   See section 7.
2. The token has **Workers Scripts > Edit**, not **Cloudflare Pages > Edit**.
   Cloudflare's dashboard offers both and they are not interchangeable: this site
   is published as a Worker, so Pages permissions do nothing for it. Earlier
   versions of this document told you to use Pages, which was the bug.
3. The token value is malformed (`6111`) - most often a pasted `Bearer ` prefix
   or surrounding quotes. Note that this is **not** caused by a trailing newline.
4. The token has expired or been revoked (`1000`). Cloudflare API tokens do not
   expire by default, but they can be revoked.
5. The token needs the extra **Account Settings > Read** permission. See
   section 7.
6. `CLOUDFLARE_ACCOUNT_ID` belongs to a different account than the token.
7. The token was created against a different account than the one owning the
   Worker.

**Fix:** open **API Tokens** in the Cloudflare dashboard. If the token is gone,
create a new one as in section 7 and replace the secret in section 8.

### A permission or sign-in error when it tries to save the commit

**Symptom:** the red step is `commit and push the dataset`, and the log says
something about authentication, a rejected push, or permission denied.

**This is no longer a token problem, and the fix is not in settings.** The push
uses the automatic `GITHUB_TOKEN`, which is granted by this line in the refresh
job:

```yaml
permissions:
  contents: write
```

**Why, in order of likelihood:**
1. That `permissions:` block was removed or lowered to `read`. The workflow's
   `confirm the push credential` step checks for exactly this and will have
   failed first with a message saying so.
2. Branch protection or a ruleset was added to `main` later and blocks the push.
   There are none today (`gh api repos/OWNER/REPO/rulesets` returns `[]`).
3. Someone re-added a `PAT_TOKEN` secret, which takes precedence over
   `GITHUB_TOKEN` in an expression like `secrets.PAT_TOKEN || github.token`.
   Delete it.

**Fix:** restore the `contents: write` grant in `.github/workflows/refresh.yml`.
There is no secret to repair.

**If you ever add branch protection to `main`:** rules that require review, or
that stop anyone pushing directly, will reject the automation's push. Either
allow the automation to bypass the rule, or accept that the automated commit
will fail until someone saves it by hand. No protection rules are set up today,
so this only matters if you add them later.

### Nothing happens for hours and no runs appear

**Why:** GitHub switches scheduled jobs off after 60 days of no repository
activity, and queued timed jobs can be delayed when GitHub is busy.

**Fix:** open the Actions tab and run it by hand (section 11). If the schedule
still does not appear, re-enable it there.

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

### In plain language: the site checks every six hours, and it always stays up

This section is here so that the rest of section 12 does not have to be read to
understand the one thing that happens most often.

**The site looks for new articles four times a day, not continuously.** It
checks roughly every six hours: at about 17 minutes past 00:00, 06:00, 12:00 and
18:00 **UTC** (UCT is the time used in computer and web addresses, and is an
hour behind British Summer Time). It is a fixed timetable, not a constant
stream, and that is deliberate - there is no version of this site that watches
the publications in real time.

**Sometimes a check is turned away, and the site carries on anyway.** If all
four publications are being asked for new articles too often by too many
different visitors at the same moment, they refuse the request. That is called
being rate limited, and it is the same thing that happens if you try to open a
bank's website fifty times in a minute. **When this happens the site keeps
showing the articles it already has.** Nothing is deleted, nothing is blanked,
the address still works, and the previous version stays online. The only
consequence is that new articles appear a little late.

**There is nothing to do about it.** Do not change anything in the project, do
not re-run anything, and do not worry about it. The next check on the timetable
will usually work perfectly. A red box in the Actions tab with the words
"fetch feeds" next to it is this situation, and it is the system behaving
correctly rather than a fault to repair.

**If you ever want it faster or slower, it is one line.** Open
`.github/workflows/refresh.yml` and look at the line that says `cron`. Change
the `6` in `'17 */6 * * *'` to any number you like, save, and push. Nothing
else in this project needs to change, and no file other than that one. Two
things to leave alone: keep the `17` (see section 10 for why), and be aware
that a number smaller than `6` may bring the refusals described above back.

---

## 13. Confirming it is genuinely updating

After the first automatic run:

- In GitHub Desktop, click **Fetch origin**. A new `data: refresh dataset`
  commit appears when anything changed.
- The Actions tab shows a run about every six hours. **A run is not proof of
  success.** Open it and read the steps. A run that saved nothing because
  nothing changed is still a healthy run.
- Visit your site and look at the **Feeds last checked** line in the footer. It
  should move forward on each successful run.

That footer line is the reader-facing proof, and it is the fastest way to tell a
working automation from one that has quietly stopped.

---

## 14. Known loose ends

### The site has never been viewed in a browser during the build

The site is built and its tests pass, but no one has yet opened it on a real
screen to check how it looks. The first time you visit it after deploying, look
at it properly: click through the pages, try the events calendar, and check it
on a phone. If anything looks wrong, that is worth reporting.

### Cloudflare now recommends a newer product for new static sites

Cloudflare's own current guidance suggests that brand-new static sites would
normally start on **Workers with Static Assets** rather than Pages. Pages is
fully supported and this site is a good fit for it - most importantly, Pages
lets you drag a folder in by hand, which is what section 5 relies on and which a
non-technical owner can repeat without a command line.

There is a documented migration path if this ever changes. Nothing about the
site itself would need to change: it is a folder of plain files either way.

### Third-party actions are referenced by version, not pinned

`refresh.yml` uses version tags such as `actions/checkout@v4` rather than pinned
commit hashes. That is the usual practice and it keeps the file readable, but it
does mean a future release from that project could change behaviour. The
publishing tool itself, by contrast, **is** pinned to an exact version, because a
scheduled deployment is the thing you least want silently changing behaviour.

### The dependency audit reports known problems

`npm audit` reports problems in the Astro dependency tree that predate this
project and have not been triaged. They do not stop the site from publishing.

**Do not run `npm audit fix --force`.** It upgrades across major versions and can
break the build.

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

**Before you start:** section 11 is the real test. Everything before it only
makes the automation possible. Nothing before it proves it works.
