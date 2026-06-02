-- News-posting bot schema. Run this in the Supabase SQL editor.
-- Three tables: ingested headlines, generated/published posts, and pipeline
-- run logs. The bot connects with the service-role key (bypasses RLS); RLS is
-- enabled with no policies so a leaked anon key can't read or write.

create table if not exists headlines (
  id            bigint generated always as identity primary key,
  title         text not null,
  description   text default '',
  source        text,
  url           text unique,                 -- upsert key (onConflict: 'url')
  published_at  timestamptz,
  ingested_at   timestamptz not null default now()
);
create index if not exists headlines_ingested_at_idx on headlines (ingested_at desc);

create table if not exists posts (
  id                bigint generated always as identity primary key,
  full_text         text not null,           -- the post as published (may include a source link)
  topic             text,
  kind              text default 'news',     -- 'news' | 'evergreen'
  style             text,                    -- educational | warning | opinion | short viral | casual
  source_title      text,
  source_url        text,
  passed_guardrails boolean default false,
  published         boolean default false,
  tweet_id          text,
  dry_run           boolean default false,   -- excluded from the daily-limit count
  -- Engagement, refreshed daily from the X API for the dashboard.
  like_count        int,
  reply_count       int,
  retweet_count     int,
  metrics_updated_at timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists posts_published_created_idx on posts (published, created_at desc);

-- Safe to re-run on an existing posts table created before engagement tracking.
alter table posts add column if not exists like_count int;
alter table posts add column if not exists reply_count int;
alter table posts add column if not exists retweet_count int;
alter table posts add column if not exists metrics_updated_at timestamptz;

create table if not exists pipeline_runs (
  id                     bigint generated always as identity primary key,
  run_type               text,               -- 'scheduled' | 'manual'
  headlines_ingested     int default 0,
  headlines_filtered     int default 0,
  post_generated         boolean default false,
  post_published         boolean default false,
  rejection_stage        text,               -- stage that stopped the run, or 'completed'
  rejection_reason       text,
  details                jsonb,              -- top headline, dedup verdict, quality scores, errors
  post_id                bigint,
  top_headline_title     text,
  top_headline_url       text,
  top_headline_relevance real,
  error                  text,
  started_at             timestamptz not null default now(),
  finished_at            timestamptz
);
create index if not exists pipeline_runs_finished_idx on pipeline_runs (finished_at);

alter table headlines enable row level security;
alter table posts enable row level security;
alter table pipeline_runs enable row level security;
-- No policies => only the service-role key (which bypasses RLS) has access.
