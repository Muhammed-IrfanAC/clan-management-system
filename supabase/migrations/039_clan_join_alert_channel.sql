-- Per-clan destination for the unlinked-join alert.
--
-- The alert is already sent one message per clan, but every clan's message went to the one shared
-- unlinked-join channel. A clan may now name its own channel — or a THREAD (Discord posts into a
-- thread exactly as into a channel), e.g. one thread per clan under a single #new-joins channel. It
-- wins over the shared channel; blank keeps the existing chain (unlinked → leadership → clan).

ALTER TABLE clans ADD COLUMN IF NOT EXISTS discord_join_channel_id text;

COMMENT ON COLUMN clans.discord_join_channel_id IS
  'Channel or thread id for this clan''s unlinked-join alerts. Blank = the family-wide unlinked-join channel.';
