-- Every attack (regular + CWL) as one CSV, labelled the way src/lib/warStats/attackClass.ts labels
-- them: fresh (first hit on the base), cleanup (hit before, not tripled), dead (already tripled).
-- Run against a RESTORED prod dump (see README.md), never against prod itself:
--   psql -At -f scripts/attack-model/export_attacks.sql > data/calibration/attacks.csv
-- Columns added by migration 048 are read through to_jsonb so older dumps (without them) still work.
COPY (
  WITH a AS (
    SELECT 'regular' AS kind, r.id AS round_id, c.display_name AS clan, c.clan_tag, r.end_time,
           to_jsonb(r) ->> 'battle_modifier' AS battle_modifier,
           x.attack_order, x.attacker_tag, x.attacker_th, x.defender_tag, x.defender_th, x.stars,
           x.first_seen_at, (to_jsonb(x) ->> 'attacker_league_tier_id')::int AS attacker_league_tier_id
    FROM war_attacks x JOIN war_rounds r ON r.id = x.round_id JOIN clans c ON c.id = r.clan_id
    UNION ALL
    SELECT 'cwl', r.id, c.display_name, c.clan_tag, r.end_time, NULL,
           x.attack_order, x.attacker_tag, x.attacker_th, x.defender_tag, x.defender_th, x.stars,
           x.first_seen_at, (to_jsonb(x) ->> 'attacker_league_tier_id')::int
    FROM cwl_war_attacks x JOIN cwl_rounds r ON r.id = x.round_id JOIN clans c ON c.id = r.clan_id
  )
  SELECT a.*, CASE WHEN prior IS NULL THEN 'fresh' WHEN prior >= 3 THEN 'dead' ELSE 'cleanup' END AS label
  FROM (
    SELECT a.*, max(stars) OVER (PARTITION BY round_id, defender_tag ORDER BY attack_order
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior
    FROM a
  ) a
  ORDER BY first_seen_at
) TO STDOUT WITH CSV HEADER;
