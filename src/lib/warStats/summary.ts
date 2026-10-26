import { countsForHitRate, labelAttacks, type AttackInput, type LabelledAttack } from './attackClass';

/**
 * PURE war-performance roll-up over a window of wars (the weekly post uses a clan's last 20). No DB,
 * no I/O — the loader hands it each war's attacks, as stored in `war_attacks` / `cwl_war_attacks`.
 *
 * Every figure is built on `attackClass.ts` labels: a hit on an already-tripled base is counted as a
 * `dead` hit and kept out of every hit rate, so the post-clear loot hit stops reading as a miss.
 *
 * Keyed per ACCOUNT (player tag), like strikes and CWL: two alts are two attackers in two war slots,
 * and merging them would hand each the other's triples. `personId` is carried for linking back.
 *
 * Missed attacks come from the war's member rows (`attacksAllowed - attacksUsed`), not the attacks:
 * an attack never made leaves no attack row. A war passed without `members` reports no misses.
 *
 * Hit rates are split by matchup — equal TH, hitting up, hitting down — because an overall rate
 * rewards farming lower bases. Equal-TH is the headline figure; a matchup with an unknown TH on
 * either side counts toward `overall` only.
 */

export type StatsAttack = AttackInput & {
  attackerTag: string;
  attackerName: string | null;
  attackerPersonId: string | null;
  attackerTh: number | null;
  defenderTh: number | null;
  destruction: number;
};

/** One of our members in a war's lineup — what the attack rows cannot show: who never attacked. */
export type WarSlot = {
  tag: string;
  name: string | null;
  personId: string | null;
  th: number | null;
  attacksAllowed: number;
  attacksUsed: number;
};

export type StatsWar = { id: string; attacks: StatsAttack[]; members?: WarSlot[] };

export type HitTally = {
  attacks: number;   // counted attacks (dead hits excluded)
  triples: number;
  rate: number | null; // triples / attacks; null with no counted attacks
};

export type Matchup = 'equal' | 'up' | 'down';

type Tallies = { overall: HitTally; equal: HitTally; up: HitTally; down: HitTally };

export type AccountWarStats = Tallies & {
  tag: string;
  name: string | null;          // the most recent name seen in the window
  personId: string | null;
  th: number | null;            // the most recent attacker TH seen in the window
  wars: number;                 // wars this account was in the lineup for (or attacked in)
  totalAttacks: number;         // every attack, dead hits included
  dead: number;
  missed: number;
  newStars: number;
  avgDestruction: number | null; // over counted attacks
};

export type WarStatsSummary = {
  wars: number;
  clan: Tallies & { totalAttacks: number; dead: number; missed: number; newStars: number };
  /** Equal-TH hit rate per town hall level, highest first — the "TH17 v TH17" lines. */
  equalByTh: { th: number; tally: HitTally }[];
  accounts: AccountWarStats[];
};

/** Equal / up / down, or null when either side's TH is unknown. */
export function matchupOf(a: { attackerTh: number | null; defenderTh: number | null }): Matchup | null {
  if (a.attackerTh == null || a.defenderTh == null) return null;
  if (a.defenderTh === a.attackerTh) return 'equal';
  return a.defenderTh > a.attackerTh ? 'up' : 'down';
}

