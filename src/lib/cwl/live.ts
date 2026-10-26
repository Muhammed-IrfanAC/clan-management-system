import { supabase } from '@/lib/supabase';
import { pollLeagueState, type KnownRound, type TaggedLeagueWar } from './api';
import { fetchLeagueWar, UNREVEALED_WAR_TAG, type CoCLeagueWar, type CoCLeagueWarClan } from '@/lib/coc-api';
import { buildLineup, persistWarAttacks } from '@/lib/warAttacks';
import { parseCoCTime } from '@/lib/cocTime';
import { notifyLineupIfRevealed, recordLineupChange } from './lineupNotify';
import type { FieldedSlot } from './lineupChange';
import { reconcileSeasonSignups } from './signupSync';
import type { ClanSignup } from './signupReconcile';

/**
 * Phase 2 live-state ingestion. Polls every participating family clan's current CWL league group
 * (READ-ONLY) and records our side of each revealed round into cwl_rounds + cwl_war_members, so the
 * dashboard can show live lineups, attack usage and missed attacks without any in-game action.
 *
 * Called from the global sync route after the roster pass. It is resilient by construction: a clan
 * that is off-season (no league group) or errors is skipped, never aborting the rest — mirroring the
 * per-clan isolation of src/lib/sync.ts. Polling off-season is a no-op (pollLeagueState -> null).
 */

/**
 * Which seasons to poll. Everything except a finished one: the season's status is a LEADER'S marker
 * of where the planning work has got to, and it lags reality — CWL starting in-game does not wait
 * for anyone to tick a dropdown. Gating polling on 'signed_up' meant a season left in 'planning'
 * (the normal state on prep day, since the leader has no reason to advance it until asked) showed an
 * empty live tracker all week. Polling an off-season clan is already a no-op, so the cost of the
 * wider net is nothing.
 */
const POLLABLE_STATUSES = ['planning', 'transfers_pending', 'signed_up', 'in_progress'];

/** Statuses that a live league group should push the season forward FROM (never backwards). */
const PRE_LIVE_STATUSES = ['planning', 'transfers_pending', 'signed_up'];

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

/**
 * What one clan's poll produced: the rounds it wrote, how many of the clan's rounds are revealed at
 * all (written this poll or already stored as ended), and the in-game signup list to reconcile.
 */
interface ClanIngest {
  upserted: number;
  revealed: number;
  signup: ClanSignup | null;
}

/**
 * The rounds this clan already has stored, keyed by round number. A round stored as `warEnded` is
 * final — its members, attacks and notices were all written when it was live — so the poll skips it
 * rather than re-fetching and re-writing seven finished wars every five minutes by the end of the week.
 */
async function loadKnownRounds(seasonId: string, clanId: string): Promise<Map<number, KnownRound>> {
  const { data, error } = await supabase
    .from('cwl_rounds')
    .select('round_number, war_tag, state')
    .eq('season_id', seasonId)
    .eq('clan_id', clanId);
  // Without the hint the poll just does the full work, so a failed read costs time, not correctness.
  if (error) console.error('CWL known-round read failed (polling every round):', error);
  const known = new Map<number, KnownRound>();
  for (const r of (data as { round_number: number; war_tag: string | null; state: string | null }[] | null) || []) {
    if (r.war_tag) known.set(r.round_number, { warTag: r.war_tag, ended: r.state === 'warEnded' });
  }
  return known;
}

