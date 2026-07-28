-- CWL: post the formed roster to Discord, as a LIVING message rather than a paper trail.
--
-- A roster is not a one-off announcement. Transfers get confirmed, an account gets reallocated,
-- someone drops out — and a channel full of successive, mutually contradicting roster posts is worse
-- than no post at all, because nobody can tell which one is current. So the roster is sent once and
-- then EDITED in place (Discord's PATCH /webhooks/{id}/{token}/messages/{message_id}), which needs
-- the message id kept somewhere. That is all these columns are.
--
--   cwl_season_clans.roster_message_id  — the per-clan roster post (template A), one per clan.
--   cwl_seasons.digest_message_id       — the family-wide leadership digest (template C), one per season.
--   cwl_seasons.transfer_call_posted_at — the transfer call-to-action (template B) is NOT a living
--                                         message: it is a one-shot ping asking people to move, and
--                                         re-pinging on every edit would be the opposite of helpful.
--                                         The stamp only stops the automatic post (fired when the
--                                         season enters `transfers_pending`) from repeating; a leader
--                                         can still re-post it by hand.
--
-- Editing requires the SAME webhook that posted the message, so a stored id becomes invalid whenever
-- the destination changes — a clan's webhook being re-pointed, or the family-wide routing override
-- (migration 027) being flipped. No flag tracks that: an edit against the wrong webhook simply 404s,
-- and the sender falls back to posting fresh and storing the new id. That is self-healing without
-- having to model every way a destination can move.

ALTER TABLE cwl_season_clans
  ADD COLUMN IF NOT EXISTS roster_message_id TEXT;

ALTER TABLE cwl_seasons
  ADD COLUMN IF NOT EXISTS digest_message_id TEXT,
  ADD COLUMN IF NOT EXISTS transfer_call_posted_at TIMESTAMPTZ;
