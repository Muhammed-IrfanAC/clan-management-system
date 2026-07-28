/**
 * Decide, from what the roster sync last saw in game, which required CWL transfers have actually
 * happened — and which have come undone.
 *
 * Pure and unit-tested; `roster.ts` holds the DB half. The move itself happens in game, and until now
 * the only record of it was a leader ticking a checkbox. But every family clan's roster is polled
 * every few minutes, so `player_accounts.clan_id` already IS the answer: an account sitting in the
 * clan it was told to move to has moved. The checkbox stays for the cases below, it just stops being
 * the only way the board can learn the truth.
 *
 * Two rules make this safe to run unattended:
 *
 *   WE ONLY JUDGE WHAT WE CAN SEE. A transfer is left completely alone unless its destination clan is
 *   one we actively sync. Otherwise a clan that stopped being polled would freeze at whatever it read
 *   on the last sync and then permanently contradict the leader who knows better.
 *
 *   ARRIVAL IS "ACTIVE AND IN THE RIGHT CLAN". `clan_id` alone is not enough: when a player leaves,
 *   the sync marks the row 'left' but leaves `clan_id` pointing at the clan they left (that column is
 *   only rewritten by the clan that next claims them). Reading the id alone would call someone who
 *   quit the family "arrived".
 *
 * Detection runs in both directions on purpose. A transfer that reverts to pending is not noise — it
 * is a player who moved and then moved back out, which is precisely the thing a leader would
 * otherwise discover on war day.
 */

/** What the last sync knows about one required move. */
export interface TransferObservation {
  transferId: string;
  allocationId: string;
  /** Current recorded state of the move. */
  status: string;
  /** The clan the account was told to move to. */
  toClanId: string | null;
  /** The clan the account was last seen in. Null = never synced into any family clan. */
  actualClanId: string | null;
  /** `player_accounts.status` — 'active' means the clan's roster still lists them. */
  accountStatus: string | null;
}

/** A state change to write. Transfer and allocation move together so the two can never drift. */
export interface TransferOutcome {
  transferId: string;
  allocationId: string;
  transferStatus: 'done' | 'pending';
  allocationStatus: 'transferred' | 'transfer_required';
  /** True when the account arrived, false when it is no longer where it was recorded as arriving. */
  arrived: boolean;
}

/**
 * Diff observed reality against recorded state, returning only the transfers that need writing.
 *
 * `syncedClanIds` is the set of clans the roster sync actually polls — a destination outside it is
 * unobservable, so those transfers are skipped in both directions. Transfers in any state other than
 * pending/done (i.e. 'missed') are left alone: that state is a leader's judgement call about someone
 * who ran out of time, not an observation this can improve on.
 */
export function detectTransferOutcomes(
  observations: TransferObservation[],
  syncedClanIds: Set<string>,
): TransferOutcome[] {
  const outcomes: TransferOutcome[] = [];

  for (const o of observations) {
    if (o.status !== 'pending' && o.status !== 'done') continue;
    if (!o.toClanId || !syncedClanIds.has(o.toClanId)) continue;

    const arrived = o.actualClanId === o.toClanId && o.accountStatus === 'active';
    if (arrived === (o.status === 'done')) continue; // already recorded correctly

    outcomes.push({
      transferId: o.transferId,
      allocationId: o.allocationId,
      transferStatus: arrived ? 'done' : 'pending',
      allocationStatus: arrived ? 'transferred' : 'transfer_required',
      arrived,
    });
  }

  return outcomes;
}