/** Roll up `wars`, which the caller passes oldest first (names and TH follow the latest war). */
export function summarizeWars(wars: StatsWar[]): WarStatsSummary {
  const clan = { ...emptyTallies(), totalAttacks: 0, dead: 0, missed: 0, newStars: 0 };
  const byTh = new Map<number, HitTally>();
  type Acc = AccountWarStats & { destructionSum: number; warIds: Set<string> };
  const accounts = new Map<string, Acc>();

  // Identity fields follow the latest sighting, so a renamed or upgraded account reads as it is now.
  const accountFor = (warId: string, who: { tag: string; name: string | null; personId: string | null; th: number | null }) => {
    let acc = accounts.get(who.tag);
    if (!acc) {
      acc = {
        tag: who.tag,
        name: null,
        personId: null,
        th: null,
        wars: 0,
        totalAttacks: 0,
        dead: 0,
        missed: 0,
        newStars: 0,
        avgDestruction: null,
        ...emptyTallies(),
        destructionSum: 0,
        warIds: new Set<string>(),
      };
      accounts.set(who.tag, acc);
    }
    acc.name = who.name ?? acc.name;
    acc.personId = who.personId ?? acc.personId;
    acc.th = who.th ?? acc.th;
    acc.warIds.add(warId);
    return acc;
  };

  for (const war of wars) {
    for (const m of war.members ?? []) {
      const acc = accountFor(war.id, m);
      const missed = Math.max(0, m.attacksAllowed - m.attacksUsed);
      acc.missed += missed;
      clan.missed += missed;
    }

    for (const a of labelAttacks(war.attacks)) {
      const acc = accountFor(war.id, {
        tag: a.attackerTag,
        name: a.attackerName,
        personId: a.attackerPersonId,
        th: a.attackerTh,
      });

      for (const t of [acc, clan]) {
        t.totalAttacks++;
        t.newStars += a.newStars;
        if (!countsForHitRate(a)) t.dead++;
      }
      if (!countsForHitRate(a)) continue;

      acc.destructionSum += a.destruction;
      const m = matchupOf(a);
      for (const t of [acc, clan]) {
        record(t.overall, a);
        if (m) record(t[m], a);
      }
      if (m === 'equal') {
        const th = a.attackerTh as number;
        if (!byTh.has(th)) byTh.set(th, emptyTally());
        record(byTh.get(th)!, a);
      }
    }
  }

  return {
    wars: wars.length,
    clan: finishTallies(clan),
    equalByTh: [...byTh.entries()].sort(([x], [y]) => y - x).map(([th, tally]) => ({ th, tally: finish(tally) })),
    accounts: [...accounts.values()].map(({ destructionSum, warIds, ...acc }) => ({
      ...finishTallies(acc),
      wars: warIds.size,
      avgDestruction: acc.overall.attacks ? destructionSum / acc.overall.attacks : null,
    })),
  };
}

/**
 * Whether a war's attack rows are all there: the member rows say how many attacks were made, and
 * a war with fewer stored rows was only partly ingested. Labelling one would read a hit on a base
 * already tripled by a missing attack as fresh, so the loader leaves such a war out of the window.
 */
export function isWarComplete(war: StatsWar): boolean {
  if (!war.members) return true;
  return war.attacks.length >= war.members.reduce((n, m) => n + m.attacksUsed, 0);
}

export type TopHittersOptions = {
  matchup?: Matchup | 'overall'; // which tally ranks; default equal TH
  minAttacks?: number;           // counted attacks needed to qualify; default 5
  limit?: number;                // default 5
};

/**
 * The best hit rates in one tally. A floor on attacks is what keeps a single lucky triple (1/1,
 * 100%) off the top of the board; ties go to more triples, then more new stars, then the tag so the
 * order is stable from week to week.
 */
export function topHitters(accounts: AccountWarStats[], opts: TopHittersOptions = {}): AccountWarStats[] {
  const key = opts.matchup ?? 'equal';
  const min = opts.minAttacks ?? 5;
  return accounts
    .filter((a) => a[key].attacks >= min)
    .sort(
      (x, y) =>
        (y[key].rate ?? 0) - (x[key].rate ?? 0) ||
        y[key].triples - x[key].triples ||
        y.newStars - x.newStars ||
        x.tag.localeCompare(y.tag),
    )
    .slice(0, opts.limit ?? 5);
}

function emptyTally(): HitTally {
  return { attacks: 0, triples: 0, rate: null };
}

function emptyTallies(): Tallies {
  return { overall: emptyTally(), equal: emptyTally(), up: emptyTally(), down: emptyTally() };
}

function record(t: HitTally, a: LabelledAttack): void {
  t.attacks++;
  if (a.stars >= 3) t.triples++;
}

function finish(t: HitTally): HitTally {
  return { ...t, rate: t.attacks ? t.triples / t.attacks : null };
}

function finishTallies<T extends Tallies>(t: T): T {
  return { ...t, overall: finish(t.overall), equal: finish(t.equal), up: finish(t.up), down: finish(t.down) };
}
