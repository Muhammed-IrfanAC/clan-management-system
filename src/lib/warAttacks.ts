import { supabase } from './supabase';

/**
 * Shared persistence for per-attack detail, used by BOTH regular-war ingestion (src/lib/war.ts ->
 * war_attacks) and CWL ingestion (src/lib/cwl/live.ts -> cwl_war_attacks). The two war types carry
 * structurally identical member/attack shapes, so this stays generic over the table name.
 *
 * Attack results are immutable once made (they only appear in the API after completion), so rows are
 * inserted ON CONFLICT DO NOTHING keyed on (round_id, attack_order): the FIRST sighting wins and its
 * first_seen_at/state are preserved — that is what lets the late-snipe detector infer whether an
 * attack fell in the war's final hours (the API gives no attack timestamp).
 */

// Minimal structural shape shared by CoCWarClan and CoCLeagueWarClan members/attacks.
type Attack = { attackerTag: string; defenderTag: string; stars: number; destructionPercentage: number; order: number };
type Member = { tag: string; name: string; townhallLevel: number; mapPosition: number; attacks?: Attack[] };

/** The enemy lineup snapshot stored on the round: every base + TH, including ones nobody attacked. */
export function buildLineup(members: Member[]): { tag: string; th: number; pos: number }[] {
  return members.map((m) => ({ tag: m.tag, th: m.townhallLevel, pos: m.mapPosition }));
}

/**
 * Upsert our side's attacks for one round. `personByTag`/`rankByTag` attribute each attacker; TH
 * levels come from our members (attacker) and a tag->TH map of the opponent lineup (defender).
 */
export async function persistWarAttacks(params: {
  table: 'war_attacks' | 'cwl_war_attacks';
  roundId: string;
  state: string;
  ourMembers: Member[];
  opponentMembers: Member[];
  personByTag: Map<string, string>;
  rankByTag: Map<string, string>;
}): Promise<void> {
  const { table, roundId, state, ourMembers, opponentMembers, personByTag, rankByTag } = params;

  const thByTag = new Map(opponentMembers.map((m) => [m.tag, m.townhallLevel] as const));

  const rows: Record<string, unknown>[] = [];
  for (const m of ourMembers) {
    for (const a of m.attacks ?? []) {
      rows.push({
        round_id: roundId,
        attack_order: a.order,
        attacker_tag: m.tag,
        attacker_name: m.name,
        attacker_person_id: personByTag.get(m.tag) ?? null,
        attacker_th: m.townhallLevel,
        attacker_rank: rankByTag.get(m.tag) ?? null,
        defender_tag: a.defenderTag,
        defender_th: thByTag.get(a.defenderTag) ?? null,
        stars: a.stars,
        destruction: a.destructionPercentage,
        first_seen_state: state,
      });
    }
  }
  if (!rows.length) return;

  const { error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: 'round_id,attack_order', ignoreDuplicates: true });
  if (error) console.error(`${table} upsert failed:`, error);
}
