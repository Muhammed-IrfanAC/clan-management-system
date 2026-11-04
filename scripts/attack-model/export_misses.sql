-- Every missed attack in an ended war (regular + CWL) as one CSV, for the reliability part of the
-- attack model (model.py scores a planned war slot, and a slot can be missed). Run against a RESTORED
-- prod dump, never against prod itself:
--   psql -At -f scripts/attack-model/export_misses.sql > data/calibration/misses.csv
COPY (
  SELECT 'regular' AS kind, m.round_id, m.player_tag, m.th_level, r.end_time,
         greatest(coalesce(r.attacks_per_member, 2) - m.attacks_used, 0) AS missed
  FROM war_members m JOIN war_rounds r ON r.id = m.round_id
  WHERE r.state = 'warEnded' AND r.end_time IS NOT NULL AND m.attacks_used < coalesce(r.attacks_per_member, 2)
  UNION ALL
  SELECT 'cwl', m.round_id, m.player_tag, m.th_level, r.end_time, 1 - m.attacks_used
  FROM cwl_war_members m JOIN cwl_rounds r ON r.id = m.round_id
  WHERE r.state = 'warEnded' AND r.end_time IS NOT NULL AND m.attacks_used < 1
) TO STDOUT WITH CSV HEADER;
