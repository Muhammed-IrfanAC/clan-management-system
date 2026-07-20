import { supabase } from '@/lib/supabase';
import type { WarContext, WarAttackRec, LineupBase } from '../warContext';

/**
 * Assemble WarContexts (opponent lineup + our per-attack detail) for every ENDED war — regular and
 * CWL — that ended within the lookback window. This is the DB half of the judgement detectors; the
 * pure half lives in ../warContext.ts. Only ended rounds are considered (a live war has no final
 * picture to judge), matching the missed-attack detector.
 */

type LineupRow = { tag: string; th: number; pos?: number };

type AttackRow = {
  attack_order: number;
  attacker_tag: string;
  attacker_name: string | null;
  attacker_person_id: string | null;
  attacker_th: number | null;
  attacker_rank: string | null;
  defender_tag: string;
  defender_th: number | null;
  stars: number;
  first_seen_at: string | null;
  first_seen_state: string | null;
};

type RoundRow = {
  id: string;
  clan_id: string | null;
  opponent_name: string | null;
  end_time: string | null;
  opponent_lineup: LineupRow[] | null;
  attacks: AttackRow[] | null;
};

function toLineup(rows: LineupRow[] | null): LineupBase[] {
  return (rows || []).map((r) => ({ tag: r.tag, th: r.th }));
}

function toAttacks(rows: AttackRow[] | null): WarAttackRec[] {
  return (rows || []).map((a) => ({
    order: a.attack_order,
    attackerTag: a.attacker_tag,
    attackerName: a.attacker_name,
    attackerPersonId: a.attacker_person_id,
    attackerTh: a.attacker_th ?? 0,
    attackerRank: a.attacker_rank,
    defenderTag: a.defender_tag,
    defenderTh: a.defender_th ?? 0,
    stars: a.stars,
    firstSeenAt: a.first_seen_at,
    firstSeenState: a.first_seen_state,
  }));
}

export async function loadWarContexts(since: string): Promise<WarContext[]> {
  const [regular, cwl] = await Promise.all([
    supabase
      .from('war_rounds')
      .select('id, clan_id, opponent_name, end_time, opponent_lineup, attacks:war_attacks(attack_order, attacker_tag, attacker_name, attacker_person_id, attacker_th, attacker_rank, defender_tag, defender_th, stars, first_seen_at, first_seen_state)')
      .eq('state', 'warEnded')
      .gte('end_time', since),
    supabase
      .from('cwl_rounds')
      .select('id, clan_id, opponent_name, end_time, opponent_lineup, attacks:cwl_war_attacks(attack_order, attacker_tag, attacker_name, attacker_person_id, attacker_th, attacker_rank, defender_tag, defender_th, stars, first_seen_at, first_seen_state)')
      .eq('state', 'warEnded')
      .gte('end_time', since),
  ]);

  if (regular.error) console.error('loadWarContexts (regular) failed:', regular.error);
  if (cwl.error) console.error('loadWarContexts (cwl) failed:', cwl.error);

  const contexts: WarContext[] = [];
  for (const r of (regular.data as unknown as RoundRow[]) || []) {
    contexts.push({
      source: 'regular',
      roundId: r.id,
      clanId: r.clan_id,
      opponentName: r.opponent_name,
      endTime: r.end_time,
      lineup: toLineup(r.opponent_lineup),
      attacks: toAttacks(r.attacks),
    });
  }
  for (const r of (cwl.data as unknown as RoundRow[]) || []) {
    contexts.push({
      source: 'cwl',
      roundId: r.id,
      clanId: r.clan_id,
      opponentName: r.opponent_name,
      endTime: r.end_time,
      lineup: toLineup(r.opponent_lineup),
      attacks: toAttacks(r.attacks),
    });
  }
  return contexts;
}

/**
 * The set of person IDs exempt from the war-conduct rules: everyone the org has designated leadership
 * via `persons.access_role` (co_leader / leader / super_admin). Deliberately NOT the in-game `db_role`,
 * which flips around as ranks are shuffled in-game — access_role is the stable, intentional "this
 * person is leadership" signal. It already lives on the person, so a leader's every linked alt is
 * exempt automatically, regardless of that alt's own in-game rank.
 */
export async function loadExemptPersonIds(personIds: (string | null)[]): Promise<Set<string>> {
  const ids = [...new Set(personIds.filter((x): x is string => !!x))];
  const out = new Set<string>();
  if (!ids.length) return out;

  const { data, error } = await supabase
    .from('persons')
    .select('id')
    .in('id', ids)
    .not('access_role', 'is', null);
  if (error) {
    console.error('loadExemptPersonIds failed:', error);
    return out;
  }
  for (const row of (data as { id: string }[]) || []) out.add(row.id);
  return out;
}

// INTERNAL scan window — NOT a user-facing rule setting. It only bounds the DB query so the 5-minute
// cron doesn't re-sweep all history; correctness comes from dedup_key, not from this. 48h comfortably
// covers one war cycle plus a cron hiccup, so every ended war is scanned at least once. Overridable
// via automation_config.lookback_hours if ever needed, but deliberately absent from the Settings UI.
export const DEFAULT_LOOKBACK_HOURS = 48;

/** Common lookback -> `since` ISO for the judgement detectors. */
export function lookbackSince(config: Record<string, unknown>): string {
  const hours = Number(config.lookback_hours ?? DEFAULT_LOOKBACK_HOURS);
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}
