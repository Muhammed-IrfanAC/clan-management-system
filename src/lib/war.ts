import { supabase } from './supabase';
import { fetchCurrentWar, type CoCWarClan } from './coc-api';
import { buildLineup, persistWarAttacks } from './warAttacks';

/**
 * Regular (non-CWL) clan war ingestion. Polls every active family clan's current war (READ-ONLY)
 * and records our side into war_rounds + war_members, so the same missed-attack detection that
 * works for CWL also works for normal wars. Mirrors src/lib/cwl/live.ts in structure and its
 * per-clan isolation: a clan not in a war, with a private war log, or that errors is skipped, never
 * aborting the rest.
 */

// Only ingest wars that actually exist. 'notInWar' carries no members/attacks.
const INGEST_STATES = ['preparation', 'inWar', 'warEnded'];

/** Sum a member's attacks (up to attacksPerMember) into flat used/stars/destruction fields. */
function memberResult(m: CoCWarClan['members'][number]) {
  const attacks = m.attacks ?? [];
  return {
    attacks_used: attacks.length,
    stars: attacks.reduce((s, a) => s + a.stars, 0),
    destruction: attacks.reduce((s, a) => s + a.destructionPercentage, 0),
  };
}

/** Ingest one clan's current war into war_rounds + war_members. Returns 1 if a war was upserted. */
async function ingestClan(clanId: string, clanTag: string): Promise<number> {
  const war = await fetchCurrentWar(clanTag);
  if (!war || !INGEST_STATES.includes(war.state) || !war.clan || !war.opponent) return 0;

  // The currentwar endpoint always returns the queried clan as `war.clan`.
  const us = war.clan;
  const them = war.opponent;

  const { data: roundRow, error: roundErr } = await supabase
    .from('war_rounds')
    .upsert(
      {
        clan_id: clanId,
        prep_start_time: war.preparationStartTime || null,
        state: war.state,
        team_size: war.teamSize ?? null,
        attacks_per_member: war.attacksPerMember ?? 2,
        opponent_name: them.name,
        opponent_tag: them.tag,
        opponent_lineup: buildLineup(them.members),
        our_stars: us.stars,
        our_destruction: us.destructionPercentage,
        our_attacks_used: us.attacks,
        start_time: war.startTime || null,
        end_time: war.endTime || null,
        polled_at: new Date().toISOString(),
      },
      { onConflict: 'clan_id,prep_start_time' },
    )
    .select('id')
    .single();
  if (roundErr || !roundRow) {
    console.error('War round upsert failed:', roundErr);
    return 0;
  }

  // Resolve our members' tags -> persons (attribution) and -> db_role (rank, for the late-snipe
  // detector) in one lookup — same global-by-tag resolution as CWL.
  const tagsInWar = us.members.map((m) => m.tag);
  const personByTag = new Map<string, string>();
  const rankByTag = new Map<string, string>();
  if (tagsInWar.length) {
    const { data: accts } = await supabase
      .from('player_accounts')
      .select('player_tag, person_id, db_role')
      .in('player_tag', tagsInWar);
    for (const a of (accts as { player_tag: string; person_id: string | null; db_role: string | null }[] | null) || []) {
      if (a.person_id) personByTag.set(a.player_tag, a.person_id);
      if (a.db_role) rankByTag.set(a.player_tag, a.db_role);
    }
  }

  const memberRows = us.members.map((m) => {
    const r = memberResult(m);
    return {
      round_id: roundRow.id,
      person_id: personByTag.get(m.tag) ?? null,
      player_tag: m.tag,
      name: m.name,
      th_level: m.townhallLevel,
      map_position: m.mapPosition,
      ...r,
    };
  });
  if (memberRows.length) {
    const { error: memErr } = await supabase
      .from('war_members')
      .upsert(memberRows, { onConflict: 'round_id,player_tag' });
    if (memErr) console.error('War members upsert failed:', memErr);
  }

  await persistWarAttacks({
    table: 'war_attacks',
    roundId: roundRow.id,
    state: war.state,
    ourMembers: us.members,
    opponentMembers: them.members,
    personByTag,
    rankByTag,
  });

  return 1;
}

export async function syncWarState(): Promise<{ clansPolled: number; warsUpserted: number }> {
  const { data: clans } = await supabase
    .from('clans')
    .select('id, clan_tag')
    .eq('active', true);

  let clansPolled = 0;
  let warsUpserted = 0;

  for (const clan of (clans as { id: string; clan_tag: string }[] | null) || []) {
    try {
      warsUpserted += await ingestClan(clan.id, clan.clan_tag);
      clansPolled++;
    } catch (err) {
      console.error(`Regular war ingest failed for clan ${clan.clan_tag}:`, err);
    }
  }

  return { clansPolled, warsUpserted };
}
