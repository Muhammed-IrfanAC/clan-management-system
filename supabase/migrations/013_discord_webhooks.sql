-- Discord notification routing.
--
-- Per-clan webhook URLs so different clans can post to their own channels (e.g. clan-specific
-- warning channels). Notification code resolves the target clan for an event, uses that clan's
-- webhook if set, and otherwise falls back to the global DISCORD_WEBHOOK_URL env var.
ALTER TABLE clans ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;

-- Optional Discord user id per person, for @-mentioning a member in notifications. Populated later
-- via the dashboard; until then it is NULL and no mentions are emitted. One id per PERSON (not
-- account) so every linked alt shares the same mention target.
ALTER TABLE persons ADD COLUMN IF NOT EXISTS discord_user_id TEXT;
