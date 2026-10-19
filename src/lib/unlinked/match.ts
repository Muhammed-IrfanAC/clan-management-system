/**
 * PURE: which existing persons an unlinked account most likely belongs to, by name.
 *
 * Alts follow their owner's naming far more often than not — "Bob", "Bob²", "bob alt", "Bob 2.0" —
 * so a name comparison that ignores case, decoration and trailing numbering finds the owner for the
 * common case and turns linking an alt into one click. It only SUGGESTS: a leader still picks, and an
 * unrelated "Bob" in another clan is a wrong guess the leader simply does not click. Sharing the
 * joiner's clan breaks ties, since a player's alts tend to live where they do.
 */

export type PersonCandidate = {
  personId: string;
  displayName: string;
  /** In-game names of the person's linked accounts. */
  accountNames: string[];
  clanIds: string[];
};

export type PersonSuggestion = { personId: string; displayName: string; score: number };

const MAX_SUGGESTIONS = 3;

/** Lowercase, letters and digits only, with alt-style suffixes ("alt", "2", "ii", "²") removed. */
export function nameKey(name: string): string {
  const folded = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim();
  const stripped = folded
    .replace(/(\s|^)(alt|main|mini|acc|account|farm|farmer)(\s|$)/g, ' ')
    .replace(/(\s|^)(ii|iii|iv|v)$/g, '')
    .replace(/[\d\s]+$/g, '')
    .replace(/\s+/g, '');
  // Never strip a name down to nothing ("2", "Alt"): fall back to the plain fold.
  return stripped || folded.replace(/\s+/g, '');
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 3;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.includes(short)) return 2;
  let prefix = 0;
  while (prefix < short.length && short[prefix] === long[prefix]) prefix++;
  return prefix >= 4 ? 1 : 0;
}

export function suggestPersons(
  joiner: { name: string; clanId?: string | null },
  candidates: PersonCandidate[],
): PersonSuggestion[] {
  const key = nameKey(joiner.name);
  const scored: (PersonSuggestion & { sameClan: boolean })[] = [];
  for (const c of candidates) {
    const best = Math.max(0, ...[c.displayName, ...c.accountNames].map((n) => similarity(key, nameKey(n))));
    if (best === 0) continue;
    scored.push({
      personId: c.personId,
      displayName: c.displayName,
      score: best,
      sameClan: !!joiner.clanId && c.clanIds.includes(joiner.clanId),
    });
  }
  return scored
    .sort((x, y) => y.score - x.score || Number(y.sameClan) - Number(x.sameClan) || x.displayName.localeCompare(y.displayName))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ personId, displayName, score }) => ({ personId, displayName, score }));
}
