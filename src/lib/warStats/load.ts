/**
 * DB half of war stats: a clan's last N ended wars — regular and CWL together — in the shape the
 * pure `summary.ts` rolls up.
 *
 * The window is the CLAN's last N wars, not each member's: one fixed set of wars for everyone, so
 * two members' rates are measured over the same fights. Regular and CWL wars interleave by end time;
 * a CWL war gives one attack per member against a regular war's two, which the summary needs no
 * special case for, since every rate is per attack.
 *
 * Attacks and members are read per war rather than with one `.in()` across the window: twenty
 * 50-a-side regular wars are up to 2,000 attack rows, past PostgREST's default row cap, and a
 * truncated read would quietly drop the newest attacks. Flat selects, so the module runs on the
 * in-memory test database.
 */

import { supabase } from '@/lib/supabase';
import { isWarComplete, type StatsAttack, type StatsWar, type WarSlot } from './summary';

export const WAR_STATS_WINDOW = 20;

type Source = 'regular' | 'cwl';

const TABLES: Record<Source, { rounds: string; attacks: string; members: string }> = {
  regular: { rounds: 'war_rounds', attacks: 'war_attacks', members: 'war_members' },
  cwl: { rounds: 'cwl_rounds', attacks: 'cwl_war_attacks', members: 'cwl_war_members' },
};

type RoundRow = { id: string; end_time: string; attacks_per_member?: number | null };
type Round = RoundRow & { source: Source };

type AttackRow = {
  attack_order: number;
  attacker_tag: string;
  attacker_name: string | null;
  attacker_person_id: string | null;
  attacker_th: number | null;
  defender_tag: string;
  defender_th: number | null;
  stars: number;
  destruction: number | string; // NUMERIC on the CWL side arrives as a string
};

type MemberRow = {
  player_tag: string;
  name: string | null;
  person_id: string | null;
  th_level: number | null;
  attacks_used: number | null;
};

export type WarWindow = {
  /** The complete wars, oldest first, ready for `summarizeWars`. */
  wars: StatsWar[];
  /** Ended wars inside the window left out because their attacks were only partly stored. */
  skipped: number;
};

async function endedRounds(source: Source, clanId: string, limit: number): Promise<Round[]> {
  const cols = source === 'regular' ? 'id, end_time, attacks_per_member' : 'id, end_time';
  const { data, error } = await supabase
    .from(TABLES[source].rounds)
    .select(cols)
    .eq('clan_id', clanId)
    .eq('state', 'warEnded')
    .not('end_time', 'is', null) // DESC puts nulls first in Postgres; an undated war has no place in "last N"
    .order('end_time', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data as unknown as RoundRow[]) || []).map((r) => ({ ...r, source }));
}

async function loadWar(round: Round): Promise<StatsWar> {
  const t = TABLES[round.source];
  const [attacks, members] = await Promise.all([
    supabase
      .from(t.attacks)
      .select('attack_order, attacker_tag, attacker_name, attacker_person_id, attacker_th, defender_tag, defender_th, stars, destruction')
      .eq('round_id', round.id),
    supabase.from(t.members).select('player_tag, name, person_id, th_level, attacks_used').eq('round_id', round.id),
  ]);
  if (attacks.error) throw attacks.error;
  if (members.error) throw members.error;

  // CWL is one attack per member by rule; a regular war stores its own (2, occasionally 1).
  const allowed = round.source === 'cwl' ? 1 : (round.attacks_per_member ?? 2);
  return {
    id: `${round.source}:${round.id}`,
    attacks: ((attacks.data as AttackRow[]) || []).map(
      (a): StatsAttack => ({
        order: a.attack_order,
        attackerTag: a.attacker_tag,
        attackerName: a.attacker_name,
        attackerPersonId: a.attacker_person_id,
        attackerTh: a.attacker_th,
        defenderTag: a.defender_tag,
        defenderTh: a.defender_th,
        stars: a.stars,
        destruction: Number(a.destruction),
      }),
    ),
    members: ((members.data as MemberRow[]) || []).map(
      (m): WarSlot => ({
        tag: m.player_tag,
        name: m.name,
        personId: m.person_id,
        th: m.th_level,
        attacksAllowed: allowed,
        attacksUsed: m.attacks_used ?? 0,
      }),
    ),
  };
}

/** The clan's last `limit` ended wars, regular and CWL interleaved by end time. */
export async function loadClanWarWindow(clanId: string, limit = WAR_STATS_WINDOW): Promise<WarWindow> {
  const [regular, cwl] = await Promise.all([endedRounds('regular', clanId, limit), endedRounds('cwl', clanId, limit)]);
  const rounds = [...regular, ...cwl]
    .sort((a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime())
    .slice(0, limit)
    .reverse(); // oldest first: the summary takes names and TH from the latest war

  const loaded = await Promise.all(rounds.map(loadWar));
  const wars = loaded.filter(isWarComplete);
  return { wars, skipped: loaded.length - wars.length };
}
