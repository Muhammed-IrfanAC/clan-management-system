/**
 * Post newly queued strike suggestions to leadership: the send half of `reviewPost.ts`.
 *
 * Called by the rule scan with only the rows that scan INSERTED (the upsert ignores duplicates), so
 * each suggestion is announced once and a re-scan never re-posts one. Fail-safe like every send: a
 * Discord failure leaves the suggestion in the dashboard queue, which is where it lived before this.
 */

import { supabase } from '@/lib/supabase';
import { destinationForClan, sendDiscordMessage } from '@/lib/discord';
import { renderReviewSuggestion } from './reviewPost';

export type QueuedSuggestion = {
  id: string;
  clan_id: string | null;
  member_name: string | null;
  player_account_tag: string | null;
  war_label: string | null;
  description: string;
  occurred_at: string | null;
};

export async function alertQueuedSuggestions(ruleName: string, rows: QueuedSuggestion[]): Promise<number> {
  if (!rows.length) return 0;
  const { data: clans } = await supabase.from('clans').select('id, display_name');
  const clanName = new Map(((clans as { id: string; display_name: string }[]) || []).map((c) => [c.id, c.display_name]));

  let posted = 0;
  for (const r of rows) {
    const message = renderReviewSuggestion({
      suggestionId: r.id,
      memberName: r.member_name,
      playerTag: r.player_account_tag,
      clanName: r.clan_id ? clanName.get(r.clan_id) ?? null : null,
      ruleName,
      warLabel: r.war_label,
      description: r.description,
      occurredAt: r.occurred_at,
    });
    if (await sendDiscordMessage(message, await destinationForClan(r.clan_id, 'leadership'))) posted++;
  }
  return posted;
}
