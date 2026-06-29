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
 * Immediately expire babies who have LEFT the family entirely — i.e. hold no
 * remaining active account in any family clan — instead of letting their trial
 * clock run out. A baby is a probationary new member; if they leave during the
 * trial we drop the persona at once so the registry stops listing them (a 'left'
 * account is still a linked account, so without this the baby lingers as a member).
 *
 * A baby who merely MOVES between family clans still holds an active account
 * elsewhere and is deliberately left untouched.
 *
 * IMPORTANT: only safe to run after a FULL (all-clan) sync, when every active
 * clan's roster has been reconciled in one pass. Mid-partial-sync, a mover whose
 * destination clan hasn't synced yet looks identical to a leaver (both sit at
 * status 'left'), so calling this then could wrongly delete a mover. Shares
 * expireBabies' dashboard-access guardrail.
 */
export async function expireDepartedBabies(): Promise<{ expired: number }> {
  // All current babies.
  const { data: babies, error } = await supabase
    .from('persons')
    .select('id')
    .eq('is_baby', true);
  if (error) throw error;
  if (!babies || babies.length === 0) return { expired: 0 };

  const babyIds = babies.map((b) => b.id);

  // Their accounts, so we can tell who still sits in an active family clan.
  const { data: accounts, error: acctError } = await supabase
    .from('player_accounts')
    .select('person_id, status, access_enabled')
    .in('person_id', babyIds);
  if (acctError) throw acctError;

  // Still present in the family = has at least one active account.
  const hasActive = new Set(
    (accounts || []).filter((a) => a.status === 'active').map((a) => a.person_id)
  );
  // Never auto-unlink/delete a persona that holds dashboard access — access is
  // static and removed only by a manual revoke (mirrors expireBabies).
  const hasAccess = new Set(
    (accounts || []).filter((a) => a.access_enabled).map((a) => a.person_id)
  );

  const departed = babyIds.filter((id) => !hasActive.has(id) && !hasAccess.has(id));
  if (departed.length === 0) return { expired: 0 };

  // Break the persona link (accounts fall back to Unlinked, status untouched)…
  const { error: unlinkError } = await supabase
    .from('player_accounts')
    .update({ person_id: null })
    .in('person_id', departed);
  if (unlinkError) throw unlinkError;

  // …and remove the departed baby person records.
  const { error: deleteError } = await supabase.from('persons').delete().in('id', departed);
  if (deleteError) throw deleteError;

  return { expired: departed.length };
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
 * Whether a persona exists. Notes used to be gated on the baby trial; they are now
 * available for every member (a note started during the baby phase simply carries
 * forward after promotion), so this just confirms the persona is real before insert.
 */
export async function personExists(personId: string): Promise<boolean> {
  const { data } = await supabase.from('persons').select('id').eq('id', personId).maybeSingle();
  return !!data;
}

/**
 * Add a note to a member's thread, attributed to the acting leader. Available for
 * every member regardless of baby status — baby-phase notes carry forward. Throws if
 * the persona no longer exists. Returns the inserted row.
 */
export async function addMemberNote(params: {
  personId: string;
  authorTag: string;
  body: string;
}) {
  const body = params.body?.trim();
  if (!body) throw new Error('Note body is required');
  if (!(await personExists(params.personId))) {
    throw new Error('Member not found');
  }
  const { data, error } = await supabase
    .from('member_notes')
    .insert([{ person_id: params.personId, author_tag: params.authorTag, body }])
    .select()
    .single();
  if (error) throw error;
  return data;
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
