import { supabase } from '@/lib/supabase';
import { pollLeagueState, type TaggedLeagueWar } from './api';
import { UNREVEALED_WAR_TAG, type CoCLeagueWarClan } from '@/lib/coc-api';
import { buildLineup, persistWarAttacks } from '@/lib/warAttacks';

/**
 * Phase 2 live-state ingestion. Polls every participating family clan's current CWL league group
 * (READ-ONLY) and records our side of each revealed round into cwl_rounds + cwl_war_members, so the
 * dashboard can show live lineups, attack usage and missed attacks without any in-game action.
 *
 * Called from the global sync route after the roster pass. It is resilient by construction: a clan
 * that is off-season (no league group) or errors is skipped, never aborting the rest — mirroring the
 * per-clan isolation of src/lib/sync.ts. Polling off-season is a no-op (pollLeagueState -> null).
 */

// CWL is only live once a season is signed up / in progress. Other statuses have no league group.
const LIVE_STATUSES = ['signed_up', 'in_progress'];

type SeasonClanRow = { clan_id: string; clan: { id: string; clan_tag: string } | null };

/** Sum a member's single CWL attack into flat stars/destruction/used fields. */
function memberResult(m: CoCLeagueWarClan['members'][number]) {
  const attacks = m.attacks ?? [];
  return {
    attacks_used: attacks.length,
    stars: attacks.reduce((s, a) => s + a.stars, 0),
    destruction: attacks.reduce((s, a) => s + a.destructionPercentage, 0),
  };
}

/** Given a fetched war and our clan tag, return our side (clan/opponent) or null if we aren't in it. */
function ourSide(war: TaggedLeagueWar, clanTag: string): { us: CoCLeagueWarClan; them: CoCLeagueWarClan } | null {
  if (war.clan.tag === clanTag) return { us: war.clan, them: war.opponent };
  if (war.opponent.tag === clanTag) return { us: war.opponent, them: war.clan };
  return null;
}

/** Ingest one family clan's league state into cwl_rounds + cwl_war_members. Returns rounds upserted. */
async function ingestClan(seasonId: string, clanId: string, clanTag: string): Promise<number> {
  const snap = await pollLeagueState(clanTag);
  if (!snap) return 0; // off-season for this clan

  const warByTag = new Map(snap.wars.map((w) => [w.warTag, w] as const));
  let upserted = 0;

  for (let i = 0; i < snap.group.rounds.length; i++) {
    const roundNumber = i + 1;
    const tags = snap.group.rounds[i].warTags.filter((t) => t && t !== UNREVEALED_WAR_TAG);

    // Find the war in this round that we actually play in (one revealed tag per round is ours).
    let war: TaggedLeagueWar | undefined;
    let side: { us: CoCLeagueWarClan; them: CoCLeagueWarClan } | null = null;
    for (const tag of tags) {
      const candidate = warByTag.get(tag);
      const s = candidate ? ourSide(candidate, clanTag) : null;
      if (candidate && s) { war = candidate; side = s; break; }
    }
    if (!war || !side) continue;

    // Upsert the round, capturing its id for the member rows.
    const { data: roundRow, error: roundErr } = await supabase
      .from('cwl_rounds')
      .upsert(
        {
          season_id: seasonId,
          clan_id: clanId,
          round_number: roundNumber,
          war_tag: war.warTag,
          state: war.state,
          team_size: war.teamSize,
          opponent_name: side.them.name,
          opponent_tag: side.them.tag,
          opponent_lineup: buildLineup(side.them.members),
          our_stars: side.us.stars,
          our_destruction: side.us.destructionPercentage,
          our_attacks_used: side.us.attacks,
          start_time: war.startTime || null,
          end_time: war.endTime || null,
          polled_at: new Date().toISOString(),
        },
        { onConflict: 'season_id,clan_id,round_number' },
      )
      .select('id')
      .single();
    if (roundErr || !roundRow) { console.error('CWL round upsert failed:', roundErr); continue; }
    upserted++;

    // Resolve our members' tags -> persons (attribution) and -> db_role (rank, for late-snipe).
    const tagsInWar = side.us.members.map((m) => m.tag);
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

    const memberRows = side.us.members.map((m) => {
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
        .from('cwl_war_members')
        .upsert(memberRows, { onConflict: 'round_id,player_tag' });
      if (memErr) console.error('CWL war members upsert failed:', memErr);
    }

    await persistWarAttacks({
      table: 'cwl_war_attacks',
      roundId: roundRow.id,
      state: war.state,
      ourMembers: side.us.members,
      opponentMembers: side.them.members,
      personByTag,
      rankByTag,
    });
  }

  return upserted;
}

export async function syncCwlLiveState(): Promise<{ seasonsPolled: number; roundsUpserted: number }> {
  const { data: seasons } = await supabase
    .from('cwl_seasons')
    .select('id')
    .in('status', LIVE_STATUSES);

  let seasonsPolled = 0;
  let roundsUpserted = 0;

  for (const season of (seasons as { id: string }[] | null) || []) {
    try {
      const { data: sc } = await supabase
        .from('cwl_season_clans')
        .select('clan_id, clan:clans(id, clan_tag)')
        .eq('season_id', season.id);

      let anyPolled = false;
      for (const row of (sc as unknown as SeasonClanRow[]) || []) {
        const tag = row.clan?.clan_tag;
        if (!tag) continue;
        try {
          roundsUpserted += await ingestClan(season.id, row.clan_id, tag);
          anyPolled = true;
        } catch (err) {
          console.error(`CWL live ingest failed for clan ${tag}:`, err);
        }
      }

      if (anyPolled) {
        seasonsPolled++;
        await supabase.from('cwl_seasons').update({ last_polled_at: new Date().toISOString() }).eq('id', season.id);
      }
    } catch (err) {
      console.error(`CWL live sync failed for season ${season.id}:`, err);
    }
  }

  return { seasonsPolled, roundsUpserted };
}
