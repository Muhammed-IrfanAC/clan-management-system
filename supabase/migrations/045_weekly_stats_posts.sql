-- The weekly stats post (lib/warStats/weeklyPost.ts): one row per clan per Ranked League week, so
-- each clan gets exactly one report however many syncs run after the Monday reset.
--
-- The row is written as a claim BEFORE the message is sent ('claimed') and settled after ('sent', or
-- 'empty' when the clan had nothing to report); a failed send deletes the claim so a later sync
-- retries. A pass killed between the claim and the settle leaves the claim behind, which skips that
-- clan's report for the week — a missed post is better than a doubled one.
-- `league_season_id` is the week's start in Unix seconds, as the CoC API numbers league weeks.

CREATE TABLE IF NOT EXISTS weekly_stats_posts (
  clan_id UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  league_season_id BIGINT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'claimed' CHECK (outcome IN ('claimed', 'sent', 'empty')),
  channel_id TEXT,
  message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clan_id, league_season_id)
);

-- Migration 042: API roles get nothing, RLS on with no policies, only the app's role is granted.
ALTER TABLE weekly_stats_posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON weekly_stats_posts TO service_role;
