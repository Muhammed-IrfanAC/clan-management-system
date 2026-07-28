-- Discord: a family-wide ROUTING OVERRIDE, plus the round-reveal lineup notice.
--
--  1. NOTIFICATION ROUTING OVERRIDE. Notifications normally fan out to a per-clan channel
--     (clans.discord_webhook_url) falling back to the global DISCORD_WEBHOOK_URL env var. During a
--     testing phase that fan-out is exactly what you don't want: every strike, warning and lineup
--     notice should land in ONE private channel where leadership can watch the system work before
--     it starts talking to the whole family.
--
--     Two settings rows drive it, deliberately split so the URL can stay configured while the
--     redirect itself is flipped off:
--       discord_override_enabled     — the switch
--       discord_override_webhook_url — where everything goes while the switch is on
--
--     Stored in `settings` (not env) so it is flippable from the dashboard mid-season with no
--     redeploy. The URL is a SECRET — anyone holding it can post into the channel as the bot — so
--     unlike every other settings row it is never shipped to the browser: the Settings screen reads
--     and writes it through /api/settings/discord-route, which masks it on read and requires
--     `leader.manage`. See the .neq() filter in loadAll() in src/lib/stores/settingsStore.ts.
--
--  2. LINEUP NOTICE IDEMPOTENCY. cwl_rounds gains `lineup_notified_at`. When a CWL round is first
--     revealed (state = 'preparation') the sync compares the in-game lineup against the season's
--     formed roster and posts the swap list to Discord. Sync runs on every authenticated dashboard
--     load, so without a stamp that message would repost on every poll for the whole prep window.

INSERT INTO settings (key, value, description) VALUES
  (
    'discord_override_enabled',
    'false',
    'Send EVERY Discord notification to the override channel instead of the per-clan channels'
  ),
  (
    'discord_override_webhook_url',
    '""',
    'Webhook that receives all notifications while the override is on (never sent to the browser)'
  )
ON CONFLICT (key) DO NOTHING;

-- Null until the round's lineup notice has been posted. Only ever set once, on a successful send,
-- so a Discord outage retries on the next sync rather than silently swallowing the round.
ALTER TABLE cwl_rounds ADD COLUMN IF NOT EXISTS lineup_notified_at TIMESTAMPTZ;
