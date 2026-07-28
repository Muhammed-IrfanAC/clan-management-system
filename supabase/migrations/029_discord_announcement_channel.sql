-- Discord: a family-wide ANNOUNCEMENT channel, separate from the per-clan notification channels.
--
-- Until now there was exactly one routing knob: clans.discord_webhook_url falling back to the global
-- DISCORD_WEBHOOK_URL env var, shared by every kind of message. But the messages are not the same
-- kind. A strike, a transfer call and a round-reveal notice are addressed to specific people and
-- belong in the channel those people already read — their clan's. A CWL roster is an announcement:
-- nobody has to act on it, it is edited in place for the whole season, and it reads as noise in a
-- channel people are watching for things aimed at them.
--
-- So this adds a second axis — the channel's PURPOSE — with one row:
--   discord_announcement_webhook_url — where announcements go (currently the CWL clan rosters)
--
-- BLANK INHERITS. Leaving it empty is not "announcements are off": resolution falls straight through
-- to the clan channel and then the env fallback, i.e. exactly today's behaviour. That is what makes
-- this safe to ship ahead of anyone configuring it, and mirrors the field-by-field inheritance the
-- per-clan CWL constraint overrides already use.
--
-- Like the routing override, the URL is a SECRET (holding it is enough to post as the bot) and is
-- therefore never shipped to the browser: settingsStore filters the key out of its settings fetch and
-- /api/settings/discord-route serves a masked form of it behind `leader.manage`. The routing override
-- still wins over this — while the testing redirect is on, EVERYTHING lands in the one test channel.

INSERT INTO settings (key, value, description) VALUES
  (
    'discord_announcement_webhook_url',
    '""',
    'Channel for announcement posts (CWL rosters). Blank = fall back to the clan channel. Never sent to the browser.'
  )
ON CONFLICT (key) DO NOTHING;
