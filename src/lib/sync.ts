import { supabase } from './supabase';
import { fetchFromCoC, CoCClan } from './coc-api';
import { PlayerAccount, DatabaseRole } from '@/types/database';

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

    for (const member of cocMembers) {
      const existing = existingByTag.get(member.tag);
      
      // Determine role - only use CoC role if not already a leader/coLeader in DB
      let role: DatabaseRole = 'member';
      if (member.role === 'leader') role = 'leader';
      else if (member.role === 'coLeader') role = 'co_leader';
      else if (member.role === 'admin') role = 'elder';

      // Role Protection Rule: Sync never overwrites leadership table roles
      const finalRole = (existing && ['leader', 'co_leader'].includes(existing.db_role)) 
        ? existing.db_role 
        : role;

      upsertData.push({
        player_tag: member.tag,
        clan_id: clanId,
        in_game_name: member.name,
        th_level: member.townHallLevel,
        trophies: member.trophies,
        donations: member.donations,
        donations_received: member.donationsReceived,
        db_role: finalRole,
        status: 'active',
        last_synced_at: now,
        // Keep existing person_id if present
        person_id: existing?.person_id || null,
        access_enabled: existing?.access_enabled ?? (finalRole === 'leader' || finalRole === 'co_leader'),
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

    // Never auto-delete accounts that hold dashboard access (registered leaders/co-leaders).
    // Their access must only be removed by an explicit manual revoke in Settings (which sets
    // access_enabled = false), guaranteeing they cannot lose access just by hopping between
    // family clans or sitting in 'left' state past the cleanup window.
    const { error: cleanupError } = await supabase
      .from('player_accounts')
      .delete()
      .eq('status', 'left')
      .eq('access_enabled', false)
      .lt('last_synced_at', cleanupDate.toISOString());
    
    if (cleanupError) console.error('Cleanup error:', cleanupError);

    return { success: true, count: upsertData.length, left: leftTags.length };

  } catch (error: any) {
    console.error(`Sync error for clan ${clanId}:`, error);
    throw error;
  }
}
