import { supabase } from '@/lib/supabase';
import { deriveStrikeStatus, isActive, type StrikeLevel } from './status';

/**
 * Load the per-account strike context needed to enrich a strike-issued Discord notification:
 * the account's current active-strike NUMBER (1st/2nd/3rd…), its derived colour LEVEL, and the full
 * list of active strikes to spell out in the embed. Grouped PER ACCOUNT (player_account_tag) to match
 * the rest of the strike model — an alt's strikes never count against the main.
 *
 * Call this AFTER the new strike row is inserted, so `strikeNumber` already includes it. Fail-safe:
 * any DB error resolves to the empty/clear context so a notification can still be sent.
 */
export type StrikeNotifyContext = {
  strikeNumber: number;       // this account's active strike count (i.e. "Strike N")
  level: StrikeLevel;         // green=1, orange=2, red>=3 — drives the embed colour + title emoji
  // oldest-first, for the embed's list field. `leadershipApproved` lets the embed mark trust-restored
  // strikes apart from live unresolved ones (see notifyStrikeLogged).
  activeStrikes: { issuedAt: string; label: string; leadershipApproved: boolean }[];
};

const EMPTY: StrikeNotifyContext = { strikeNumber: 0, level: 'clear', activeStrikes: [] };

type StrikeContextRow = {
  issued_at: string;
  leadership_approved: boolean;
  war_label: string | null;
  war_source: string | null;
  rule: { name: string | null } | null;
  strike_violations: { description: string | null }[] | null;
};

export async function loadStrikeNotifyContext(
  playerAccountTag: string | null | undefined,
  now: Date = new Date(),
): Promise<StrikeNotifyContext> {
  if (!playerAccountTag) return EMPTY;

  const { data, error } = await supabase
    .from('strikes')
    .select('issued_at, leadership_approved, war_label, war_source, rule:rules(name), strike_violations(description)')
    .eq('player_account_tag', playerAccountTag)
    .order('issued_at', { ascending: false });
  if (error || !data) {
    if (error) console.error('Strike notify-context load failed (non-fatal):', error);
    return EMPTY;
  }

  // PostgREST types the to-one `rule` embed as an array; at runtime it's a single object. Cast
  // through unknown so the row shape matches how we read it (r.rule?.name).
  const rows = data as unknown as StrikeContextRow[];
  const status = deriveStrikeStatus(
    rows.map((r) => ({ issuedAt: r.issued_at, leadershipApproved: r.leadership_approved })),
    now,
  );
  const activeStrikes = rows
    .filter((r) => isActive(r.issued_at, now))
    .map((r) => ({ issuedAt: r.issued_at, label: labelFor(r), leadershipApproved: r.leadership_approved }))
    .reverse(); // rows come newest-first; show the list oldest-first so numbering reads 1,2,3…

  return { strikeNumber: status.activeCount, level: status.level, activeStrikes };
}

/**
 * A short one-line REASON for a strike — mirrors the dashboard's `offenceLine`: the rule name plus
 * its folded violation descriptions ("Rule — did X; did Y"). Falls back to the war label (for a war
 * strike with no recorded detail) and finally a generic, so the line always says *why*, not just
 * *where*.
 */
function labelFor(r: StrikeContextRow): string {
  const rule = r.rule?.name?.trim();
  const detail = (r.strike_violations || [])
    .map((v) => v.description?.trim())
    .filter(Boolean)
    .join('; ');
  if (rule) return detail ? `${rule} — ${detail}` : rule;
  if (detail) return detail;
  return r.war_label || (r.war_source === 'manual' ? 'Manual strike' : 'War rule broken');
}
