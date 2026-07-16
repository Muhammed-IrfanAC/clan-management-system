/**
 * Shared types for the rule-automation framework.
 *
 * A *detector* is a built-in piece of code that scans game/DB state and emits DetectedViolations.
 * It is referenced by a stable `automation_key` on a rule row; the rule also carries the detector's
 * tunable `automation_config`. Logic lives here in code, parameters live in the DB — we never store
 * or eval logic from the database.
 */

// One concrete violation a detector found. The scanner attaches the rule id/name and turns this
// into a warning row (auto-logged) or, for review-mode detectors, a queued suggestion (future).
export type DetectedViolation = {
  personId: string;
  playerTag: string;
  clanId: string | null;      // for routing the Discord notification to the member's clan channel
  source: 'regular' | 'cwl';  // which war type it came from — drives the per-clan automation scope
  memberName: string | null;  // in-game / war name, for a readable message
  description: string;         // becomes warnings.description
  dedupKey: string;            // stable per real-world violation; drives idempotent insert
  occurredAt: string;         // ISO — becomes warnings.logged_at (reflects when it happened)
  // Optional structured context for review-mode detectors — surfaced to the leader in the review
  // queue so they can judge without opening the game (TH levels, remaining time, open bases, …).
  evidence?: Record<string, unknown>;
};

// A detector implementation: given its tunable config, return every violation it currently sees.
// Must be idempotent to re-run (the scanner dedups on dedupKey), and must never throw for the
// normal empty case — return [].
export type Detector = (config: Record<string, unknown>) => Promise<DetectedViolation[]>;
