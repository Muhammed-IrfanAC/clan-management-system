-- Inputs the attack model (src/lib/cwl/attackModel.ts) needs that sync was not keeping.
--
-- attacker_league_tier_id — the attacker's Ranked tier (raw API id, the same encoding as
-- player_accounts.league_tier_id) at the attack's FIRST sighting. Attack rows are written once
-- (ON CONFLICT DO NOTHING), so this is the tier of the week the attack was made in. Before this the
-- only league on record was today's, and the API's league history reaches back about five weeks, so
-- every older attack had lost its league for good. Older rows stay NULL; the model reads NULL as
-- "today's tier, imputed".
--
-- battle_modifier — the regular war's modifier as /currentwar reports it ('none', 'hardMode',
-- 'minusTwo', ...). A modifier changes how hard every base is, so the model leaves those wars out.
-- NULL = not recorded: wars ingested before this, and CWL, which has no modifier.
ALTER TABLE war_attacks ADD COLUMN IF NOT EXISTS attacker_league_tier_id integer;
ALTER TABLE cwl_war_attacks ADD COLUMN IF NOT EXISTS attacker_league_tier_id integer;
ALTER TABLE war_rounds ADD COLUMN IF NOT EXISTS battle_modifier text;
