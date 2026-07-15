import type { Detector } from '../types';
import { detectMissedAttacks } from './missedAttack';
import { detectUnjustifiedHitUps } from './hitUp';
import { detectLateSnipes } from './lateSnipe';

/**
 * Maps a rule's `automation_key` to its detector implementation. Keys MUST match the metadata in
 * src/lib/rules/registry.ts. Server-only (detectors touch the DB) — never import this from a client
 * component; import the pure registry instead.
 */
export const DETECTORS: Record<string, Detector> = {
  war_missed_attack: detectMissedAttacks,
  war_unjustified_hitup: detectUnjustifiedHitUps,
  war_late_snipe: detectLateSnipes,
};
