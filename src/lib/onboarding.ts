import { supabase } from './supabase';
import { personExists } from './babies';
import { OnboardingEvent, OnboardingEventType } from '@/types/database';

/**
 * Structured Onboarding System (AHA v1.0).
 *
 * Every routine onboarding step is recorded as an `onboarding_events` row rather than a
 * free-text note. The member's onboarding STAGE is derived from these events (single source
 * of truth) — nothing is cached on the person. Notes are reserved for exceptional cases.
 */

export const MAX_ENGAGEMENT_ATTEMPTS = 3;

// A single logical step in the onboarding pipeline. `eventTypes` are the event(s) that satisfy
// the step (clan assignment is satisfied by EITHER 9.1 or Mini). `icon` is a lucide icon name
// resolved by the UI, keeping this module free of React/JSX so sync + API can import it too.
export interface PipelineStep {
  key: string;
  label: string;
  icon: string;
  eventTypes: OnboardingEventType[];
  repeatable?: boolean;      // may legitimately occur more than once (attempts, extra accounts)
  requiresOutcome?: boolean; // engagement attempts carry a 'replied' | 'ignored' outcome
}

// Display + completion order, faithful to the spec's Structured Onboarding Journey.
export const PIPELINE: PipelineStep[] = [
  { key: 'engagement', label: 'Engagement', icon: 'MessageCircle', eventTypes: ['engagement_attempt'], repeatable: true, requiresOutcome: true },
  { key: 'rules', label: 'War Rules Passed', icon: 'ClipboardCheck', eventTypes: ['rules_passed'] },
  { key: 'linked', label: 'Linked Accounts Checked', icon: 'LinkIcon', eventTypes: ['linked_accounts_checked'] },
  { key: 'additional', label: 'Additional Accounts Registered', icon: 'UserPlus', eventTypes: ['additional_account_registered'], repeatable: true },
  // Clan assignment is only relevant once additional accounts exist; the UI gates it accordingly.
  { key: 'assignment', label: 'Clan Assigned', icon: 'Flag', eventTypes: ['assigned_clan'] },
  { key: 'invited', label: 'Invited to Discord', icon: 'Send', eventTypes: ['invited_discord'] },
  { key: 'joined', label: 'Joined Discord', icon: 'CheckCircle', eventTypes: ['joined_discord'] },
  { key: 'promoted', label: 'Promoted to Elder', icon: 'ArrowUpCircle', eventTypes: ['promoted_elder'] },
];

// Event types a leader may record manually via the API. `promoted_elder` is system-only
// (emitted by clan sync when it detects an in-game promotion), so it is deliberately excluded.
export const MANUAL_EVENT_TYPES: OnboardingEventType[] = [
  'engagement_attempt',
  'rules_passed',
  'linked_accounts_checked',
  'additional_account_registered',
  'assigned_clan',
  'invited_discord',
  'joined_discord',
  'discord_waived',
];

export interface OnboardingStatus {
  attemptsUsed: number;
  replied: boolean;
  concluded: boolean;   // 3 attempts, none replied → onboarding has concluded (spec: Three-Attempt Rule)
  promoted: boolean;
  completed: Set<OnboardingEventType>;
  nextStepKey: string | null; // first unsatisfied pipeline step, for "next action" highlighting
}

/**
 * Pure (client-safe): derive the current onboarding status from a member's events.
 * Used by the profile timeline and reusable by later automation queues.
 */
export function deriveOnboardingStatus(events: OnboardingEvent[]): OnboardingStatus {
  const attempts = events.filter((e) => e.event_type === 'engagement_attempt');
  const attemptsUsed = attempts.length;
  const replied = attempts.some((e) => e.outcome === 'replied');
  const completed = new Set(events.map((e) => e.event_type));

  // "No Discord" waives both Discord steps: treat them as satisfied so the pipeline advances and
  // the member drops out of the Discord queue instead of stalling at "Invited, not joined".
  if (completed.has('discord_waived')) {
    completed.add('invited_discord');
    completed.add('joined_discord');
  }

  const nextStep = PIPELINE.find((step) => {
    // A repeatable step never blocks the pipeline; treat it as "in progress" not a gate.
    if (step.repeatable) return false;
    return !step.eventTypes.some((t) => completed.has(t));
  });

  return {
    attemptsUsed,
    replied,
    concluded: attemptsUsed >= MAX_ENGAGEMENT_ATTEMPTS && !replied,
    promoted: completed.has('promoted_elder'),
    completed,
    nextStepKey: nextStep?.key ?? null,
  };
}

/**
 * Record one onboarding event. Attributed to the acting leader (or NULL for system/sync).
 * Enforces the Three-Attempt Rule cap for engagement attempts. Throws on invalid input or
 * a missing person. Returns the inserted row.
 */
export async function addOnboardingEvent(params: {
  personId: string;
  eventType: OnboardingEventType;
  actorTag: string | null;
  outcome?: 'replied' | 'ignored' | null;
  clanId?: string | null;
  accountTag?: string | null;
  metadata?: Record<string, any>;
}): Promise<OnboardingEvent> {
  const { personId, eventType } = params;

  if (eventType === 'engagement_attempt') {
    if (params.outcome !== 'replied' && params.outcome !== 'ignored') {
      throw new Error('An engagement attempt requires an outcome of "replied" or "ignored"');
    }
  }

  if (!(await personExists(personId))) {
    throw new Error('Member not found');
  }

  // Cap engagement attempts at MAX_ENGAGEMENT_ATTEMPTS (Three-Attempt Rule).
  if (eventType === 'engagement_attempt') {
    const { count, error: countError } = await supabase
      .from('onboarding_events')
      .select('id', { count: 'exact', head: true })
      .eq('person_id', personId)
      .eq('event_type', 'engagement_attempt');
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_ENGAGEMENT_ATTEMPTS) {
      throw new Error(`Maximum of ${MAX_ENGAGEMENT_ATTEMPTS} engagement attempts reached`);
    }
  }

  const { data, error } = await supabase
    .from('onboarding_events')
    .insert([{
      person_id: personId,
      event_type: eventType,
      actor_tag: params.actorTag,
      outcome: eventType === 'engagement_attempt' ? params.outcome : null,
      clan_id: params.clanId ?? null,
      account_tag: params.accountTag ?? null,
      metadata: params.metadata ?? {},
    }])
    .select()
    .single();
  if (error) throw error;
  return data as OnboardingEvent;
}
