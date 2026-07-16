-- Per-clan scope for automated rule detection.
--
-- Rule detectors (missed attack, unjustified hit-up, low-rank late snipe) run family-wide. This lets
-- each clan opt its members' wars in or out of that automation independently of the rule toggles:
--   * always   — automate for both regular clan wars and CWL (the default; prior behaviour).
--   * cwl_only — automate only for CWL wars; regular-war violations are ignored for this clan.
--   * never    — never automate; the clan's wars are excluded from every detector.
-- Enforced in src/lib/rules/scan.ts by filtering each detector's violations against this mode.
ALTER TABLE clans
  ADD COLUMN IF NOT EXISTS rule_automation_mode TEXT NOT NULL DEFAULT 'always'
  CHECK (rule_automation_mode IN ('always', 'cwl_only', 'never'));
