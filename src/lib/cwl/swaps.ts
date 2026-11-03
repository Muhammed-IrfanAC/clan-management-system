/**
 * The swaps a leader has to make in game to get from the lineup that exists now to the planned one
 * for the next war: who goes out, who comes in.
 *
 * "Now" is the lineup the leader would actually be editing:
 *  - the next war's own in-game lineup, once it is on prep day (its members are already stored) —
 *    the game seeds it and the leader may have changed it since, so it is the truth to diff against;
 *  - otherwise the most recent war we fielded, walking back past any round with no member rows
 *    (an unpolled round would read as the whole lineup coming in).
 * Before any lineup exists there is nothing to swap from, and the result says so.
 *
 * Which out pairs with which in is not a real thing in CWL — a lineup is a set — so the two lists
 * are reported side by side, each in map order, not as invented pairs.
 *
 * Pure: no I/O, unit-tested beside it.
 */

export interface SwapPerson {
  playerTag: string;
  name: string;
}

export interface LineupSwaps {
  /** The round whose lineup was compared against; null when there is none yet. */
  fromRound: number | null;
  /** True when `fromRound` is the next war itself (its in-game prep-day lineup). */
  fromCurrentPrep: boolean;
  out: SwapPerson[];
  in: SwapPerson[];
}

export interface SwapRound {
  id: string;
  round_number: number;
}

export interface SwapMember {
  round_id: string;
  player_tag: string;
  name: string | null;
  map_position: number | null;
}

/**
 * @param planned  the next war's planned lineup, in map order.
 * @param nextRoundNumber  the war being planned.
 */
export function lineupSwaps(params: {
  planned: SwapPerson[];
  nextRoundNumber: number;
  rounds: SwapRound[];
  members: SwapMember[];
}): LineupSwaps {
  const { planned, nextRoundNumber, rounds, members } = params;
  const membersOf = (roundId: string) =>
    members
      .filter((m) => m.round_id === roundId)
      .sort((a, b) => (a.map_position ?? Infinity) - (b.map_position ?? Infinity));

  // The next war itself first, then every earlier war, newest first.
  const candidates = rounds
    .filter((r) => r.round_number <= nextRoundNumber)
    .sort((a, b) => b.round_number - a.round_number);
  const base = candidates.find((r) => membersOf(r.id).length > 0);
  if (!base) return { fromRound: null, fromCurrentPrep: false, out: [], in: [] };

  const current = membersOf(base.id).map((m) => ({ playerTag: m.player_tag, name: m.name || m.player_tag }));
  const key = (t: string) => t.toUpperCase();
  const plannedTags = new Set(planned.map((p) => key(p.playerTag)));
  const currentTags = new Set(current.map((c) => key(c.playerTag)));

  return {
    fromRound: base.round_number,
    fromCurrentPrep: base.round_number === nextRoundNumber,
    out: current.filter((c) => !plannedTags.has(key(c.playerTag))),
    in: planned.filter((p) => !currentTags.has(key(p.playerTag))),
  };
}
