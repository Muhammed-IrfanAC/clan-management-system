/**
 * Detector METADATA registry — the single list of built-in automated detectors.
 *
 * This module is deliberately PURE (no DB, no server-only imports) so the Settings UI can import it
 * to render the detector dropdown and config inputs, while the server-only detector implementations
 * (src/lib/rules/detectors/*) map the same keys to actual scan functions. Adding a detector = add a
 * metadata entry here + register its implementation in detectors/index.ts.
 */

export type DetectorConfigField = {
  key: string;
  label: string;
  type: 'number' | 'text';
  default: number | string;
  help?: string;
};

export type DetectorMode =
  | 'auto'    // clear-cut: log the warning immediately on detection
  | 'review'; // judgement call: queue for a leader to confirm (not yet implemented)

export type DetectorMeta = {
  key: string;
  label: string;
  description: string;
  mode: DetectorMode;
  configFields: DetectorConfigField[];
};

export const DETECTOR_REGISTRY: DetectorMeta[] = [
  {
    key: 'war_missed_attack',
    label: 'Missed war attack',
    description:
      'Flags any linked member who left war attacks unused in a completed war — regular clan wars ' +
      '(2 attacks) and CWL (1 attack). Leaders and co-leaders are exempt (by dashboard access role, ' +
      'so all their alts are covered too). Clear-cut, so it auto-strikes. Multiple breaks in the same ' +
      'war fold into that war’s single strike.',
    mode: 'auto',
    // No tunables — a missed attack is a missed attack. (The scan window is internal; see
    // DEFAULT_LOOKBACK_HOURS in the detectors.)
    configFields: [],
  },
  {
    key: 'war_unjustified_hitup',
    label: 'Unjustified hit-up',
    description:
      'Flags an elder-or-lower member who attacked a HIGHER town hall while an equal-or-lower base ' +
      'was still open (not 3-starred), in regular clan wars and CWL. Leaders and co-leaders are ' +
      'exempt (by dashboard access role, so their alts are covered too) — they often hit up ' +
      'deliberately to open the map. A member is flagged at most once per ' +
      'war, even if both of their attacks hit up. A judgement call, so it is queued for a leader to ' +
      'confirm or dismiss rather than auto-striking. Confirming folds it into that war’s strike (it ' +
      'never adds a second strike for a war the member is already struck for).',
    mode: 'review',
    configFields: [
      { key: 'min_th_gap', label: 'Min TH gap', type: 'number', default: 1,
        help: 'How many town-hall levels above the attacker the hit base must be to count.' },
    ],
  },
  {
    key: 'war_late_snipe',
    label: 'Low-rank late snipe',
    description:
      'Flags an elder-or-lower member who attacked in the war’s final hours — catching members who ' +
      'wait until the end to snipe loot off already-cleared bases, in regular clan wars and CWL. ' +
      'Leaders and co-leaders are exempt (by dashboard access role, so their alts are covered too). ' +
      'Attack timing is inferred from the sync polls. Auto-strikes ' +
      'on detection; it folds into that war’s single strike alongside any other break.',
    mode: 'auto',
    configFields: [
      { key: 'window_hours', label: 'Final window (hours)', type: 'number', default: 6,
        help: 'An attack this many hours or less before war end counts as "late".' },
    ],
  },
];

export function detectorMeta(key: string | null | undefined): DetectorMeta | undefined {
  return key ? DETECTOR_REGISTRY.find((d) => d.key === key) : undefined;
}

/** The default config object (field key -> default value) for a detector, for seeding on attach. */
export function defaultConfigFor(key: string): Record<string, number | string> {
  const cfg: Record<string, number | string> = {};
  for (const f of detectorMeta(key)?.configFields ?? []) cfg[f.key] = f.default;
  return cfg;
}
