import { supabase } from './supabase';
import { fetchFromCoC, CoCClan } from './coc-api';
import { PlayerAccount, DatabaseRole } from '@/types/database';
import { promoteBaby, logBabyAction, recruiterTagForPerson, expireDepartedBabies } from './babies';
import { addOnboardingEvent } from './onboarding';
import { syncCwlLiveState } from './cwl/live';
import { syncWarState } from './war';
import { scanRuleViolations } from './rules/scan';

export async function syncClan(clanId: string) {
  try {
    // 1. Get clan details from DB
    const { data: clan, error: clanError } = await supabase
      .from('clans')
      .select('*')
      .eq('id', clanId)
      .single();

    if (clanError || !clan) throw new Error('Clan not found in DB');

    // 2. Fetch latest roster from CoC API
    const cocClan = await fetchFromCoC<CoCClan>(`/clans/${encodeURIComponent(clan.clan_tag)}`);
    const cocMembers = cocClan.memberList;

    // 3. Get current roster from DB
    const { data: dbAccounts, error: dbError } = await supabase
      .from('player_accounts')
      .select('*')
      .eq('clan_id', clanId);

    if (dbError) throw new Error('Failed to fetch DB accounts');

    const cocAccountTags = new Set(cocMembers.map(m => m.tag));

    // 3b. Resolve existing account records GLOBALLY by player_tag.
    // player_accounts.player_tag is the global primary key (one row per tag, not per clan),
    // so a player who moves between family clans — or rejoins after leaving — keeps the SAME row.
    // Looking these up only within the current clan would miss those rows and treat the player as
    // brand new, wiping their persona link (person_id), db_role, and access. Look up by tag instead.
    const cocMemberTags = cocMembers.map(m => m.tag);
    const { data: globalAccounts } = cocMemberTags.length
      ? await supabase.from('player_accounts').select('*').in('player_tag', cocMemberTags)
      : { data: [] as PlayerAccount[] };
    const existingByTag = new Map((globalAccounts || []).map(a => [a.player_tag, a]));

    // 4. Update or Insert accounts
    const upsertData = [];
    const now = new Date().toISOString();

    // Babies auto-graduate when an in-game promotion is detected. We capture the (person_id, clan)
    // for any account whose CoC role climbs from 'member' to 'elder' or higher, then reconcile
    // against persons.is_baby AFTER the upsert (the pre-sync role is only known here, before it is
    // overwritten). Permanent members are never included — the is_baby check happens post-upsert.
    const promotionCandidates: { personId: string; clanId: string }[] = [];

    for (const member of cocMembers) {
      const existing = existingByTag.get(member.tag);

      // Determine role - only use CoC role if not already a leader/coLeader in DB
      let role: DatabaseRole = 'member';
      if (member.role === 'leader') role = 'leader';
      else if (member.role === 'coLeader') role = 'co_leader';
      else if (member.role === 'admin') role = 'elder';

      // Auto-promotion signal: an account that was 'member' last sync and now reads elder+ in game.
      if (
        existing?.person_id &&
        existing.db_role === 'member' &&
        (role === 'elder' || role === 'co_leader' || role === 'leader')
      ) {
        promotionCandidates.push({ personId: existing.person_id, clanId });
      }

      // db_role is a PURE clan-status mirror now — write the live in-game rank unconditionally.
      // Dashboard permission lives on persons.access_role and is untouched by sync, so there is no
      // longer any role to "protect" here (this replaces the old Role Protection Rule).
      upsertData.push({
        player_tag: member.tag,
        clan_id: clanId,
        in_game_name: member.name,
        th_level: member.townHallLevel,
        trophies: member.trophies,
        league: member.leagueTier?.name ?? null, // NEW Ranked tier (not legacy trophy league); normalized in the CWL layer
        donations: member.donations,
        donations_received: member.donationsReceived,
        db_role: role,
        status: 'active',
        last_synced_at: now,
        // Keep existing person_id if present
        person_id: existing?.person_id || null,
        added_at: existing?.added_at || now,
      });
    }

    // 5. Detect members who left
    const leftTags = dbAccounts
      .filter(a => !cocAccountTags.has(a.player_tag) && a.status === 'active')
      .map(a => a.player_tag);

    // 6. Execute Updates
    if (upsertData.length > 0) {
      const { error: upsertError } = await supabase
        .from('player_accounts')
        .upsert(upsertData);
      
      if (upsertError) throw upsertError;
    }

    // 6b. Auto-promote babies whose in-game role climbed to elder+. Only persons still flagged
    // is_baby are graduated; permanent members are untouched even if their CoC role reads member.
    // Non-fatal: a promotion-logging failure must never break the sync itself.
    if (promotionCandidates.length > 0) {
      try {
        const uniqueByPerson = new Map(promotionCandidates.map((c) => [c.personId, c]));
        const candidateIds = Array.from(uniqueByPerson.keys());
        const { data: babies } = await supabase
          .from('persons')
          .select('id')
          .in('id', candidateIds)
          .eq('is_baby', true);

        for (const baby of babies || []) {
          const { clanId: cId } = uniqueByPerson.get(baby.id)!;
          await promoteBaby(baby.id);
          // System-recorded graduation (the CoC API never reveals who promoted in-game).
          await addOnboardingEvent({
            personId: baby.id,
            eventType: 'promoted_elder',
            actorTag: null,
            clanId: cId,
            metadata: { source: 'sync' },
          });
          // Credit the ORIGINAL recruiter for the successful onboarding ("Babies Made").
          await logBabyAction({
            loggedBy: await recruiterTagForPerson(baby.id),
            category: 'promotion',
            personId: baby.id,
            clanId: cId,
            description: 'Auto-promoted to Elder (in-game promotion detected)',
          });
        }
      } catch (promoErr) {
        console.error('Auto-promotion during sync failed:', promoErr);
      }
    }

    if (leftTags.length > 0) {
      // Guard by clan_id so a clan only ever marks its OWN rows as 'left'. Without this,
      // a no-arg sync (all clans in parallel) races on clan movers: when a player hops
      // A -> B, syncClan(A) sees them as left and syncClan(B) upserts them active. Keyed on
      // player_tag alone, A's left-update could land after B's upsert and wrongly flip an
      // account that already moved to B back to 'left'. The clan_id filter means A's update
      // no longer matches once B has rewritten clan_id, making the outcome order-independent.
      const { error: leftError } = await supabase
        .from('player_accounts')
        .update({ status: 'left' })
        .in('player_tag', leftTags)
        .eq('clan_id', clanId);

      if (leftError) throw leftError;
    }

    // 7. Auto-cleanup of long-term inactive players
    const { data: cleanupSetting } = await supabase.from('settings').select('value').eq('key', 'inactive_cleanup_days').single();
    const cleanupDays = parseInt(cleanupSetting?.value || '30');
    
    const cleanupDate = new Date();
    cleanupDate.setDate(cleanupDate.getDate() - cleanupDays);

    // Never auto-delete an account whose PERSON holds dashboard access. Access is removed only by an
    // explicit manual revoke in Settings, so an access-holder (or their alt) must survive a 'left'
    // state past the cleanup window rather than being silently deleted. Access now lives on the
    // person, so we filter candidates against the set of access-holding person_ids before deleting.
    const { data: accessPersons } = await supabase
      .from('persons')
      .select('id')
      .not('access_role', 'is', null);
    const accessIds = new Set((accessPersons || []).map((p) => p.id));

    const { data: staleAccounts } = await supabase
      .from('player_accounts')
      .select('player_tag, person_id')
      .eq('status', 'left')
      .lt('last_synced_at', cleanupDate.toISOString());

    const deletableTags = (staleAccounts || [])
      .filter((a) => !a.person_id || !accessIds.has(a.person_id))
      .map((a) => a.player_tag);

    if (deletableTags.length > 0) {
      const { error: cleanupError } = await supabase
        .from('player_accounts')
        .delete()
        .in('player_tag', deletableTags);
      if (cleanupError) console.error('Cleanup error:', cleanupError);
    }

    return { success: true, count: upsertData.length, left: leftTags.length };

  } catch (error: any) {
    console.error(`Sync error for clan ${clanId}:`, error);
    throw error;
  }
}

