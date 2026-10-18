-- An UNLINKED-JOIN channel: where sync posts when a player nobody has linked to a person joins a
-- family clan, pinging the Leadership role to go and link them (or deal with them).
--
-- Same shape and rules as the announcement (029) and leadership (035) channels: a SECRET never sent
-- to the browser (settingsStore filters the key, /api/settings/discord-route serves it masked), and
-- BLANK INHERITS — unset, the alert falls through to the leadership channel, then the clan channel.

INSERT INTO settings (key, value, description) VALUES
  (
    'discord_unlinked_webhook_url',
    '""',
    'Channel for unlinked-player join alerts (pings the Leadership role). Blank = fall back to the leadership channel, then the clan channel. Never sent to the browser.'
  )
ON CONFLICT (key) DO NOTHING;