/** Ingest one family clan's league state into cwl_rounds + cwl_war_members. */
async function ingestClan(
  seasonId: string,
  clanId: string,
  clanTag: string,
  fetchWar: (warTag: string) => Promise<CoCLeagueWar>,
): Promise<ClanIngest> {
  const known = await loadKnownRounds(seasonId, clanId);
  const snap = await pollLeagueState(clanTag, { known, fetchWar });
  if (!snap) return { upserted: 0, revealed: 0, signup: null }; // off-season for this clan

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
          start_time: parseCoCTime(war.startTime),
          end_time: parseCoCTime(war.endTime),
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

    // The lineup as we last recorded it, read BEFORE this poll overwrites it. It is the only thing a
    // mid-preparation swap can be detected against (see lineupChange.ts).
    const { data: priorMembers } = await supabase
      .from('cwl_war_members')
      .select('player_tag, name')
      .eq('round_id', roundRow.id);
    const previousFielded: FieldedSlot[] = ((priorMembers as { player_tag: string; name: string | null }[] | null) || [])
      .map((m) => ({ playerTag: m.player_tag, name: m.name || m.player_tag }));

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

    // Is this read COMPLETE? A CWL war is always exactly teamSize a side — the game does not field a
    // short roster — so a member list that comes back smaller is a partial read, not a lineup. That
    // distinction is load-bearing twice over: a partial read would prune the missing rows (deleting
    // real members, who then read as zero-attack bodies once the war ends — a missed-attack strike
    // for a war they were in all along) and announce them as swapped out with nobody swapped in,
    // which is the "swap out with no swap in" a leader sees on Discord and cannot act on.
    //
    // The upsert above still runs: everything we DID receive is current data and worth storing. Only
    // the two destructive/announcing steps are skipped, and the next poll — reading a full list —
    // handles it properly, including leaving the round unstamped so its reveal notice is not lost.
    const fullRead = !war.teamSize || side.us.members.length >= war.teamSize;
    if (!fullRead) {
      console.warn(
        `CWL partial member read for round ${roundNumber} (${clanTag}): ${side.us.members.length}/${war.teamSize} — skipping prune and swap notice`,
      );
    }

    // PRUNE anyone no longer in the war. The upsert only ever adds and updates, so before this a
    // swapped-out player kept their row forever: a 15v15 read back as 16 bodies, and — worse — once
    // the round ended that ghost row was a member with zero attacks in an ended war, which is
    // precisely what the war_missed_attack detector strikes. A player pulled from the lineup could
    // be struck for a war they were never in. The in-game roster is the authority on who is in it.
    const currentTags = side.us.members.map((m) => m.tag);
    const staleTags = previousFielded
      .filter((p) => !currentTags.some((t) => t.toUpperCase() === p.playerTag.toUpperCase()))
      .map((p) => p.playerTag);
    if (staleTags.length && fullRead) {
      const { error: delErr } = await supabase
        .from('cwl_war_members')
        .delete()
        .eq('round_id', roundRow.id)
        .in('player_tag', staleTags);
      if (delErr) console.error('CWL stale war member prune failed:', delErr);
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

    // Announce the revealed lineup and how it differs from the formed roster. Runs after the member
    // rows are written so it reads the lineup this poll just landed; it no-ops for any round that is
    // not freshly revealed, and swallows its own failures (see notifyLineupIfRevealed).
    if (fullRead) await notifyLineupIfRevealed({
      seasonId,
      clanId,
      roundId: roundRow.id,
      roundNumber,
      state: war.state,
      opponentName: side.them.name,
      startTime: parseCoCTime(war.startTime),
    });

    // ...and, for a round already revealed on an earlier poll, whether the lineup has since CHANGED.
    // No-ops on the reveal poll itself (nothing to compare against) and outside preparation.
    if (fullRead) await recordLineupChange({
      clanId,
      roundId: roundRow.id,
      roundNumber,
      state: war.state,
      opponentName: side.them.name,
      startTime: parseCoCTime(war.startTime),
      previous: previousFielded,
      current: side.us.members.map((m) => ({ playerTag: m.tag, name: m.name })),
    });
  }

  const revealed = upserted + snap.settledRounds.length;

  // `group.clans[].members` is the clan's authoritative CWL signup list — who leadership actually
  // signed in, available from prep day regardless of which round has been revealed. It is the input
  // the roster board is reconciled against (see signupReconcile.ts).
  const ourGroupClan = snap.group.clans.find((c) => c.tag === clanTag);
  const signup: ClanSignup | null = ourGroupClan
    ? {
        clanId,
        members: ourGroupClan.members.map((m) => ({
          playerTag: m.tag,
          name: m.name,
          thLevel: m.townHallLevel ?? null,
        })),
        lineupRevealed: revealed > 0,
      }
    : null;

  return { upserted, revealed, signup };
}

export async function syncCwlLiveState(): Promise<{ seasonsPolled: number; roundsUpserted: number }> {
  const { data: seasons } = await supabase
    .from('cwl_seasons')
    .select('id, status')
    .in('status', POLLABLE_STATUSES);

  let seasonsPolled = 0;
  let roundsUpserted = 0;
  // One fetch per war tag for the whole pass: two family clans in one group share their wars.
  const warFetches = new Map<string, Promise<CoCLeagueWar>>();
  const fetchWar = (warTag: string) => {
    if (!warFetches.has(warTag)) warFetches.set(warTag, fetchLeagueWar(warTag));
    return warFetches.get(warTag)!;
  };

  for (const season of (seasons as { id: string; status: string }[] | null) || []) {
    try {
      const { data: sc } = await supabase
        .from('cwl_season_clans')
        .select('clan_id, clan:clans(id, clan_tag)')
        .eq('season_id', season.id);

      // Clans are independent until the signup reconcile below, so they are polled together.
      const results = await Promise.all(
        ((sc as unknown as SeasonClanRow[]) || []).map(async (row) => {
          const tag = row.clan?.clan_tag;
          if (!tag) return null;
          try {
            return await ingestClan(season.id, row.clan_id, tag, fetchWar);
          } catch (err) {
            console.error(`CWL live ingest failed for clan ${tag}:`, err);
            return null;
          }
        }),
      );
      const polled = results.filter((r): r is ClanIngest => !!r);
      const anyPolled = polled.length > 0;
      const seasonRevealed = polled.reduce((n, r) => n + r.revealed, 0);
      roundsUpserted += polled.reduce((n, r) => n + r.upserted, 0);
      const signups = polled.flatMap((r) => (r.signup ? [r.signup] : []));

      // Reconcile ONCE per season, after every clan is polled — an account that moved between two
      // family clans is only judged correctly when both signup lists are in hand, exactly as
      // detectCompletedTransfers waits for the whole roster pass.
      if (signups.length) {
        try {
          await reconcileSeasonSignups(season.id, signups);
        } catch (err) {
          console.error(`CWL signup reconcile failed for season ${season.id}:`, err);
        }
      }

      if (anyPolled) {
        seasonsPolled++;
        const update: Record<string, string> = { last_polled_at: new Date().toISOString() };
        // A revealed round is CWL having actually started. The status dropdown is a leader's planning
        // marker and routinely lags that, so the game moves it forward — never backwards, and never
        // out of 'completed'.
        if (seasonRevealed > 0 && PRE_LIVE_STATUSES.includes(season.status)) update.status = 'in_progress';
        await supabase.from('cwl_seasons').update(update).eq('id', season.id);
      }
    } catch (err) {
      console.error(`CWL live sync failed for season ${season.id}:`, err);
    }
  }

  return { seasonsPolled, roundsUpserted };
}
