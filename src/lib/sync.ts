import { supabase } from './supabase';
import { fetchFromCoC, CoCClan } from './coc-api';
import { PlayerAccount, DatabaseRole } from '@/types/database';
import { syncCwlLiveState } from './cwl/live';
import { detectCompletedTransfers } from './cwl/roster';
import { syncWarState } from './war';
import { scanRuleViolations } from './rules/scan';
import { alertKickedArrivals } from './kicks/arrivals';
import type { ClanArrival } from './kicks/watch';

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

    return { success: true, count: upsertData.length, left: leftTags.length, arrivals };

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
 * it to reconcile every active clan and refresh CWL. Auth is the caller's
 * responsibility — this function performs no authorization.
 */
export async function runFullSync(clanId?: string) {
  if (clanId) {
    const { arrivals, ...result } = await syncClan(clanId);
    const transfers = await safeDetectTransfers();
    const kickList = await safeAlertKickedArrivals(arrivals);
    const cwl = await safeCwlSync();
    const war = await safeWarSync();
    const violations = await safeScanViolations();
    return { ...result, transfers, kickList, cwl, war, violations };
  }

  const { data: clans } = await supabase.from('clans').select('id').eq('active', true);
  if (!clans) return { success: true, count: 0 };

  const results = await Promise.all(clans.map(c => syncClan(c.id)));

  const transfers = await safeDetectTransfers();
  const kickList = await safeAlertKickedArrivals(results.flatMap((r) => r.arrivals));
  const cwl = await safeCwlSync();
  const war = await safeWarSync();
  const violations = await safeScanViolations();

  return {
    success: true,
    clansSynced: results.length,
    totalUpdated: results.reduce((acc, r) => acc + r.count, 0),
    transfers,
    kickList,
    cwl,
    war,
    violations,
  };
}
