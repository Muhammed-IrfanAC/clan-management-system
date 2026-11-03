/**
 * Why an account is not in a clan's fighting lineup — the PURE explainer behind the roster board's
 * callout. No DB, no React, unit-tested like allocation.ts / lineup.ts.
 *
 * The allocation engine already writes a reason onto every account it EXCLUDES (`cwl_allocations.
 * note`: no eligible clan, family full, banned from CWL, marked not participating). That column was
 * never read by the UI, so the board showed a name sitting in the Unassigned pile with no way to
 * find out why short of re-reading the engine's source. Surfacing it is most of the work here.
 *
 * BENCH is the half the engine cannot annotate, because the reason depends on WHEN you ask:
 *
 *  - While the roster is being formed, bench is a pure consequence of ranking — the clan was filled
 *    strongest-first and this account fell past `warSize`. That is explainable from its position.
 *  - From sign-up onward `signupReconcile.ts` overwrites the bench flag from the in-game lineup, and
 *    the game owes us no explanation. An account benched there can be the clan's THIRD strongest,
 *    at which point "ranked below the war size" is simply false.
 *
 * So the position is compared against the war size rather than assumed to follow it, and a benched
 * account that is strong enough to play is reported as somebody's decision rather than the engine's
 * arithmetic. Getting this wrong would be worse than showing nothing: a confident, wrong reason on
 * the board is what a leader would then go and repeat to the player.
 */

export type BenchReasonKind = 'below_war_size' | 'chosen';

export interface BenchReason {
  kind: BenchReasonKind;
  /** One sentence, addressed to the leader reading the board. */
  text: string;
}

/**
 * Explain one benched account.
 *
 * @param position  its 1-based rank within its clan's roster, strongest first.
 * @param warSize   the clan's war size — positions above it have no lineup slot to sit in.
 */
export function benchReason(position: number, warSize: number): BenchReason {
  if (position > warSize) {
    return {
      kind: 'below_war_size',
      text: `Ranked #${position} in this clan, below its war size of ${warSize} — the lineup was full before reaching them.`,
    };
  }
  return {
    kind: 'chosen',
    text: `Ranked #${position}, inside the war size of ${warSize} — benched by choice, not by ranking.`,
  };
}

/** One account the board needs to explain, reduced to what the explainer reads. */
export interface ExcludedAccount {
  name: string;
  note: string | null;
}

/** Accounts sharing one reason, so the callout lists a reason once rather than once per player. */
export interface ExclusionGroup {
  reason: string;
  names: string[];
}

/**
 * Fallback for an account excluded with no note — a leader's manual "Remove from season", which is
 * a deliberate act with no engine reasoning behind it.
 */
export const MANUAL_REMOVAL_REASON = 'Removed from the season by leadership';

/**
 * Group excluded accounts by their reason, preserving first-seen order so the list is stable across
 * re-renders (and, since the engine emits removals in a fixed order, across reloads).
 */
export function groupExclusions(accounts: ExcludedAccount[]): ExclusionGroup[] {
  const groups = new Map<string, ExclusionGroup>();
  for (const a of accounts) {
    const reason = a.note?.trim() || MANUAL_REMOVAL_REASON;
    let group = groups.get(reason);
    if (!group) {
      group = { reason, names: [] };
      groups.set(reason, group);
    }
    group.names.push(a.name);
  }
  return Array.from(groups.values());
}
