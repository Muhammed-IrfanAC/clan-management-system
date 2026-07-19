-- Prune settings rows that no longer have any code reference. After the move to strikes and the
-- switch to on-dashboard-load sync, these four knobs are read nowhere: the General settings tab
-- renders the settings table generically, so they only showed up as dead controls.
DELETE FROM settings WHERE key IN (
  'sync_interval_minutes',
  'sync_auto_enabled',
  'warning_escalation_days',
  'cross_clan_warning_visibility'
);

-- Surface the one live knob that sync.ts already reads (defaulting to 30) but that was never seeded,
-- so it becomes an editable control in the General tab instead of an invisible constant.
INSERT INTO settings (key, value, description) VALUES
  ('inactive_cleanup_days', '30', 'Days an account can be gone from every family clan before sync auto-removes it')
ON CONFLICT (key) DO NOTHING;
