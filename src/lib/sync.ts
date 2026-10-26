import { supabase } from './supabase';
import { fetchFromCoC, CoCClan } from './coc-api';
import { PlayerAccount, DatabaseRole } from '@/types/database';
import { syncCwlLiveState } from './cwl/live';
import { detectCompletedTransfers } from './cwl/roster';
import { syncWarState } from './war';
import { scanRuleViolations } from './rules/scan';
import { alertKickedArrivals } from './kicks/arrivals';
import { alertUnlinkedArrivals, settleUnlinkedJoinAlerts } from './unlinked/joinAlert';
import { syncTownHallRoles } from './members/thRoleSync';
import { postWeeklyStats } from './warStats/weeklyPost';
import type { ClanArrival } from './kicks/watch';

/**
 * How long a sync may run before it stops starting new work. Both sync routes allow 60s; the margin is
 * for the response and for a step already under way when the deadline passes.
 */
const SYNC_DEADLINE_MS = 50_000;
/** A lease older than this belongs to a sync whose function was killed — take it over. */
const LEASE_STALE_MS = 2 * 60 * 1000;

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
    if (!Array.isArray(cocMembers)) throw new Error(`CoC returned no member list for ${clan.clan_tag}`);

    // 3. Get current roster from DB
    const { data: dbAccounts, error: dbError } = await supabase
      .from('player_accounts')
      .select('*')
      .eq('clan_id', clanId);

    if (dbError) throw new Error('Failed to fetch DB accounts');

    // A clan with zero members does not exist in game (it is disbanded), so an empty list for a clan
    // we hold active members of is a bad read, not a mass departure. Applying it would mark the whole
    // roster 'left' — and start their cleanup clocks.
    if (cocMembers.length === 0 && dbAccounts.some((a) => a.status === 'active')) {
      throw new Error(`Refusing to apply an empty roster for ${clan.clan_tag}`);
    }

    const cocAccountTags = new Set(cocMembers.map(m => m.tag));

    // 3b. Resolve existing account records GLOBALLY by player_tag.
    // player_accounts.player_tag is the global primary key (one row per tag, not per clan),
    // so a player who moves between family clans — or rejoins after leaving — keeps the SAME row.
    // Looking these up only within the current clan would miss those rows and treat the player as
    // brand new, wiping their persona link (person_id), db_role, and access. Look up by tag instead.
    //
    // This read's error MUST abort the sync. On 2026-09-14 it failed without being checked, every
    // member looked brand new, and the upsert below wrote person_id = NULL over each clan's whole
    // roster — orphaning nearly every person in the registry.
    const cocMemberTags = cocMembers.map(m => m.tag);
    const { data: globalAccounts, error: globalError } = cocMemberTags.length
      ? await supabase.from('player_accounts').select('*').in('player_tag', cocMemberTags)
      : { data: [] as PlayerAccount[], error: null };
    if (globalError) throw new Error(`Failed to look up existing accounts: ${globalError.message}`);
    const existingByTag = new Map((globalAccounts || []).map(a => [a.player_tag, a]));

    // 4. Update or Insert accounts
    const upsertData = [];
    const newAccounts: { player_tag: string; clan_id: string; person_id: null; added_at: string; status: 'active' }[] = [];
    const arrivals: ClanArrival[] = [];
    const now = new Date().toISOString();

    for (const member of cocMembers) {
      const existing = existingByTag.get(member.tag);

      // An ARRIVAL: a member this clan did not have as an active member before this pass — new to us,
      // back from 'left' / 'inactive', or moved over from another family clan. Exactly one pass sees
      // each join (the next finds them active here), which is what the kick-list watch relies on.
      if (!existing || existing.status !== 'active' || existing.clan_id !== clanId) {
        arrivals.push({ tag: member.tag, clanId });
      }

      // Determine role - only use CoC role if not already a leader/coLeader in DB
      let role: DatabaseRole = 'member';
      if (member.role === 'leader') role = 'leader';
      else if (member.role === 'coLeader') role = 'co_leader';
      else if (member.role === 'admin') role = 'elder';

      if (!existing) {
        newAccounts.push({ player_tag: member.tag, clan_id: clanId, person_id: null, added_at: now, status: 'active' });
      }

      // db_role is a PURE clan-status mirror now — write the live in-game rank unconditionally.
      // Dashboard permission lives on persons.access_role and is untouched by sync, so there is no
      // longer any role to "protect" here (this replaces the old Role Protection Rule).
      //
      // person_id and added_at are deliberately NOT in this payload. Sync mirrors the game; the
      // person link is a leader's decision and sync has no business writing it — not even "back" to
      // the value it just read, since a stale or empty read would then clobber the real one.
      upsertData.push({
        player_tag: member.tag,
        clan_id: clanId,
        in_game_name: member.name,
        th_level: member.townHallLevel,
        trophies: member.trophies,
        // NEW Ranked tier (not the legacy trophy league). Both halves are stored: the id pins the
        // exact sub-division (Dragon 28 vs 30) that CWL eligibility gates on, the name stays for
        // display and as the fallback when a row predates the id column. See cwl/leagues.ts.
        league: member.leagueTier?.name ?? null,
        league_tier_id: member.leagueTier?.id ?? null,
        donations: member.donations,
        donations_received: member.donationsReceived,
        db_role: role,
        status: 'active',
        last_synced_at: now,
      });
    }

    // 5. Detect members who left
    const leftTags = dbAccounts
      .filter(a => !cocAccountTags.has(a.player_tag) && a.status === 'active')
      .map(a => a.player_tag);

    // 6. Execute Updates
    // New accounts first, as insert-if-absent: if the lookup above somehow missed a row that does
    // exist, ignoreDuplicates leaves it untouched instead of resetting its link and added_at.
    if (newAccounts.length > 0) {
      const { error: insertError } = await supabase
        .from('player_accounts')
        .upsert(newAccounts, { onConflict: 'player_tag', ignoreDuplicates: true });
      if (insertError) throw insertError;
    }

    if (upsertData.length > 0) {
      const { error: upsertError } = await supabase
        .from('player_accounts')
        .upsert(upsertData);
      
      if (upsertError) throw upsertError;
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

    // 7. Retire long-departed accounts. An account gone from every family clan for longer than the
    // window is marked 'inactive' — hidden from the registry and every roster list — but never deleted.
    // The row is what keeps a player's person link, strikes and kick-list entry attached, so someone
    // who comes back on any of their accounts is still recognised; the upsert above reactivates it.
    // This replaces a hard delete, which needed guards for access-holders and live strikes and still
    // failed whole batches on legacy warning FKs — none of that applies to an update.
    const { data: cleanupSetting } = await supabase.from('settings').select('value').eq('key', 'inactive_cleanup_days').single();
    const cleanupDays = parseInt(cleanupSetting?.value || '30');

    const cleanupDate = new Date();
    cleanupDate.setDate(cleanupDate.getDate() - cleanupDays);

    const { error: retireError } = await supabase
      .from('player_accounts')
      .update({ status: 'inactive' })
      .eq('status', 'left')
      .lt('last_synced_at', cleanupDate.toISOString());
    if (retireError) console.error('Inactive marking error:', retireError);

    // A clan's FIRST sync makes every member an arrival. The kick watch still wants to see them, but
    // the unlinked-join alert must not ping leadership with a whole newly added roster.
    return { success: true, count: upsertData.length, left: leftTags.length, arrivals, firstSync: dbAccounts.length === 0 };

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
 * Confirm CWL transfers that have actually happened in game (and reopen ones that came undone).
 * Runs AFTER every clan is reconciled, because a move is only visible once the DESTINATION clan has
 * been polled — running it per clan would flip a mover to 'done' or back depending on sync order.
 * Fail-safe like the other post-roster steps. Returns null on any error.
 */
async function safeDetectTransfers() {
  try {
    return await detectCompletedTransfers();
  } catch (err) {
    console.error('CWL transfer detection error (non-fatal):', err);
    return null;
  }
}

/**
 * Alert leadership when an account on the kick list (or an alt of one) joins a family clan. Runs AFTER
 * every clan is reconciled so the watch reads settled person links. Fail-safe like the other
 * post-roster steps — a Discord or lookup error must never fail the roster sync. Returns null on any
 * error.
 */
async function safeAlertKickedArrivals(arrivals: ClanArrival[]) {
  try {
    return await alertKickedArrivals(arrivals);
  } catch (err) {
    console.error('Kick-list arrival alert error (non-fatal):', err);
    return null;
  }
}

/**
 * Ping the Leadership role when a player with no linked person joins a family clan, after first
 * settling earlier alerts whose joiners have since left, moved or been linked. Runs AFTER every clan
 * is reconciled, like the kick watch. Fail-safe — a Discord or lookup error must never fail the
 * roster sync, and one half failing never costs the other. Each half is null on error.
 */
async function safeAlertUnlinkedArrivals(arrivals: ClanArrival[]) {
  let settled: Awaited<ReturnType<typeof settleUnlinkedJoinAlerts>> | null = null;
  try {
    settled = await settleUnlinkedJoinAlerts();
  } catch (err) {
    console.error('Unlinked-join alert settle error (non-fatal):', err);
  }
  try {
    return { ...(await alertUnlinkedArrivals(arrivals)), settled: settled?.settled ?? null };
  } catch (err) {
    console.error('Unlinked-join alert error (non-fatal):', err);
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
 * Keep the family Discord's TH roles in step with the accounts — at most one finished pass a day
 * (`members/thRoleSync.ts` gates itself). Runs last, after the roster is settled. Fail-safe like the
 * other post-roster steps. Returns null on any error.
 */
async function safeSyncTownHallRoles(syncStartedAt: number) {
  try {
    return await syncTownHallRoles({ deadline: syncStartedAt + SYNC_DEADLINE_MS });
  } catch (err) {
    console.error('TH role sync error (non-fatal):', err);
    return null;
  }
}

/**
 * The weekly stats post, once per clan after each Ranked League week ends (`warStats/weeklyPost.ts`
 * gates itself to the day after the Monday reset and stamps each clan it posts). Runs after the war
 * ingestion so the report includes the latest ended war. Fail-safe. Returns null on any error.
 */
async function safePostWeeklyStats(syncStartedAt: number) {
  try {
    return await postWeeklyStats({ deadline: syncStartedAt + SYNC_DEADLINE_MS });
  } catch (err) {
    console.error('Weekly stats post error (non-fatal):', err);
    return null;
  }
}

/**
 * Everything that runs once the rosters are reconciled, staged by what each step reads. The transfer
 * check and the two arrival alerts are independent of one another; CWL and regular war ingestion are
 * independent of one another but wait for the transfer check, because CWL's signup sync settles the
 * same pending transfers; and the rule scan reads what both war steps wrote. Every step is fail-safe.
 */
async function runPostRosterSteps(arrivals: ClanArrival[], unlinkedArrivals: ClanArrival[]) {
  const [transfers, kickList, unlinked] = await Promise.all([
    safeDetectTransfers(),
    safeAlertKickedArrivals(arrivals),
    safeAlertUnlinkedArrivals(unlinkedArrivals),
  ]);
  const [cwl, war] = await Promise.all([safeCwlSync(), safeWarSync()]);
  const violations = await safeScanViolations();
  return { transfers, kickList, unlinked, cwl, war, violations };
}

/**
 * The full sync flow, shared by the cookie-auth route (`/api/sync`) and the machine-auth cron
 * route (`/api/cron/sync`) so both run identical logic. Pass a `clanId` to sync one clan, or omit
 * it to reconcile every active clan and refresh CWL. Auth is the caller's
 * responsibility — this function performs no authorization.
 */
export async function runFullSync(clanId?: string) {
  const lease = await claimSyncLease();
  if (lease === 'held') return { success: true, skipped: 'another sync is running' };
  try {
    return await runSyncPass(clanId);
  } finally {
    if (lease === 'claimed') await releaseSyncLease();
  }
}

/**
 * Claim the single-row `sync_lease` (migration 044) so the cron and a dashboard sync cannot run the
 * pipeline at the same time — doubling every CoC and Discord call, and racing the once-per-round
 * lineup notice into posting twice. The read only happens when the claim fails, to tell a held lease
 * from a missing row; with no row (migration not applied) the sync runs unguarded rather than never.
 */
async function claimSyncLease(): Promise<'claimed' | 'held' | 'unguarded'> {
  const now = Date.now();
  const { data: claimed, error } = await supabase
    .from('sync_lease')
    .update({ claimed_at: new Date(now).toISOString() })
    .eq('id', true)
    .lt('claimed_at', new Date(now - LEASE_STALE_MS).toISOString())
    .select('id');
  if (error) {
    console.error('Sync lease claim failed (running unguarded):', error);
    return 'unguarded';
  }
  if (claimed?.length) return 'claimed';
  const { data: row } = await supabase.from('sync_lease').select('id').eq('id', true).maybeSingle();
  return row ? 'held' : 'unguarded';
}

async function releaseSyncLease() {
  const { error } = await supabase.from('sync_lease').update({ claimed_at: new Date(0).toISOString() }).eq('id', true);
  if (error) console.error('Sync lease release failed (expires on its own):', error);
}

async function runSyncPass(clanId?: string) {
  const syncStartedAt = Date.now();
  if (clanId) {
    const { arrivals, firstSync, ...result } = await syncClan(clanId);
    const steps = await runPostRosterSteps(arrivals, firstSync ? [] : arrivals);
    return { ...result, ...steps };
  }

  const { data: clans } = await supabase.from('clans').select('id').eq('active', true);
  if (!clans) return { success: true, count: 0 };

  const results = await Promise.all(clans.map(c => syncClan(c.id)));

  const steps = await runPostRosterSteps(
    results.flatMap((r) => r.arrivals),
    results.flatMap((r) => (r.firstSync ? [] : r.arrivals)),
  );
  const thRoles = await safeSyncTownHallRoles(syncStartedAt);
  const weeklyStats = await safePostWeeklyStats(syncStartedAt);

  return {
    success: true,
    clansSynced: results.length,
    totalUpdated: results.reduce((acc, r) => acc + r.count, 0),
    ...steps,
    thRoles,
    weeklyStats,
  };
}
