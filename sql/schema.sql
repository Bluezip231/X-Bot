-- Run this once in the Supabase SQL editor to create the logging table.
-- Each row captures the full context of an action so a single record tells
-- the whole story: which tweet, what it said, why we picked it, what we replied.

create table if not exists bot_logs (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),

  action        text,          -- 'reply' | 'like' | 'skip' | 'error' | 'run_summary'
  status        text,          -- 'success' | 'failed'

  -- The original tweet we acted on
  tweet_id      text,
  tweet_text    text,          -- original tweet content
  tweet_url     text,          -- link to the original tweet
  author        text,          -- original author's @handle

  -- What the bot did / decided
  reply_text    text,          -- the reply we posted (null for like-only / skip)
  reason        text,          -- model's reasoning for choosing this tweet
  model         text,          -- OpenAI model used for the decision
  search_terms  text,          -- the search terms that surfaced this tweet

  -- Extras
  payload       jsonb,         -- run summaries / raw extras
  error         text           -- error message when status = 'failed'
);

create index if not exists bot_logs_tweet_id_idx on bot_logs (tweet_id);
create index if not exists bot_logs_created_at_idx on bot_logs (created_at desc);
create index if not exists bot_logs_action_idx on bot_logs (action);

-- Enable Row Level Security. The bot connects with the SERVICE ROLE key,
-- which bypasses RLS, so it keeps full read/write access. With RLS enabled
-- and NO policies defined, anon/authenticated (public) keys get no access
-- at all — the logs stay private. This is the secure default for a
-- server-only table. Do NOT add permissive policies unless you intend to
-- expose these logs to client-side keys.
alter table bot_logs enable row level security;
