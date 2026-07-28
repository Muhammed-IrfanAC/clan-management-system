import type { CWLLeagueTierId, CWLRound, CWLWarMember } from '@/types/database';
import { tierOrder } from './leagues';

/**
 * CWL bench-rotation suggester (Phase 4).
 *
 * A CWL season is TOTAL_ROUNDS war days, and each war day a clan fields only `warSize` of its signed
 * roster. When the roster is bigger than the war size, someone has to sit every round — and doing that
 * fairly (so the same people don't always bench) is exactly what leaders were eyeballing by hand.
 *
 * This is the forward-looking counterpart to performance.ts / history.ts (which RECORD rounds already
 * played): given each ACCOUNT's rounds-played SO FAR (from synced actuals) it recommends, for every
 * round not yet locked, who plays and who benches — always letting the under-played catch up first so
 * everyone lands on a similar number of war days by the end of the season.
 *
 * Pure and side-effect free (no Supabase/I/O) so the fairness maths is unit-testable and the panel
 * stays thin — same shape as the other cwl/ engines. `roundsPlayedByAccount` is the one small bridge
 * from the stored round/member rows to this engine's `playedSoFar` input.
 */

/** A CWL season is always seven war days. */
export const TOTAL_ROUNDS = 7;

/** One signed roster member, with the rounds they have ALREADY been fielded in this season. */
export interface RotationPlayer {
  playerTag: string;
  name: string;
  thLevel: number;
  leagueTier: CWLLeagueTierId | null;
  playedSoFar: number; // rounds already fought (seeds fairness so under-played players catch up)
}

/** An account referenced inside a round plan or summary (a thin slice of RotationPlayer). */
export interface RotationSlot {
  playerTag: string;
  name: string;
  thLevel: number;
}

/** The suggested lineup for one not-yet-locked round. */
export interface RotationRoundPlan {
  roundNumber: number;
  playing: RotationSlot[]; // exactly warSize (or the whole roster when it is smaller)
  bench: RotationSlot[]; // everyone sitting this round — the actionable "who to bench" list
}

/** Per-player projection across the remaining rounds. */
export interface PlayerRotationSummary {
  playerTag: string;
  name: string;
  thLevel: number;
  playedSoFar: number;
  suggestedPlays: number; // remaining rounds we recommend they play
  benchRounds: number; // remaining rounds we recommend they sit
  projectedTotal: number; // playedSoFar + suggestedPlays — the season-end war-day count
}

/** A whole clan's rotation recommendation. */
export interface ClanRotation {
  clanId: string;
  warSize: number;
  rosterSize: number;
  totalRounds: number;
  remainingRoundNumbers: number[]; // round numbers we produced a plan for (not yet locked)
  rounds: RotationRoundPlan[];
  summary: PlayerRotationSummary[]; // sorted strongest-first for a stable read
  noBenchNeeded: boolean; // roster fits the war size — nobody ever has to sit
}

// Strongest-first: higher TH, then higher Ranked sub-division, then name (matches allocation.ts).
function byStrength(a: RotationPlayer, b: RotationPlayer): number {
  if (b.thLevel !== a.thLevel) return b.thLevel - a.thLevel;
  const l = tierOrder(b.leagueTier) - tierOrder(a.leagueTier);
  if (l !== 0) return l;
  return a.name.localeCompare(b.name);
}

const toSlot = (p: RotationPlayer): RotationSlot => ({ playerTag: p.playerTag, name: p.name, thLevel: p.thLevel });

/**
 * Count, per ACCOUNT, how many of a clan's rounds it has already been fielded in. An account
 * "played" a round if it appears in the lineup (whether or not the attack was used) — that is what
 * consumes a war-day slot. Only rounds belonging to `clanId` are considered.
 *
 * Keyed on player_tag, not person_id: a war day is spent by a base, so a person fielding a main in
 * one clan and an alt in another has each account earning its own rotation credit. Keying on the
 * person would have made one player's two accounts share (and halve) a single fairness budget.
 */
export function roundsPlayedByAccount(
  rounds: CWLRound[],
  members: CWLWarMember[],
  clanId: string,
): Map<string, number> {
  const clanRoundIds = new Set(rounds.filter((r) => r.clan_id === clanId).map((r) => r.id));
  // An account appears once per round; guard against dupes by counting distinct (tag, round) pairs.
  const seen = new Set<string>();
  const played = new Map<string, number>();
  for (const m of members) {
    if (!clanRoundIds.has(m.round_id)) continue;
    const pair = `${m.player_tag}::${m.round_id}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    played.set(m.player_tag, (played.get(m.player_tag) ?? 0) + 1);
  }
  return played;
}

/**
 * Suggest who benches in each not-yet-locked round for one clan.
 *
 * @param roster           the clan's signed roster, each with playedSoFar.
 * @param warSize          how many attack each round (15 | 30).
 * @param lockedRoundNumbers round numbers already decided (have a live lineup) — skipped.
 * @param totalRounds      war days in the season (default TOTAL_ROUNDS = 7).
 */
export function suggestClanRotation(
  clanId: string,
  roster: RotationPlayer[],
  warSize: number,
  lockedRoundNumbers: number[] = [],
  totalRounds: number = TOTAL_ROUNDS,
): ClanRotation {
  const locked = new Set(lockedRoundNumbers);
  const remainingRoundNumbers: number[] = [];
  for (let n = 1; n <= totalRounds; n++) if (!locked.has(n)) remainingRoundNumbers.push(n);

  // Live tally of rounds each account will have played, seeded from actuals so the fairness engine
  // accounts for war days that already happened.
  const played = new Map<string, number>();
  const plays = new Map<string, number>(); // suggested plays across the remaining rounds
  for (const p of roster) {
    played.set(p.playerTag, p.playedSoFar);
    plays.set(p.playerTag, 0);
  }

  const rounds: RotationRoundPlan[] = remainingRoundNumbers.map((roundNumber) => {
    // Fairness order: fewest rounds played so far goes in first (catch-up); ties broken by strength so
    // the stronger of two equally-rested players takes the slot. Fresh sort each round as counts change.
    const order = roster.slice().sort((a, b) => {
      const pa = played.get(a.playerTag)!;
      const pb = played.get(b.playerTag)!;
      if (pa !== pb) return pa - pb;
      return byStrength(a, b);
    });
    const playing = order.slice(0, warSize);
    const bench = order.slice(warSize);
    for (const p of playing) {
      played.set(p.playerTag, played.get(p.playerTag)! + 1);
      plays.set(p.playerTag, plays.get(p.playerTag)! + 1);
    }
    return { roundNumber, playing: playing.map(toSlot), bench: bench.map(toSlot) };
  });

  const remainingCount = remainingRoundNumbers.length;
  const summary: PlayerRotationSummary[] = roster
    .slice()
    .sort(byStrength)
    .map((p) => {
      const suggestedPlays = plays.get(p.playerTag)!;
      return {
        playerTag: p.playerTag,
        name: p.name,
        thLevel: p.thLevel,
        playedSoFar: p.playedSoFar,
        suggestedPlays,
        benchRounds: remainingCount - suggestedPlays,
        projectedTotal: p.playedSoFar + suggestedPlays,
      };
    });

  return {
    clanId,
    warSize,
    rosterSize: roster.length,
    totalRounds,
    remainingRoundNumbers,
    rounds,
    summary,
    noBenchNeeded: roster.length <= warSize,
  };
}
