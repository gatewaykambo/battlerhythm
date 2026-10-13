# War Party TOC

A daily news watch for service members, veterans, first responders, and their families.
AI agents find, score, and draft stories twice a day. An editor approves every item
before it reaches the public site.

## How it fits together

War Party TOC is an operations-center news board with two tiers.

- **The Wire** fills itself. Every sweep (about 4 AM and 2 PM Central), `pipeline/collect.py` reads the
  sources in `config/feeds.yml` (outlet feeds plus GDELT news searches), scores each new story with Claude,
  groups the same event from different outlets into one item, and posts every story that clears the Wire bar
  as a headline linking to the original. Military news is covered worldwide; the other lanes are U.S.-focused.
- **TOC Reports** are ours. The top stories each sweep get a full draft (summary, why it matters, take,
  X and Facebook posts), but only when the agents can read the full article. A story they can't read stays a
  Wire link. Drafts wait on the approval desk; a published Report is signed by its editor.
- **The Battle Rhythm** is the ranked daily rundown: today's TOC Reports first, then the strongest Wire headlines.
- **Countdowns:** the drafter suggests deadlines it finds in the reporting. Editors confirm them on the desk.
- **The globe** plots every story in its lane color, with TOC Reports pulsing gold, active operations
  (`site/data/hotzones.json`) glowing red, and an optional layer of major U.S. installations.
- **Held stories:** anything naming a War Party client or the Grunt Style Foundation, or involving suicide
  or graphic violence, never posts automatically. It waits on the desk for a yes or no.
- **Pulling:** editors can pull any story from the desk or straight from the public site (editor mode turns
  on automatically on a device where the desk is connected). Every pull keeps a reason, can be undone from the
  desk's Pulled tab, and the reasons are fed back to the scorer.

Every editor action writes a small file to `data/decisions/`. `pipeline/publish.py` (run by GitHub Actions
on every decision) folds them in and rebuilds `site/data/`. Cloudflare redeploys the `site` folder.

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
| Active-operations zones on the globe | `site/data/hotzones.json` |
| Installations layer | `site/data/installations.json` |
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
