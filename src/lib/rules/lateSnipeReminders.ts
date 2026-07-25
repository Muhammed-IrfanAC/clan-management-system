import { notifyBetterLateThanNever, discordUserIdForPerson, webhookUrlForClan } from '@/lib/discord';
import { loadStrikeNotifyContext } from '@/lib/strikes/notify-context';
import { supabase } from '@/lib/supabase';
import type { RuleAutomationMode } from '@/types/database';
import { clanAutomatesSource, DEFAULT_RULE_AUTOMATION_MODE } from './automationScope';
import { isLateSnipeReminderDue } from './warContext';
import { loadExemptPersonIds } from './detectors/warContextLoad';

type ReminderRule = { id: string; automation_config: Record<string, unknown> | null };

type ReminderCandidate = {
  personId: string;
  playerTag: string;
  memberName: string | null;
  clanId: string | null;
  source: 'regular' | 'cwl';
  roundId: string;
  warLabel: string;
  attacksRemaining: number;
};

type RegularRow = {
  person_id: string;
  player_tag: string;
  name: string | null;
  attacks_used: number;
  war_rounds: {
    id: string;
    clan_id: string | null;
    attacks_per_member: number | null;
    opponent_name: string | null;
    end_time: string | null;
  } | null;
};

type CwlRow = {
  person_id: string;
  player_tag: string;
  name: string | null;
  attacks_used: number;
  cwl_rounds: {
    id: string;
    clan_id: string | null;
    round_number: number;
    opponent_name: string | null;
    end_time: string | null;
  } | null;
};

/**
 * Send Better Late Than Never exactly once per account and war. This is deliberately a reminder,
 * not a provisional strike: a subsequent late attack is handled by war_late_snipe, while an unused
 * attack at war end is handled by war_missed_attack.
 */
export async function sendLateSnipeReminders(
  rule: ReminderRule,
  modeByClan: Map<string, RuleAutomationMode>,
): Promise<number> {
  const [regular, cwl] = await Promise.all([
    supabase
      .from('war_members')
      .select('person_id, player_tag, name, attacks_used, war_rounds!inner(id, clan_id, state, attacks_per_member, opponent_name, end_time)')
      .not('person_id', 'is', null)
      .eq('war_rounds.state', 'inWar'),
    supabase
      .from('cwl_war_members')
      .select('person_id, player_tag, name, attacks_used, cwl_rounds!inner(id, clan_id, state, round_number, opponent_name, end_time)')
      .not('person_id', 'is', null)
      .eq('cwl_rounds.state', 'inWar'),
  ]);
  if (regular.error) console.error('Better Late Than Never (regular) query failed:', regular.error);
  if (cwl.error) console.error('Better Late Than Never (CWL) query failed:', cwl.error);

  const config = rule.automation_config || {};
  const now = new Date();
  const candidates: ReminderCandidate[] = [];

  for (const row of (regular.data as unknown as RegularRow[]) || []) {
    const round = row.war_rounds;
    const allowed = round?.attacks_per_member ?? 2;
    const remaining = allowed - row.attacks_used;
    if (!round || remaining <= 0 || !isLateSnipeReminderDue(round.end_time, config, now)) continue;
    candidates.push({
      personId: row.person_id, playerTag: row.player_tag, memberName: row.name, clanId: round.clan_id,
      source: 'regular', roundId: round.id,
      warLabel: `Clan war${round.opponent_name ? ` vs ${round.opponent_name}` : ''}`,
      attacksRemaining: remaining,
    });
  }
  for (const row of (cwl.data as unknown as CwlRow[]) || []) {
    const round = row.cwl_rounds;
    const remaining = 1 - row.attacks_used;
    if (!round || remaining <= 0 || !isLateSnipeReminderDue(round.end_time, config, now)) continue;
    candidates.push({
      personId: row.person_id, playerTag: row.player_tag, memberName: row.name, clanId: round.clan_id,
      source: 'cwl', roundId: round.id,
      warLabel: `CWL Round ${round.round_number}${round.opponent_name ? ` vs ${round.opponent_name}` : ''}`,
      attacksRemaining: remaining,
    });
  }

  const exempt = await loadExemptPersonIds(candidates.map((c) => c.personId));
  const eligible = candidates.filter((c) => {
    if (exempt.has(c.personId)) return false;
    const mode = (c.clanId && modeByClan.get(c.clanId)) || DEFAULT_RULE_AUTOMATION_MODE;
    return clanAutomatesSource(mode, c.source);
  });
  if (!eligible.length) return 0;

  const keyed = new Map(eligible.map((c) => [reminderKey(c), c]));
  const { data: inserted, error } = await supabase
    .from('rule_reminders')
    .upsert(
      eligible.map((c) => ({
        rule_id: rule.id,
        person_id: c.personId,
        player_account_tag: c.playerTag,
        clan_id: c.clanId,
        war_source: c.source,
        war_round_id: c.roundId,
        reminder_key: reminderKey(c),
      })),
      { onConflict: 'reminder_key', ignoreDuplicates: true },
    )
    .select('reminder_key');
  if (error) {
    console.error('Better Late Than Never reminder insert failed:', error);
    return 0;
  }

  for (const row of (inserted as { reminder_key: string }[] | null) || []) {
    const candidate = keyed.get(row.reminder_key);
    if (!candidate) continue;
    try {
      const [strikeContext, webhookUrl, mentionDiscordId] = await Promise.all([
        loadStrikeNotifyContext(candidate.playerTag),
        webhookUrlForClan(candidate.clanId),
        discordUserIdForPerson(candidate.personId),
      ]);
      await notifyBetterLateThanNever({
        memberName: candidate.memberName,
        playerTag: candidate.playerTag,
        warLabel: candidate.warLabel,
        attacksRemaining: candidate.attacksRemaining,
        activeStrikeCount: strikeContext.strikeNumber,
        webhookUrl,
        mentionDiscordId,
      });
    } catch (err) {
      console.error('Better Late Than Never Discord notify failed (non-fatal):', err);
    }
  }
  return (inserted as { reminder_key: string }[] | null)?.length || 0;
}

function reminderKey(candidate: Pick<ReminderCandidate, 'source' | 'roundId' | 'playerTag'>): string {
  return `better_late_than_never:${candidate.source}:${candidate.roundId}:${candidate.playerTag}`;
}
