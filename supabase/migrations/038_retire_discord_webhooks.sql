-- Retire Discord webhooks: every channel now posts through the bot (037).
--
-- With channel ids set on every purpose channel and clan, the webhook beside each step went unused,
-- and the code no longer reads one: routing resolves bot channels only, and a step with no channel
-- id falls through to the next. The URLs are credentials (anyone holding one can post into that
-- channel), so they are deleted rather than left lying in the table. Revoke the webhooks themselves
-- in Discord (Edit Channel → Integrations → Webhooks) — removing the rows here does not.

ALTER TABLE clans DROP COLUMN IF EXISTS discord_webhook_url;

DELETE FROM settings WHERE key IN (
  'discord_override_webhook_url',
  'discord_announcement_webhook_url',
  'discord_leadership_webhook_url',
  'discord_unlinked_webhook_url'
);

COMMENT ON COLUMN clans.discord_channel_id IS
  'The bot''s channel for this clan. Blank = the family-wide fallback (DISCORD_DEFAULT_CHANNEL_ID).';

UPDATE settings SET description = 'Test-routing override channel id (bot).'
  WHERE key = 'discord_override_channel_id';
UPDATE settings SET description = 'Announcement channel id (bot). Blank = the clan channel.'
  WHERE key = 'discord_announcement_channel_id';
UPDATE settings SET description = 'Leadership channel id (bot). Blank = the clan channel.'
  WHERE key = 'discord_leadership_channel_id';
UPDATE settings SET description = 'Unlinked-join channel id (bot). Blank = the leadership channel, then the clan channel.'
  WHERE key = 'discord_unlinked_channel_id';
