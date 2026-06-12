# News Bot (Twitter/X)

An always-on Node.js bot that posts original news tweets on configurable topics
(default: **AI, cybersecurity, scams, online safety, tech, web design**). Each run:

1. **Ingests** headlines from RSS feeds (+ optional TheNewsAPI), drops stale
   items (older than `maxHeadlineAgeHours`), and dedups them.
2. **Classifies** each headline into your configured topic buckets (ChatGPT).
3. **Editorial filter** — scores on-topic relevance and keeps only the best (ChatGPT).
4. **Dedup check** — compares the top candidate against recent posts so it never
   covers the same event twice (ChatGPT, fails open).
5. **Generates** a single post (ChatGPT) in a fitting **style** (educational,
   warning, opinion, short-viral, or casual) with an optional call-to-action
   ("watch for this", "save this", "what do you think?"), optionally appending
   the source link.
6. **Quality check** — programmatic guardrails (length, hashtags) + an LLM check
   for faithfulness/tone/safety. If the LLM reviewer rejects a draft, the writer
   gets one revision pass with the reviewer's feedback before the story is
   dropped.
7. **Posts** an original tweet to X and logs everything to **Supabase**.

**Evergreen** content (a standalone cybersecurity tip, scam warning, AI
explainer, or online-safety reminder, no headline needed) is used as a
**fallback only** — when no fresh news passes the filter, so a slow day isn't
completely silent. By default the bot prefers real news (`evergreenRatio: 0`)
and caps fallback tips at `maxEvergreenPerDay` so the feed stays mostly news.

It also serves a **password-protected engagement dashboard** on the app's public
URL: every published post's likes/replies/retweets are refreshed daily from the X
API, and the dashboard ranks **topics** (and styles, and news-vs-evergreen) by
engagement, per week — so you can see what's performing best. That same
engagement signal is fed back into generation: the writer is nudged toward the
**styles** that have historically earned the most engagement (a soft tie-breaker
— fit always wins). See `styleFeedback*` in the config.

Scheduling and the dashboard run together in one process on a single Heroku
**web** dyno (Basic tier, which never sleeps). `node-cron` handles posting, the
daily engagement refresh, and cleanup; no Heroku Scheduler add-on needed.

---

## Configuration

Two layers, by design:

- **Secrets** live in the environment only (`.env` locally, Heroku config vars in
  prod) — see [`.env.example`](.env.example). Never committed.
- **Behavior** lives in [`runtime.config.js`](runtime.config.js) — committed, so
  you edit it on GitHub and a push redeploys. Any value can be overridden by an
  env var of the same name (env always wins).

Key `runtime.config.js` settings:

| Setting                  | Default            | Description                                        |
| ------------------------ | ------------------ | -------------------------------------------------- |
| `topics`                 | AI, cybersecurity… | Topics the bot targets (drives classify + filter). |
| `newsFeeds`              | 11 tech/sec feeds  | RSS/Atom sources to pull headlines from.           |
| `maxHeadlineAgeHours`    | `48`               | Skip headlines older than this at ingest, so resurfaced old items can't post as fresh news (`0` disables). |
| `maxTweetsPerDay`        | `3`                | Hard cap on tweets per day; then it stops. Day boundary is local midnight in `cronTimezone`. |
| `tweetsPerRun`           | `1`                | Tweets to post per scan (≤ daily cap).             |
| `minPostSpacingMinutes`  | `360`              | Min minutes between posts, so the day's tweets spread out instead of clustering (`0` disables). |
| `editorialThreshold`     | `8`                | Min relevance (0-10) to pass the filter (strict).  |
| `postDedupLookbackCount` | `5`                | Recent posts the dedup step compares against.      |
| `includeSourceLink`      | `true`             | Append the source article link to each post.       |
| `evergreenRatio`         | `0`                | Share of runs (0-1) that post evergreen vs news (0 = fallback only). |
| `maxEvergreenPerDay`     | `1`                | Cap on evergreen fallback tips per day (UTC).      |
| `postStyles`             | 5 styles           | Styles the model may write in (it picks best fit).  |
| `callToActions`          | 4 CTAs             | Engagement phrases the model may rarely weave in.   |
| `styleFeedbackEnabled`   | `true`             | Bias posts toward the styles earning the most engagement (soft; needs data). |
| `styleFeedbackDays`      | `21`               | History window the style ranking is computed over.  |
| `styleFeedbackMinPosts`  | `3`                | Min posts a style needs before it's ranked.         |
| `dryRun`                 | `false`            | `true` = run everything but don't post to X.       |
| `cronSchedule`           | `0 */3 * * *`      | How often to check for news (5-field cron).        |
| `cronTimezone`           | `UTC`              | IANA timezone for the schedule.                    |
| `runOnStartup`           | `false`            | Post once on boot too (every restart). Keep false.  |

Env-only secrets: `TWITTER_APP_KEY/_SECRET`, `TWITTER_ACCESS_TOKEN/_SECRET`,
`OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optional
`THENEWSAPI_KEY`.

The post voice/persona lives in
[`src/prompts/system-persona.txt`](src/prompts/system-persona.txt) — edit it to
change tone. The pipeline prompts live alongside it in `src/prompts/`.

## Prerequisites

- Node.js >= 18
- A Twitter/X developer app with **OAuth 1.0a user-context** credentials and
  **Read+Write** permission (posting needs user context, not just a bearer token).
- An OpenAI API key.
- A Supabase project (URL + service-role key).

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create the tables — open the Supabase SQL editor and run
   [`sql/schema.sql`](sql/schema.sql).
3. Copy the env template and fill in your keys:
   ```bash
   cp .env.example .env
   ```
4. (Optional) Edit `runtime.config.js` (topics, feeds, schedule) and
   `src/prompts/system-persona.txt` (voice).

## Running

Single pass (great for testing):
```bash
npm run once
```

Dry run — does everything (ingest, filter, generate, log) **except** posting to
X. The would-be post is written to the `posts` table with `dry_run = true`
(which never counts toward the daily limit), so you can review before going
live. `dryRun` defaults to `true`; flip it to `false` in `runtime.config.js`
when ready.

Continuous (web server + scheduler — what Heroku runs):
```bash
npm start
```
This also serves the dashboard locally at `http://localhost:3000/dashboard`
(set `DASHBOARD_USER`/`DASHBOARD_PASS` in `.env` to view it).

