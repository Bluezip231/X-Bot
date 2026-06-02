// ─────────────────────────────────────────────────────────────
// RUNTIME CONFIG — non-secret bot behavior.
//
// This file IS committed to git and deploys with your code. Edit it on
// GitHub (or locally) to tune how the bot behaves; pushing redeploys Heroku.
// Secrets (API keys) never live here — they go in .env / Heroku config vars.
//
// An environment variable of the same name overrides any value here, so you
// can flip a setting on Heroku without a deploy. Leave the env var unset to
// use the value below.
// ─────────────────────────────────────────────────────────────

export const runtime = {
    // Topics the bot targets. The model classifies and filters headlines against
    // this list, so changing it changes what the bot posts about. (env: TOPICS,
    // comma-separated)
    topics: ['AI', 'cybersecurity', 'scams', 'online safety', 'tech'],

    // RSS/Atom feeds to pull headlines from. Add/remove freely. (Not overridable
    // via env — edit here.)
    newsFeeds: [
        { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews' },
        { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
        { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/' },
        { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
        { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
        { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
        { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
        { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
        { name: 'The Register', url: 'https://www.theregister.com/headlines.atom' },
        { name: 'VentureBeat', url: 'https://venturebeat.com/feed/' },
    ],

    // Max headlines pulled from each feed per run. (env: PER_FEED_LIMIT)
    perFeedLimit: 15,

    // Hard cap on tweets posted per day (UTC). Once reached, the bot stops
    // posting for the rest of the day. (env: MAX_TWEETS_PER_DAY)
    maxTweetsPerDay: 12,

    // How many tweets to post per scan — the top N distinct stories that pass
    // the filter. Bounded by maxTweetsPerDay (the daily ceiling). With the
    // hourly schedule, tweetsPerRun=1 + maxTweetsPerDay=4 means up to 4 posts a
    // day, at most one an hour. (env: TWEETS_PER_RUN)
    tweetsPerRun: 1,

    // Min relevance score (0-10) a headline needs to pass the editorial filter.
    // Higher = more selective. (env: EDITORIAL_THRESHOLD)
    editorialThreshold: 6,

    // How many recent posts the LLM dedup step compares a candidate against.
    // (env: POST_DEDUP_LOOKBACK_COUNT)
    postDedupLookbackCount: 5,

    // Append the source article link to each post. (env: INCLUDE_SOURCE_LINK)
    includeSourceLink: true,

    // Post styles the model may write in — it picks the one that best fits each
    // post. (env: POST_STYLES, comma-separated)
    postStyles: ['educational', 'warning', 'opinion', 'short viral', 'casual'],

    // Calls-to-action / engagement twists the model may weave in when it helps.
    // (env: CALL_TO_ACTIONS, comma-separated)
    callToActions: ['share this', 'watch for this', 'save this', 'what do you think?'],

    // Share of runs that post EVERGREEN content (tips / warnings / explainers /
    // safety) instead of news, 0-1. A run also falls back to evergreen when no
    // fresh news passes the filter. (env: EVERGREEN_RATIO)
    evergreenRatio: 0.3,

    // Prune headlines and pipeline_runs older than this many days. (env: CLEANUP_DAYS)
    cleanupDays: 7,

    // Engagement refresh updates likes/replies/retweets for posts published in
    // the last this-many days (older posts rarely change). (env: METRICS_LOOKBACK_DAYS)
    metricsLookbackDays: 14,

    // How many weeks of history the dashboard shows. (env: DASHBOARD_WEEKS)
    dashboardWeeks: 8,

    // OpenAI model used for classify / filter / generate / quality steps.
    // (env: OPENAI_MODEL)
    openaiModel: 'gpt-4o-mini',

    // DRY RUN: when true, run the full pipeline and log what it WOULD post, but
    // do NOT post to X. Flip to false to go live. (env: DRY_RUN)
    dryRun: false,

    // Internal scheduler — standard 5-field cron. Default: check for fresh news
    // every hour (it only posts when something is actually worth sharing, up to
    // maxTweetsPerDay). (env: CRON_SCHEDULE)
    //   "0 * * * *" -> every hour   |   "0 */3 * * *" -> every 3 hours
    cronSchedule: '0 * * * *',

    // Timezone for the cron schedule (IANA name, e.g. America/New_York, UTC).
    // (env: CRON_TIMEZONE)
    cronTimezone: 'UTC',

    // Run a single pass immediately on startup. Keep this FALSE in production:
    // Heroku restarts the dyno on every deploy, config-var change, and its daily
    // cycle, and each restart would otherwise fire an immediate post. With it
    // false the bot only posts on the cron schedule. (env: RUN_ON_STARTUP)
    runOnStartup: false,
};
