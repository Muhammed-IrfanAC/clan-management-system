import { describe, it, expect } from 'vitest';
import {
  computeContributions,
  periodStart,
  type ContributionPeriod,
  type RecruitmentLog,
} from './contribution';
import type { OnboardingEvent, OnboardingEventType } from '@/types/database';

const NOW = new Date('2026-07-20T00:00:00.000Z');

function event(over: Partial<OnboardingEvent> & { event_type: OnboardingEventType }): OnboardingEvent {
  return {
    id: 'e1',
    person_id: 'p1',
    actor_tag: '#LEADER',
    outcome: null,
    clan_id: 'clan1',
    account_tag: null,
    metadata: {},
    created_at: NOW.toISOString(),
    ...over,
  };
}

function recruit(over: Partial<RecruitmentLog>): RecruitmentLog {
  return {
    logged_by: '#LEADER',
    related_person_id: 'p1',
    logged_at: NOW.toISOString(),
    ...over,
  };
}

// days before NOW, as an ISO string
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('periodStart', () => {
  it('is null for all-time', () => {
    expect(periodStart('all', NOW)).toBeNull();
  });
  it('subtracts the window for 30d / 90d', () => {
    expect(periodStart('30d', NOW)!.toISOString()).toBe(daysAgo(30));
    expect(periodStart('90d', NOW)!.toISOString()).toBe(daysAgo(90));
  });
});

describe('computeContributions — activity metrics (credit actor_tag)', () => {
  it('counts each activity event against its actor', () => {
    const events = [
      event({ event_type: 'engagement_attempt', outcome: 'replied' }),
      event({ event_type: 'engagement_attempt', outcome: 'ignored' }),
      event({ event_type: 'invited_discord' }),
      event({ event_type: 'joined_discord' }),
      event({ event_type: 'linked_accounts_checked' }),
    ];
    const { rows } = computeContributions(events, [], {}, 'all', NOW, { '#LEADER': 'Lead' });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.name).toBe('Lead');
    expect(r.engagementAttempts).toBe(2);
    expect(r.recruitReplies).toBe(1); // only the 'replied' outcome
    expect(r.discordInvites).toBe(1);
    expect(r.discordJoins).toBe(1);
    expect(r.linkedChecked).toBe(1);
  });

  it('ignores events with no actor_tag', () => {
    const events = [event({ event_type: 'engagement_attempt', actor_tag: null })];
    const { rows } = computeContributions(events, [], {}, 'all', NOW, {});
    expect(rows).toHaveLength(0);
  });

  it('excludes activity outside the period', () => {
    const events = [
      event({ event_type: 'engagement_attempt', created_at: daysAgo(5) }),
      event({ event_type: 'engagement_attempt', created_at: daysAgo(60) }),
    ];
    const { rows } = computeContributions(events, [], {}, '30d', NOW, {});
    expect(rows[0].engagementAttempts).toBe(1);
  });

  it('falls back to the tag when no display name is resolved', () => {
    const events = [event({ event_type: 'invited_discord' })];
    const { rows } = computeContributions(events, [], {}, 'all', NOW, {});
    expect(rows[0].name).toBe('#LEADER');
  });
});

describe('computeContributions — outcome metrics (credit recruiter cohort)', () => {
  it('credits the cohort and promotion to the recruiter, not the promoter', () => {
    const events = [
      // A different leader performs the promotion action; credit must still go to the recruiter.
      event({ event_type: 'promoted_elder', person_id: 'p1', actor_tag: '#OTHER', created_at: daysAgo(2) }),
    ];
    const logs = [recruit({ logged_by: '#LEADER', related_person_id: 'p1', logged_at: daysAgo(10) })];
    const { rows } = computeContributions(events, logs, { p1: daysAgo(10) }, 'all', NOW, {
      '#LEADER': 'Lead',
      '#OTHER': 'Other',
    });
    const lead = rows.find((r) => r.tag === '#LEADER')!;
    expect(lead.cohortSize).toBe(1);
    expect(lead.babiesMade).toBe(1);
    expect(lead.conversion).toBe(1);
    // #OTHER only promoted — no cohort of their own.
    expect(rows.find((r) => r.tag === '#OTHER')).toBeUndefined();
  });

  it('attributes a person to their EARLIEST recruiter only', () => {
    const logs = [
      recruit({ logged_by: '#FIRST', related_person_id: 'p1', logged_at: daysAgo(20) }),
      recruit({ logged_by: '#SECOND', related_person_id: 'p1', logged_at: daysAgo(5) }),
    ];
    const { rows } = computeContributions([], logs, {}, 'all', NOW, {});
    expect(rows.find((r) => r.tag === '#FIRST')!.cohortSize).toBe(1);
    expect(rows.find((r) => r.tag === '#SECOND')).toBeUndefined();
  });

  it('excludes a cohort member recruited outside the period', () => {
    const logs = [recruit({ related_person_id: 'p1', logged_at: daysAgo(60) })];
    const { rows } = computeContributions([], logs, {}, '30d', NOW, {});
    expect(rows).toHaveLength(0);
  });

  it('conversion is 0 (not null) for a non-empty cohort with no promotions', () => {
    const logs = [recruit({ related_person_id: 'p1' })];
    const { rows } = computeContributions([], logs, {}, 'all', NOW, {});
    expect(rows[0].cohortSize).toBe(1);
    expect(rows[0].babiesMade).toBe(0);
    expect(rows[0].conversion).toBe(0); // null is reserved for an empty cohort
  });

  it('ignores recruitment logs missing required fields', () => {
    const logs = [
      recruit({ logged_by: null }),
      recruit({ related_person_id: null }),
      recruit({ logged_at: null }),
    ];
    const { rows } = computeContributions([], logs, {}, 'all', NOW, {});
    expect(rows).toHaveLength(0);
  });
});

