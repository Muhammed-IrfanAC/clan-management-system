import { supabase } from './supabase';

const DEFAULT_TRIAL_DAYS = 4;

/**
 * Read the configurable baby trial window (in days) from settings.
 * Falls back to DEFAULT_TRIAL_DAYS if the setting is missing or malformed.
 */
export async function getBabyTrialDays(): Promise<number> {
  const { data } = await supabase.from('settings').select('value').eq('key', 'baby_trial_days').single();
  const parsed = parseInt(String(data?.value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TRIAL_DAYS;
}

/**
 * Pure helper (safe on the client): whole days remaining in a baby's trial.
 * Returns a value that can be <= 0 when the window has elapsed.
 */
export function babyDaysLeft(babyStartedAt: string | null, trialDays: number): number {
  if (!babyStartedAt) return trialDays;
  const expiresAt = new Date(babyStartedAt).getTime() + trialDays * 24 * 60 * 60 * 1000;
  return Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
}

/**
 * Sweep babies whose trial window has elapsed: break their account links
 * (returning the accounts to the Unlinked pool) and delete the person records.
 * Idempotent — safe to call on every dashboard / registry load.
 */
export async function expireBabies(): Promise<{ expired: number }> {
  const trialDays = await getBabyTrialDays();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - trialDays);

  const { data: expired, error } = await supabase
    .from('persons')
    .select('id')
    .eq('is_baby', true)
    .lt('baby_started_at', cutoff.toISOString());

  if (error) throw error;
  if (!expired || expired.length === 0) return { expired: 0 };

  let ids = expired.map((p) => p.id);

  // Guardrail: never auto-unlink or auto-delete a person that holds dashboard access.
  // Access (player_accounts.access_enabled) is deliberately static — it can only be revoked
  // manually in Settings, and must survive clan moves, role changes, and (here) a lapsed baby
  // trial. If a leader granted a baby account access mid-trial, leave that persona untouched.
  const { data: protectedAccounts, error: protectedError } = await supabase
    .from('player_accounts')
    .select('person_id')
    .in('person_id', ids)
    .eq('access_enabled', true);
  if (protectedError) throw protectedError;

  const protectedIds = new Set((protectedAccounts || []).map((a) => a.person_id));
  if (protectedIds.size > 0) ids = ids.filter((id) => !protectedIds.has(id));
  if (ids.length === 0) return { expired: 0 };

  // Break the persona link → accounts fall back to Unlinked (status untouched).
  const { error: unlinkError } = await supabase
    .from('player_accounts')
    .update({ person_id: null })
    .in('person_id', ids);
  if (unlinkError) throw unlinkError;

  // Remove the lapsed baby person records.
  const { error: deleteError } = await supabase.from('persons').delete().in('id', ids);
  if (deleteError) throw deleteError;

  return { expired: ids.length };
}

/**
 * Resolve a representative clan for a person (used to attribute a leadership log
 * to the right clan so clan-filtered graphs include it). Returns null if none.
 */
export async function clanIdForPerson(personId: string): Promise<string | null> {
  const { data } = await supabase
    .from('player_accounts')
    .select('clan_id')
    .eq('person_id', personId)
    .limit(1)
    .maybeSingle();
  return data?.clan_id ?? null;
}

/**
 * Record a baby lifecycle action as a leadership_log, attributed to the acting
 * leader's player_tag. This feeds the Leadership Performance graph (which counts
 * leadership_logs by logged_by) and the Activity feed. Non-fatal: a logging
 * failure must never break the underlying link/promote action.
 */
export async function logBabyAction(params: {
  loggedBy: string | null | undefined;
  category: 'recruitment' | 'promotion';
  personId: string | null;
  clanId: string | null;
  description: string;
}) {
  if (!params.loggedBy) return;
  const { error } = await supabase.from('leadership_logs').insert([{
    logged_by: params.loggedBy,
    category: params.category,
    related_person_id: params.personId,
    clan_id: params.clanId,
    description: params.description,
  }]);
  if (error) console.error('Failed to log baby action:', error);
}

/**
 * Promote a baby to a permanent member: clears the baby flag and the countdown.
 */
export async function promoteBaby(personId: string) {
  const { data, error } = await supabase
    .from('persons')
    .update({ is_baby: false, baby_started_at: null })
    .eq('id', personId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
