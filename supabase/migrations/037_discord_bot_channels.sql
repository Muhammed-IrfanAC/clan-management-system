-- Discord BOT routing: a channel id beside every webhook.
--
-- With DISCORD_BOT_TOKEN set, the bot posts to a channel by id; without it — or at any routing step
-- that has no channel id — the step's webhook is used exactly as before. Each step of the routing
-- chain (purpose channel → clan channel → global fallback) prefers its channel id over its webhook,
-- so the move from webhooks to the bot can happen one channel at a time, and unsetting the token
-- reverts the whole family to webhooks.
--
-- Unlike a webhook URL, a channel id is NOT a credential (posting needs the bot token too). They are
-- still served through /api/settings/discord-route rather than the general settings blob, so all
-- routing lives behind one gated endpoint.

ALTER TABLE clans ADD COLUMN IF NOT EXISTS discord_channel_id text;

COMMENT ON COLUMN clans.discord_channel_id IS
  'Bot routing: the clan channel id. Preferred over discord_webhook_url when DISCORD_BOT_TOKEN is set.';

INSERT INTO settings (key, value, description) VALUES
  ('discord_override_channel_id', '""',
   'Bot routing: test-routing override channel id. Preferred over the override webhook when the bot is configured.'),
  ('discord_announcement_channel_id', '""',
   'Bot routing: announcement channel id. Blank = use the announcement webhook, then the clan channel.'),
  ('discord_leadership_channel_id', '""',
   'Bot routing: leadership channel id. Blank = use the leadership webhook, then the clan channel.'),
  ('discord_unlinked_channel_id', '""',
   'Bot routing: unlinked-join channel id. Blank = use the unlinked webhook, then the leadership channel.')
ON CONFLICT (key) DO NOTHING;
