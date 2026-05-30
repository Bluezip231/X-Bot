# Interests Reply Bot (Twitter/X)

A simple Node.js bot that:

1. Searches recent tweets by configurable hashtags/keywords.
2. Sends the candidates to ChatGPT in a **single call** that filters for
   safe / interesting / non-harmful / non-NSFW tweets **and** writes a reply
   for each selected one.
3. Picks up to `REPLIES_PER_RUN` (default **1**), **likes** each tweet, then
   **replies**.
4. **Likes before replying**, dedups against past runs, and logs everything to
   **Supabase**.

Scheduling is built in via an internal **cron** (`node-cron`) — it runs as an
always-on Heroku **worker** dyno; no Heroku Scheduler add-on needed.

The bot's personality lives in [`prompts/personality.md`](prompts/personality.md)
— edit it to change tone, what it engages with, and the safety rules. No code
changes required.

---

## Prerequisites

- Node.js >= 18
- A Twitter/X developer app with **OAuth 1.0a user-context** credentials
  (app key/secret + access token/secret). Liking and replying require user
  context — a bearer token alone is not enough.
- **X API access:** v2 *recent search* requires at least the paid **Basic**
  tier. The free tier cannot search tweets.
- An OpenAI API key.
- A Supabase project (URL + service-role key).

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create the Supabase table — open the Supabase SQL editor and run
   [`sql/schema.sql`](sql/schema.sql).
3. Copy the env template and fill in your keys:
   ```bash
   cp .env.example .env
   ```
4. (Optional) Edit [`prompts/personality.md`](prompts/personality.md) to taste.

## Configuration

All behavior is controlled by env vars — see [`.env.example`](.env.example) for
the full list. Key ones:

| Variable          | Default      | Description                                   |
| ----------------- | ------------ | --------------------------------------------- |
| `SEARCH_TERMS`    | `#ai,#nodejs`| Comma-separated hashtags/keywords to search.  |
| `REPLIES_PER_RUN` | `1`          | Max tweets to reply to per run.               |
| `DRY_RUN`         | `false`      | `true` = search + filter + log only, no posting. |
| `MAX_CANDIDATES`  | `20`         | Tweets pulled from search per run.            |
| `OPENAI_MODEL`    | `gpt-4o-mini`| OpenAI model for filter + reply generation.   |
| `CRON_SCHEDULE`   | `0 * * * *`  | Internal cron schedule (5-field).             |
| `CRON_TIMEZONE`   | `UTC`        | IANA timezone for the schedule.               |
| `RUN_ON_STARTUP`  | `true`       | Run one pass immediately on boot.             |

## Running

Single pass (great for testing):
```bash
npm run once
```

Dry run — does everything (search, ChatGPT filtering, logging) **except** liking
and replying. Each candidate it would have posted is written to `bot_logs` with
`status = 'dry_run'`, including the generated reply and the reasoning, so you can
review picks before going live:
```bash
DRY_RUN=true npm run once
```
Dry-run rows never count toward dedup, so the same tweets remain eligible once
you go live.

Continuous (cron scheduler — this is what Heroku runs):
```bash
npm start
```

## Deploy to Heroku

```bash
heroku create your-bot-name
# Set every var from .env.example as a config var, e.g.:
heroku config:set TWITTER_APP_KEY=... TWITTER_APP_SECRET=... \
  TWITTER_ACCESS_TOKEN=... TWITTER_ACCESS_SECRET=... \
  OPENAI_API_KEY=... OPENAI_MODEL=gpt-4o-mini \
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  SEARCH_TERMS="#ai,#nodejs" REPLIES_PER_RUN=1 CRON_SCHEDULE="0 * * * *"

git push heroku main

# This app uses a worker dyno (see Procfile). Enable it:
heroku ps:scale worker=1
```

The worker stays up and fires `runOnce()` on the `CRON_SCHEDULE`. Watch it with
`heroku logs --tail`.

## Logs & dedup

Every action is written to the `bot_logs` table in Supabase: `like`, `reply`,
`skip`, `error`, and a per-run `run_summary`. Dedup checks this table so the bot
never replies to the same tweet twice — a successful `reply` row for a tweet id
means it won't be picked again.

## Notes

- The credentials (Twitter, OpenAI, Supabase) are read from env vars only —
  nothing is hard-coded. Provide them via `.env` locally or Heroku config vars.
- If the API rejects search (`403`), check your X API access tier.