/**
 * Refresh live CWL round/lineup data as part of a sync, but never let it fail the roster sync —
 * a CoC hiccup or off-season clan must not block the primary result. Returns null on any error.
 */
async function safeCwlSync() {
  try {
    return await syncCwlLiveState();
  } catch (err) {
    console.error('CWL live sync error (non-fatal):', err);
    return null;
  }
}

/**
 * Refresh live REGULAR (non-CWL) war state. Fail-safe like the CWL step — a CoC hiccup, a clan not
 * in war, or a private war log must never block the roster sync. Returns null on any error.
 */
async function safeWarSync() {
  try {
    return await syncWarState();
  } catch (err) {
    console.error('Regular war sync error (non-fatal):', err);
    return null;
  }
}

/**
 * Scan enabled automated rules for violations and auto-log any new ones. Runs AFTER the war syncs so
 * it sees fresh round/attack state. Fail-safe like the CWL step — a detector or notification error
 * must never fail the roster sync. Returns null on any error.
 */
async function safeScanViolations() {
  try {
    return await scanRuleViolations();
  } catch (err) {
    console.error('Rule-violation scan error (non-fatal):', err);
    return null;
  }
}

/**
 * The full sync flow, shared by the cookie-auth route (`/api/sync`) and the machine-auth cron
 * route (`/api/cron/sync`) so both run identical logic. Pass a `clanId` to sync one clan, or omit
 * it to reconcile every active clan, expire departed babies, and refresh CWL. Auth is the caller's
 * responsibility — this function performs no authorization.
 */
export async function runFullSync(clanId?: string) {
  if (clanId) {
    const result = await syncClan(clanId);
    const cwl = await safeCwlSync();
    const war = await safeWarSync();
    const violations = await safeScanViolations();
    return { ...result, cwl, war, violations };
  }

  const { data: clans } = await supabase.from('clans').select('id').eq('active', true);
  if (!clans) return { success: true, count: 0 };

  const results = await Promise.all(clans.map(c => syncClan(c.id)));

  // Every active clan is now reconciled in this single pass, so a baby with no active account
  // anywhere has genuinely left the family (not just moved between clans). Drop those personas
  // immediately rather than waiting out the trial.
  const { expired: departedBabies } = await expireDepartedBabies();
  const cwl = await safeCwlSync();
  const war = await safeWarSync();
  const violations = await safeScanViolations();

  return {
    success: true,
    clansSynced: results.length,
    totalUpdated: results.reduce((acc, r) => acc + r.count, 0),
    departedBabies,
    cwl,
    war,
    violations,
  };
}
