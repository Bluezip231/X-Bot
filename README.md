# News Bot (Twitter/X)

An always-on Node.js bot that posts original news tweets on configurable topics
(default: **AI, cybersecurity, scams, online safety, tech**). Each run:

1. **Ingests** headlines from RSS feeds (+ optional TheNewsAPI) and dedups them.
2. **Classifies** each headline into your configured topic buckets (ChatGPT).
3. **Editorial filter** — scores on-topic relevance and keeps only the best (ChatGPT).
4. **Dedup check** — compares the top candidate against recent posts so it never
   covers the same event twice (ChatGPT, fails open).
5. **Generates** a single post (ChatGPT) in a fitting **style** (educational,
   warning, opinion, short-viral, or casual) with an optional call-to-action
   ("watch for this", "save this", "what do you think?"), optionally appending
   the source link.
6. **Quality check** — programmatic guardrails (length, hashtags) + an LLM check
   for faithfulness/tone/safety.
7. **Posts** an original tweet to X and logs everything to **Supabase**.

A share of runs (`evergreenRatio`) post **evergreen** content instead — a
standalone cybersecurity tip, scam warning, AI explainer, or online-safety
reminder on one of your topics (no headline needed). Evergreen is also used as a
fallback when no fresh news passes the filter, so a run is never wasted.

It also serves a **password-protected engagement dashboard** on the app's public
URL: every published post's likes/replies/retweets are refreshed daily from the X
API, and the dashboard ranks **topics** (and styles, and news-vs-evergreen) by
engagement, per week — so you can see what's performing best.

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
| `newsFeeds`              | 10 tech/sec feeds  | RSS/Atom sources to pull headlines from.           |
| `maxTweetsPerDay`        | `4`                | Hard cap on tweets per day (UTC); then it stops.    |
| `tweetsPerRun`           | `1`                | Tweets to post per scan (≤ daily cap).             |
| `editorialThreshold`     | `6`                | Min relevance (0-10) to pass the filter.           |
| `postDedupLookbackCount` | `5`                | Recent posts the dedup step compares against.      |
| `includeSourceLink`      | `true`             | Append the source article link to each post.       |
| `evergreenRatio`         | `0.3`              | Share of runs (0-1) that post evergreen vs news.   |
| `postStyles`             | 5 styles           | Styles the model may write in (it picks best fit).  |
| `callToActions`          | 4 CTAs             | Engagement phrases the model may weave in.          |
| `dryRun`                 | `true`             | `true` = run everything but don't post to X.       |
| `cronSchedule`           | `0 * * * *`        | How often to check for news (5-field cron).        |
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

## Dashboard

The app serves a password-protected engagement dashboard at `/dashboard` on the
public URL. It shows, per week, which **topics** (and styles, and news vs
evergreen) earned the most engagement (likes + replies + retweets). Engagement
is pulled from the X API once a day; brand-new posts read 0 until the next
refresh. Access requires `DASHBOARD_USER` + `DASHBOARD_PASS` (if unset, the page
returns 503 — never accidentally public). `/healthz` is open for uptime checks.

## Deploy to Heroku

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
# If you previously ran a worker dyno, turn it off so the bot doesn't post twice:
heroku ps:scale worker=0
```

The web dyno stays up, posts on `CRON_SCHEDULE`, refreshes engagement daily, and
serves the dashboard. Watch it with `heroku logs --tail`. To tune
topics/feeds/schedule, edit `runtime.config.js` and push (or override via config
vars).

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
- Free X API tier caps writes (~17/day); the default `maxTweetsPerDay: 4` is well
  under that.
- Post length uses X's weighting (a link counts as 23 chars); the generator
  budgets the body to ~256 chars when a link is appended.
