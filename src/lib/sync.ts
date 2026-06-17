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

    const dbAccountMap = new Map(dbAccounts.map(a => [a.player_tag, a]));
    const cocAccountTags = new Set(cocMembers.map(m => m.tag));

    // 4. Update or Insert accounts
    const upsertData = [];
    const now = new Date().toISOString();

    for (const member of cocMembers) {
      const existing = dbAccountMap.get(member.tag);
      
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
      const { error: leftError } = await supabase
        .from('player_accounts')
        .update({ status: 'left' })
        .in('player_tag', leftTags);
        
      if (leftError) throw leftError;
    }

    // 7. Auto-cleanup of long-term inactive players
    const { data: cleanupSetting } = await supabase.from('settings').select('value').eq('key', 'inactive_cleanup_days').single();
    const cleanupDays = parseInt(cleanupSetting?.value || '30');
    
    const cleanupDate = new Date();
    cleanupDate.setDate(cleanupDate.getDate() - cleanupDays);

    const { error: cleanupError } = await supabase
      .from('player_accounts')
      .delete()
      .eq('status', 'left')
      .lt('last_synced_at', cleanupDate.toISOString());
    
    if (cleanupError) console.error('Cleanup error:', cleanupError);

    return { success: true, count: upsertData.length, left: leftTags.length };

  } catch (error: any) {
    console.error(`Sync error for clan ${clanId}:`, error);
    throw error;
  }
}
