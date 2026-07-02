import { OnboardingEvent } from '@/types/database';
import { deriveOnboardingStatus } from './onboarding';

/**
 * Onboarding Action Queues (AHA v1.0, Phase 3).
 *
 * Turns the derived onboarding stage into a proactive worklist: which in-flight members are
 * waiting on a specific leadership action, and how long they have been stuck there. Pure and
 * side-effect free so the classification is testable and the component stays thin.
 *
 * Each member lands in AT MOST ONE queue — the earliest unmet action in their journey — so the
 * dashboard reads as a to-do list, not a stat table. Promoted members leave the queues entirely.
 */

export type QueueKey =
  | 'first_contact'      // recruited, no engagement attempt yet
  | 'awaiting_reply'     // attempted (1–2), no reply yet, cap not reached
  | 'awaiting_rules'     // replied, war rules not yet passed
  | 'invited_not_joined' // invited to Discord, has not joined
  | 'naughty_step';      // Three-Attempt Rule exhausted with no reply — needs a decision

export type QueueTone = 'info' | 'warning' | 'danger';

export interface QueueDef {
  key: QueueKey;
  label: string;
  description: string;
  icon: string;   // lucide icon name, resolved by the UI
  tone: QueueTone;
}

// Priority order = earliest unmet action first, except the terminal Naughty Step which floats to
// the top because it needs an explicit leader decision (extend or remove).
export const QUEUES: QueueDef[] = [
  { key: 'naughty_step', label: 'Naughty Step', description: 'No reply after 3 attempts — decide to extend or remove.', icon: 'UserX', tone: 'danger' },
  { key: 'first_contact', label: 'Awaiting First Contact', description: 'Recruited but not yet reached out to.', icon: 'MessageCirclePlus', tone: 'warning' },
  { key: 'awaiting_reply', label: 'Awaiting Reply', description: 'Reached out — waiting on a response.', icon: 'Clock', tone: 'info' },
  { key: 'awaiting_rules', label: 'Awaiting War Rules', description: 'Replied — war rules not passed yet.', icon: 'ClipboardCheck', tone: 'warning' },
  { key: 'invited_not_joined', label: 'Invited, Not Joined', description: 'Invited to Discord — has not joined.', icon: 'Send', tone: 'info' },
];

export interface QueueMember {
  personId: string;
  name: string;
  queue: QueueKey;
  sinceIso: string;    // when the member entered this stage
  daysInStage: number; // whole days waiting, for staleness sorting/badges
  attemptsUsed: number;
}

export interface QueueBucket {
  def: QueueDef;
  members: QueueMember[];
}

// The person shape the classifier needs — display fields plus the raw event log.
export interface PersonOnboarding {
  id: string;
  display_name: string;
  created_at: string;
  onboarding_events: OnboardingEvent[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function wholeDays(fromIso: string, now: Date): number {
  const diff = now.getTime() - new Date(fromIso).getTime();
  return diff <= 0 ? 0 : Math.floor(diff / DAY_MS);
}

/** Timestamp of the latest event of a given type, or null. */
function latestEventTime(events: OnboardingEvent[], type: string): string | null {
  let latest: string | null = null;
  for (const e of events) {
    if (e.event_type !== type) continue;
    if (latest === null || new Date(e.created_at) > new Date(latest)) latest = e.created_at;
  }
  return latest;
}

/**
 * Classify a single member into the one queue that best describes what they're waiting on,
 * plus the timestamp they entered that stage. Returns null when no action is pending
 * (promoted, or progressing normally with no gap that needs a nudge).
 */
export function classify(person: PersonOnboarding): { key: QueueKey; sinceIso: string } | null {
  const events = person.onboarding_events || [];
  const status = deriveOnboardingStatus(events);
  if (status.promoted) return null;

  // Terminal: exhausted the Three-Attempt Rule with no reply — the loudest queue.
  if (status.concluded) {
    return { key: 'naughty_step', sinceIso: latestEventTime(events, 'engagement_attempt') ?? person.created_at };
  }

  // Never contacted — clock runs from when they were recruited/registered.
  if (status.attemptsUsed === 0) {
    return { key: 'first_contact', sinceIso: person.created_at };
  }

  // Reached out, no reply yet, still within the attempt cap.
  if (!status.replied) {
    return { key: 'awaiting_reply', sinceIso: latestEventTime(events, 'engagement_attempt') ?? person.created_at };
  }

  // Replied — the earliest remaining gate wins.
  if (!status.completed.has('rules_passed')) {
    return { key: 'awaiting_rules', sinceIso: latestEventTime(events, 'engagement_attempt') ?? person.created_at };
  }
  if (status.completed.has('invited_discord') && !status.completed.has('joined_discord')) {
    return { key: 'invited_not_joined', sinceIso: latestEventTime(events, 'invited_discord') ?? person.created_at };
  }

  // Progressing normally with no stalled action to surface.
  return null;
}

/**
 * Build the full set of queue buckets from a cohort of in-flight members. Buckets follow
 * QUEUES order; members within a bucket are sorted stalest-first (longest wait on top).
 */
export function buildQueues(persons: PersonOnboarding[], now: Date): QueueBucket[] {
  const byKey = new Map<QueueKey, QueueMember[]>(QUEUES.map((q) => [q.key, []]));

  for (const p of persons) {
    const hit = classify(p);
    if (!hit) continue;
    byKey.get(hit.key)!.push({
      personId: p.id,
      name: p.display_name,
      queue: hit.key,
      sinceIso: hit.sinceIso,
      daysInStage: wholeDays(hit.sinceIso, now),
      attemptsUsed: deriveOnboardingStatus(p.onboarding_events || []).attemptsUsed,
    });
  }

  for (const list of byKey.values()) {
    list.sort((a, b) => b.daysInStage - a.daysInStage);
  }

  return QUEUES.map((def) => ({ def, members: byKey.get(def.key)! }));
}