describe('computeContributions — avgOnboardingDays', () => {
  it('averages recruit→elder days over the promoted cohort', () => {
    // p1 promoted 5 days after creation, p2 promoted 15 days after creation → avg 10.
    const events = [
      event({ event_type: 'promoted_elder', person_id: 'p1', created_at: daysAgo(15) }),
      event({ event_type: 'promoted_elder', person_id: 'p2', created_at: daysAgo(5) }),
    ];
    const logs = [
      recruit({ related_person_id: 'p1', logged_at: daysAgo(25) }),
      recruit({ related_person_id: 'p2', logged_at: daysAgo(25) }),
    ];
    const created = { p1: daysAgo(20), p2: daysAgo(20) };
    const { rows } = computeContributions(events, logs, created, 'all', NOW, {});
    expect(rows[0].avgOnboardingDays).toBeCloseTo(10, 6);
  });

  it('uses the EARLIEST promotion timestamp when a person was promoted twice', () => {
    const events = [
      event({ event_type: 'promoted_elder', person_id: 'p1', created_at: daysAgo(2) }),
      event({ event_type: 'promoted_elder', person_id: 'p1', created_at: daysAgo(8) }),
    ];
    const logs = [recruit({ related_person_id: 'p1', logged_at: daysAgo(25) })];
    const { rows } = computeContributions(events, logs, { p1: daysAgo(20) }, 'all', NOW, {});
    // earliest promo is 8 days ago → 20 - 8 = 12 days onboarding
    expect(rows[0].avgOnboardingDays).toBeCloseTo(12, 6);
  });

  it('is null when no created_at baseline exists for the promoted person', () => {
    const events = [event({ event_type: 'promoted_elder', person_id: 'p1', created_at: daysAgo(2) })];
    const logs = [recruit({ related_person_id: 'p1', logged_at: daysAgo(10) })];
    const { rows } = computeContributions(events, logs, {}, 'all', NOW, {});
    expect(rows[0].babiesMade).toBe(1);
    expect(rows[0].avgOnboardingDays).toBeNull();
  });

  it('drops a negative onboarding span (promotion before creation baseline)', () => {
    const events = [event({ event_type: 'promoted_elder', person_id: 'p1', created_at: daysAgo(20) })];
    const logs = [recruit({ related_person_id: 'p1', logged_at: daysAgo(25) })];
    // created AFTER promotion → negative span, excluded from the average
    const { rows } = computeContributions(events, logs, { p1: daysAgo(10) }, 'all', NOW, {});
    expect(rows[0].babiesMade).toBe(1);
    expect(rows[0].avgOnboardingDays).toBeNull();
  });
});

describe('computeContributions — family totals', () => {
  it('sums counts across leaders and derives family conversion / avg', () => {
    const events = [
      event({ event_type: 'engagement_attempt', actor_tag: '#A' }),
      event({ event_type: 'engagement_attempt', actor_tag: '#B' }),
      event({ event_type: 'promoted_elder', person_id: 'p1', created_at: daysAgo(5) }),
      event({ event_type: 'promoted_elder', person_id: 'p2', created_at: daysAgo(15) }),
    ];
    const logs = [
      recruit({ logged_by: '#A', related_person_id: 'p1', logged_at: daysAgo(25) }),
      recruit({ logged_by: '#A', related_person_id: 'p3', logged_at: daysAgo(25) }), // recruited, not promoted
      recruit({ logged_by: '#B', related_person_id: 'p2', logged_at: daysAgo(25) }),
    ];
    const created = { p1: daysAgo(20), p2: daysAgo(20) };
    const { totals } = computeContributions(events, logs, created, 'all', NOW, {});
    expect(totals.name).toBe('All leaders');
    expect(totals.engagementAttempts).toBe(2);
    expect(totals.cohortSize).toBe(3); // p1, p3 (via #A) + p2 (via #B)
    expect(totals.babiesMade).toBe(2); // p1, p2
    expect(totals.conversion).toBeCloseTo(2 / 3, 6);
    expect(totals.avgOnboardingDays).toBeCloseTo(10, 6); // (15 + 5) / 2
  });

  it('returns zeroed totals with null derived fields for empty input', () => {
    const { rows, totals } = computeContributions([], [], {}, 'all', NOW, {});
    expect(rows).toHaveLength(0);
    expect(totals.cohortSize).toBe(0);
    expect(totals.conversion).toBeNull();
    expect(totals.avgOnboardingDays).toBeNull();
  });
});
