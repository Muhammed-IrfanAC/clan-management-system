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

  const ids = expired.map((p) => p.id);

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
