import { OnboardingEvent } from '@/types/database';

/**
 * Leadership Contribution Report (AHA v1.0, Phase 2).
 *
 * Rolls the structured onboarding evidence up into per-leader recognition metrics. Framed as
 * recognition of culture-building work, NOT a ranking. Pure and side-effect free so the math is
 * testable and the component stays thin.
 *
 * Two attribution models:
 *  - ACTIVITY metrics credit the leader who performed the action (`actor_tag` on the event),
 *    counted when the event falls in the period.
 *  - OUTCOME metrics credit the person's ORIGINAL RECRUITER (the leader who recruited them), over
 *    the recruiter's cohort = distinct persons they recruited within the period. This mirrors the
 *    sync auto-promotion credit model ("Babies Made" → recruiter, not promoter).
 */

export type ContributionPeriod = '30d' | '90d' | 'all';

// Minimal shape we need from a recruitment leadership_log row.
export interface RecruitmentLog {
  logged_by: string | null;
  related_person_id: string | null;
  logged_at: string | null;
}

export interface ContributionRow {
  tag: string;
  name: string;            // resolved display name (falls back to tag)
  engagementAttempts: number;
  recruitReplies: number;
  discordInvites: number;
  discordJoins: number;
  linkedChecked: number;
  babiesMade: number;      // cohort members who reached promoted_elder
  cohortSize: number;      // distinct persons recruited in period (conversion denominator)
  avgOnboardingDays: number | null; // mean days recruit → elder over promoted cohort, null if none
  conversion: number | null;        // babiesMade / cohortSize, null if cohort empty
}

export interface ContributionResult {
  rows: ContributionRow[];
  totals: ContributionRow;  // family totals (name = 'All leaders')
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lower time bound for a period, or null for all-time. `now` is injected for testability. */
export function periodStart(period: ContributionPeriod, now: Date): Date | null {
  if (period === 'all') return null;
  const days = period === '30d' ? 30 : 90;
  return new Date(now.getTime() - days * DAY_MS);
}

function emptyRow(tag: string, name: string): ContributionRow {
  return {
    tag, name,
    engagementAttempts: 0, recruitReplies: 0, discordInvites: 0, discordJoins: 0,
    linkedChecked: 0, babiesMade: 0, cohortSize: 0, avgOnboardingDays: null, conversion: null,
  };
}

/**
 * Compute per-leader contribution metrics.
 *
 * @param events         onboarding_events (any type). Activity metrics filter by `created_at` in
 *                       period; `promoted_elder` rows (any time) mark which persons graduated.
 * @param recruitmentLogs leadership_logs with category='recruitment' (already clan-filtered).
 * @param personsCreatedAt map person_id → persons.created_at (onboarding start baseline).
 * @param period         selected period; `now` injected for deterministic tests.
 * @param nameByTag      resolved player_tag → display name.
 */
export function computeContributions(
  events: OnboardingEvent[],
  recruitmentLogs: RecruitmentLog[],
  personsCreatedAt: Record<string, string>,
  period: ContributionPeriod,
  now: Date,
  nameByTag: Record<string, string>,
): ContributionResult {
  const start = periodStart(period, now);
  const inPeriod = (iso: string | null) => !!iso && (!start || new Date(iso) >= start);

  // Persons that have EVER reached elder, and the earliest promotion timestamp per person.
  const promotedAt = new Map<string, number>();
  for (const e of events) {
    if (e.event_type === 'promoted_elder') {
      const t = new Date(e.created_at).getTime();
      const prev = promotedAt.get(e.person_id);
      if (prev === undefined || t < prev) promotedAt.set(e.person_id, t);
    }
  }

  const rows = new Map<string, ContributionRow>();
  const ensure = (tag: string) => {
    let r = rows.get(tag);
    if (!r) { r = emptyRow(tag, nameByTag[tag] || tag); rows.set(tag, r); }
    return r;
  };

  // ---- Activity metrics: credit actor_tag, counted in-period. ----
  for (const e of events) {
    if (!e.actor_tag || !inPeriod(e.created_at)) continue;
    switch (e.event_type) {
      case 'engagement_attempt':
        ensure(e.actor_tag).engagementAttempts++;
        if (e.outcome === 'replied') ensure(e.actor_tag).recruitReplies++;
        break;
      case 'invited_discord': ensure(e.actor_tag).discordInvites++; break;
      case 'joined_discord': ensure(e.actor_tag).discordJoins++; break;
      case 'linked_accounts_checked': ensure(e.actor_tag).linkedChecked++; break;
      default: break;
    }
  }

  // ---- Outcome metrics: recruiter cohort (recruited in-period), promotion & timing. ----
  // Earliest recruitment per person decides the recruiter; only count a person once.
  const recruiterByPerson = new Map<string, { tag: string; at: number }>();
  for (const log of recruitmentLogs) {
    if (!log.logged_by || !log.related_person_id || !log.logged_at) continue;
    const at = new Date(log.logged_at).getTime();
    const prev = recruiterByPerson.get(log.related_person_id);
    if (!prev || at < prev.at) recruiterByPerson.set(log.related_person_id, { tag: log.logged_by, at });
  }

  const onboardDaysByTag = new Map<string, number[]>();
  for (const [personId, { tag, at }] of recruiterByPerson) {
    if (start && at < start.getTime()) continue; // recruited outside the period
    const r = ensure(tag);
    r.cohortSize++;
    const promoTs = promotedAt.get(personId);
    if (promoTs !== undefined) {
      r.babiesMade++;
      const createdIso = personsCreatedAt[personId];
      if (createdIso) {
        const days = (promoTs - new Date(createdIso).getTime()) / DAY_MS;
        if (days >= 0) {
          if (!onboardDaysByTag.has(tag)) onboardDaysByTag.set(tag, []);
          onboardDaysByTag.get(tag)!.push(days);
        }
      }
    }
  }

  // Finalize derived fields per leader.
  for (const r of rows.values()) {
    const days = onboardDaysByTag.get(r.tag);
    r.avgOnboardingDays = days && days.length ? days.reduce((a, b) => a + b, 0) / days.length : null;
    r.conversion = r.cohortSize > 0 ? r.babiesMade / r.cohortSize : null;
  }

  // Family totals.
  const totals = emptyRow('__all__', 'All leaders');
  const allDays: number[] = [];
  for (const [tag, days] of onboardDaysByTag) { void tag; allDays.push(...days); }
  for (const r of rows.values()) {
    totals.engagementAttempts += r.engagementAttempts;
    totals.recruitReplies += r.recruitReplies;
    totals.discordInvites += r.discordInvites;
    totals.discordJoins += r.discordJoins;
    totals.linkedChecked += r.linkedChecked;
    totals.babiesMade += r.babiesMade;
    totals.cohortSize += r.cohortSize;
  }
  totals.avgOnboardingDays = allDays.length ? allDays.reduce((a, b) => a + b, 0) / allDays.length : null;
  totals.conversion = totals.cohortSize > 0 ? totals.babiesMade / totals.cohortSize : null;

  return { rows: Array.from(rows.values()), totals };
}
