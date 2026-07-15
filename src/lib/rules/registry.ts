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
      '(2 attacks) and CWL (1 attack). Clear-cut, so it auto-logs.',
    mode: 'auto',
    configFields: [
      {
        key: 'lookback_hours',
        label: 'Lookback (hours)',
        type: 'number',
        default: 72,
        help: 'Only scan rounds that ended within this many hours.',
      },
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
