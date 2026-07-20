import { supabase } from '@/lib/supabase';
import type { DetectedViolation } from '../types';
import { DEFAULT_LOOKBACK_HOURS, loadExemptPersonIds } from './warContextLoad';

/**
 * Missed-attack detector (`war_missed_attack`), covering BOTH war types:
 *   - Regular wars (war_rounds/war_members): each member gets `attacks_per_member` (usually 2)
 *     attacks; a miss is using fewer than allowed.
 *   - CWL wars (cwl_rounds/cwl_war_members): each member gets one attack; a miss is zero.
 *
 * Only ENDED rounds count (`state = 'warEnded'`), so a member who simply hasn't attacked yet in a
 * live war is never flagged; and only rows with a linked person (attribution + a real warning
 * target). The scan window (DEFAULT_LOOKBACK_HOURS) bounds it to recently-ended rounds so the cron
 * doesn't re-sweep all history — an internal bound, not a rule setting; correctness is guaranteed
 * regardless by the caller's dedup key.
 *
 * Leaders and co-leaders are EXEMPT — mirroring the hit-up / late-snipe rules. Leadership is the
 * org's persons.access_role designation (not the fickle in-game db_role), and it lives on the person,
 * so a leader who missed on a member-rank alt is still exempt — the exemption spans all their accounts.
 */
export async function detectMissedAttacks(
  config: Record<string, unknown>,
): Promise<DetectedViolation[]> {
  const lookbackHours = Number(config.lookback_hours ?? DEFAULT_LOOKBACK_HOURS);
  const since = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();

  const [regular, cwl] = await Promise.all([
    detectRegular(since),
    detectCwl(since),
  ]);
  const all = [...regular, ...cwl];

  // Drop leaders/co-leaders (by persons.access_role). The exemption is per person, so a leader who
  // missed on a member-rank alt is exempt too — access_role covers all their linked accounts.
  const exempt = await loadExemptPersonIds(all.map((v) => v.personId));
  return all.filter((v) => !exempt.has(v.personId));
}

/** Regular clan wars — a miss is attacks_used < attacks_per_member. */
async function detectRegular(since: string): Promise<DetectedViolation[]> {
  const { data, error } = await supabase
    .from('war_members')
    .select(
      'person_id, player_tag, name, attacks_used, ' +
        'war_rounds!inner(id, clan_id, state, attacks_per_member, opponent_name, end_time)',
    )
    .not('person_id', 'is', null)
    .eq('war_rounds.state', 'warEnded')
    .gte('war_rounds.end_time', since);

  if (error) {
    console.error('missed-attack (regular) query failed:', error);
    return [];
  }

  type Row = {
    person_id: string;
    player_tag: string;
    name: string | null;
    attacks_used: number;
    war_rounds: {
      id: string;
      clan_id: string;
      attacks_per_member: number | null;
      opponent_name: string | null;
      end_time: string | null;
    } | null;
  };

  const violations: DetectedViolation[] = [];
  for (const r of (data as unknown as Row[]) || []) {
    const round = r.war_rounds;
    if (!round) continue;
    const allowed = round.attacks_per_member ?? 2;
    const missed = allowed - r.attacks_used;
    if (missed <= 0) continue;

    violations.push({
      personId: r.person_id,
      playerTag: r.player_tag,
      clanId: round.clan_id,
      source: 'regular',
      memberName: r.name,
      description: `${missedPhrase(r.attacks_used, allowed)} — clan war${
        round.opponent_name ? ` vs ${round.opponent_name}` : ''
      }.`,
      dedupKey: `war_missed_attack:regular:${round.id}:${r.player_tag}`,
      occurredAt: round.end_time || new Date().toISOString(),
      warRoundId: round.id,
      warLabel: `Clan war${round.opponent_name ? ` vs ${round.opponent_name}` : ''}`,
    });
  }
  return violations;
}

/** CWL wars — one attack per member, a miss is zero used. */
async function detectCwl(since: string): Promise<DetectedViolation[]> {
  const { data, error } = await supabase
    .from('cwl_war_members')
    .select(
      'person_id, player_tag, name, attacks_used, ' +
        'cwl_rounds!inner(id, clan_id, round_number, state, opponent_name, end_time)',
    )
    .eq('attacks_used', 0)
    .not('person_id', 'is', null)
    .eq('cwl_rounds.state', 'warEnded')
    .gte('cwl_rounds.end_time', since);

  if (error) {
    console.error('missed-attack (CWL) query failed:', error);
    return [];
  }

  type Row = {
    person_id: string;
    player_tag: string;
    name: string | null;
    attacks_used: number;
    cwl_rounds: {
      id: string;
      clan_id: string;
      round_number: number;
      opponent_name: string | null;
      end_time: string | null;
    } | null;
  };

  const violations: DetectedViolation[] = [];
  for (const r of (data as unknown as Row[]) || []) {
    const round = r.cwl_rounds;
    if (!round) continue;
    violations.push({
      personId: r.person_id,
      playerTag: r.player_tag,
      clanId: round.clan_id,
      source: 'cwl',
      memberName: r.name,
      description: `Missed war attack — CWL Round ${round.round_number}${
        round.opponent_name ? ` vs ${round.opponent_name}` : ''
      }.`,
      dedupKey: `war_missed_attack:cwl:${round.id}:${r.player_tag}`,
      occurredAt: round.end_time || new Date().toISOString(),
      warRoundId: round.id,
      warLabel: `CWL Round ${round.round_number}${
        round.opponent_name ? ` vs ${round.opponent_name}` : ''
      }`,
    });
  }
  return violations;
}

/** Human phrasing for a regular-war miss, e.g. "Missed both war attacks" or "Missed a war attack (used 1/2)". */
function missedPhrase(used: number, allowed: number): string {
  if (used === 0) return allowed === 1 ? 'Missed war attack' : `Missed all ${allowed} war attacks`;
  return `Missed a war attack (used ${used}/${allowed})`;
}