## Tests

Unit tests cover the pure logic (length/guardrail checks, tweet truncation,
timezone day-boundary math, and the engagement style ranking). They use Node's
built-in test runner — no dependencies or API keys needed:

```bash
npm test
```

## Dashboard

The app serves a password-protected engagement dashboard at `/dashboard` on the
public URL. It shows, per week, which **topics** (and styles, and news vs
evergreen) earned the most engagement (likes + replies + retweets). Engagement
is pulled from the X API once a day; brand-new posts read 0 until the next
refresh. Access requires `DASHBOARD_USER` + `DASHBOARD_PASS` (if unset, the page
returns 503 — never accidentally public). `/healthz` is open for uptime checks.

## Run on GitHub Actions (recommended, free)

Instead of an always-on host, the bot can run as periodic one-shot invocations
on GitHub's scheduler. Each invocation does one task and exits; all state (daily
cap, post spacing, dedup) lives in Supabase, so isolated runs behave exactly
like the old internal scheduler. Three workflows live in
[`.github/workflows/`](.github/workflows):

| Workflow          | Schedule (UTC) | Command                     |
| ----------------- | -------------- | --------------------------- |
| `post.yml`        | every 3 hours  | `node src/index.js --post`    |
| `engagement.yml`  | daily 02:00    | `node src/index.js --refresh` |
| `cleanup.yml`     | daily 03:00    | `node src/index.js --cleanup` |

Setup:

1. Add your secrets in the repo under **Settings → Secrets and variables →
   Actions → New repository secret** (each as its own secret):
   `TWITTER_APP_KEY`, `TWITTER_APP_SECRET`, `TWITTER_ACCESS_TOKEN`,
   `TWITTER_ACCESS_SECRET`, `OPENAI_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (and optional `THENEWSAPI_KEY`).
2. (Optional) Add a repo **variable** `DRY_RUN=true` to test posting without
   actually tweeting; remove it to go live.
3. Scheduled workflows only fire once these files are on the **default branch**
   (`main`). You can trigger any of them manually from the **Actions** tab
   ("Run workflow") to test.

Notes:
- GitHub cron is UTC and best-effort (runs can be delayed a few minutes under
  load) — fine for a few posts a day.
- These run-once modes are also handy locally: `npm run post`, `npm run refresh`,
  `npm run cleanup`.
- The hosted dashboard is **not** available in this mode (it needs an always-on
  server) — engagement data still accumulates in Supabase. See below.

## Deploy to Heroku (alternative — always-on, keeps the dashboard)

The bot also still runs as a single always-on **web** dyno that serves the
dashboard and runs the internal cron. Use this instead of GitHub Actions if you
want the hosted dashboard.

```bash
heroku create your-bot-name
# Set the secrets as config vars (incl. dashboard login + optional news key):
heroku config:set TWITTER_APP_KEY=... TWITTER_APP_SECRET=... \
  TWITTER_ACCESS_TOKEN=... TWITTER_ACCESS_SECRET=... \
  OPENAI_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  DASHBOARD_USER=... DASHBOARD_PASS=... THENEWSAPI_KEY=...

git push heroku main

# This app uses a single WEB dyno (see Procfile) — it serves the dashboard AND
# runs the scheduler. Use the Basic tier so it never sleeps:
heroku ps:type web=basic
heroku ps:scale web=1
```

> **Don't run both at once.** If the Heroku dyno is up *and* the GitHub Actions
> workflows are enabled, both will try to post. Pick one — if you move to GitHub
> Actions, scale the dyno down with `heroku ps:scale web=0` (or toggle it off in
> the dashboard).

## Logs & data (Supabase)

- `headlines` — every ingested headline (used for URL/title dedup).
- `posts` — generated posts, with `topic`, `kind`, `style`, `published`,
  `tweet_id`, `dry_run`, and engagement (`like_count`, `reply_count`,
  `retweet_count`, `metrics_updated_at`) that powers the dashboard.
- `pipeline_runs` — one row per run: what was ingested/filtered, the top
  headline, the dedup verdict, quality scores, why it stopped, and any error.

## Troubleshooting

- **Local TLS error** (`unable to verify the first certificate`, or Supabase
  `fetch failed`): your machine intercepts HTTPS (corporate proxy / antivirus),
  so Node can't verify certs. On Node 22.15+/24, run with the OS trust store:
  ```bash
  NODE_OPTIONS=--use-system-ca npm run once
  ```
  This does **not** happen on Heroku, so the deploy is unaffected. (Don't add
  the flag to `package.json` scripts — it errors on Node < 22.15.)

## Notes

- Credentials are read from env vars only — nothing is hard-coded.
- Free X API tier caps writes (~17/day); the default `maxTweetsPerDay: 3` is well
  under that.
- Post length uses X's weighting (a link counts as 23 chars); the generator
  budgets the body to ~256 chars when a link is appended.
