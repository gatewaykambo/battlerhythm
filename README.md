# Battle Rhythm

A daily news watch for service members, veterans, first responders, and their families.
AI agents find, score, and draft stories twice a day. An editor approves every item
before it reaches the public site.

## How it fits together

1. **Sweep** (GitHub Actions, about 4 AM and 2 PM Central). `pipeline/collect.py` reads
   the feeds in `config/feeds.yml`, drops duplicates and old stories, scores each new
   story with Claude, and drafts a summary, take, X post, and Facebook post for the best ones.
   Everything lands in `data/queue.json`.
2. **Approve** (`/admin.html`). Will and Anthony open the approval desk, edit the drafts,
   and approve or kill each one. Each decision is saved as a small file in `data/decisions/`.
3. **Publish** (GitHub Actions, runs on every decision). `pipeline/publish.py` folds the
   decisions in and rebuilds `site/data/published.json`. Cloudflare Pages redeploys the site,
   and the story is live about two minutes after approval.
4. **Distribute.** The desk gives you copy-ready X and Facebook posts and a daily Sitrep.
   Paste them into the accounts by hand.

## One-time setup

### 1. GitHub repository
- Create a **private** repository named `battlerhythm` and put these files in it.
- Settings → Actions → General → Workflow permissions: choose **Read and write permissions**.
- Settings → Collaborators: add Anthony's GitHub account.

### 2. Claude API key
- At console.anthropic.com, create an API key and add a small amount of credit.
  Set a monthly spending limit there; at pilot volume the cost should be a few dollars a month.
- In the repository: Settings → Secrets and variables → Actions → New repository secret.
  Name it `ANTHROPIC_API_KEY` and paste the key.

### 3. Free hosting on Cloudflare Pages
- Create a free Cloudflare account. Go to Workers & Pages → Create → Pages → Connect to Git.
- Pick the `battlerhythm` repository. Framework preset: **None**. Build command: leave empty.
  Build output directory: `site`.
- Name the project `battle-rhythm`. The site will be at `https://battle-rhythm.pages.dev`.

### 4. Point the site at the repository
Edit `site/assets/config.js`:
```js
repo: "gatewaykambo/battlerhythm",
siteUrl: "https://battle-rhythm.pages.dev",
```

### 5. Each editor's access token (Will and Anthony each make their own)
- GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate.
- Repository access: **Only select repositories** → `battlerhythm`.
- Permissions: **Contents: Read and write**. Add **Actions: Read and write** to use the
  "Run a sweep now" button.
- Open `https://battle-rhythm.pages.dev/admin.html`, choose your name, paste the token, and
  press Save and test. The token stays in that browser only.

### 6. First sweep
- Repository → Actions → **Sweep** → Run workflow. It takes about five minutes.
- Open the run's summary to see how many stories it found and whether any feeds failed.
- Then open the approval desk.

## Daily use
- **Queue:** stories ranked by score. Sitrep candidates (85+) come first. Edit the headline,
  summary, take, and posts, tick the review box, and press Approve and publish. Kill anything that misses.
- **Published:** copy the X post, Facebook post, or link for any live story, or unpublish it.
- **Sitrep:** today's approved stories, ranked, as one block of text to paste into Facebook.
- **Sweeps:** the last run's numbers, failing feeds, and a button to run a sweep now.

## Tuning without code
| To change | Edit |
| --- | --- |
| Sources | `config/feeds.yml` |
| Voice, positions, and drafting rules | `config/editorial.md` |
| Client and Foundation names that trigger disclosures | `config/watchlist.yml` |
| Thresholds, models, run limits | `config/settings.yml` |
| Sweep times | `.github/workflows/collect.yml` (times are UTC) |

## Guardrails built in
- Nothing publishes without an editor's approval, and the take is signed by that editor.
- Summaries are written in our own words and always link to the original reporting.
- Stories naming a War Party client or partner are flagged and carry a disclosure.
- Stories about the Grunt Style Foundation are flagged with a recommendation to kill,
  since both pilot editors sit on its board.
- Suicide-related stories get the Veterans Crisis Line (dial 988, then press 1).
- `[DRY RUN]` placeholder text cannot be approved.

## Testing offline
```
pip install -r pipeline/requirements.txt
python pipeline/collect.py --dry-run --fixtures tests/fixtures
python pipeline/publish.py
python -m http.server -d site 8000
```
Dry runs use keyword scores and placeholder drafts and make no API calls.
Reset the data afterward: `data/queue.json` → `[]`, `site/data/published.json` → `[]`,
`data/seen.json` → `{"ids": {}, "titles": {}}`.
