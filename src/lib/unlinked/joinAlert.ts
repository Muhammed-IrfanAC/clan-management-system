/**
 * The sync step that tells leadership an unlinked player joined: DB/send half of `joinPost.ts`.
 *
 * Fed the same per-pass ARRIVALS as the kick-list watch, so each join is posted exactly once with no
 * "already alerted" state. Runs after every clan is reconciled, reading the accounts fresh, so an
 * account sync just created (person_id NULL) is seen as the unlinked account it is.
 *
 * Every alert sent is recorded in `unlinked_join_alerts` (migration 040), one row per joiner, so the
 * NEXT syncs can settle it: `settleUnlinkedJoinAlerts` re-reads each open joiner's account and stamps
 * the ones who left, moved clan or were linked elsewhere onto the alert, through the bot.
 */

import { supabase } from '@/lib/supabase';
import { discordBotRequest, destinationForClan, postDiscordMessage, type DiscordMessage } from '@/lib/discord';
import type { ClanArrival } from '@/lib/kicks/watch';
import {
  joinOutcome,
  outcomeLine,
  renderUnlinkedJoins,
  selectUnlinkedJoins,
  settleAlert,
  type JoinerNow,
  type OpenAlertEntry,
  type SettledJoiner,
  type UnlinkedAccount,
} from './joinPost';

/**
 * How long an alert is kept up to date. Past this it has scrolled out of anybody's reading, and an
 * alert that cannot be edited (deleted by hand, bot lost access) stops costing a request per sync.
 */
const SETTLE_WINDOW_DAYS = 30;

export async function alertUnlinkedArrivals(arrivals: ClanArrival[]): Promise<{ matched: number; alerted: number }> {
  if (!arrivals.length) return { matched: 0, alerted: 0 };
  const tags = [...new Set(arrivals.map((a) => a.tag))];

  const { data, error } = await supabase
    .from('player_accounts')
    .select('player_tag, person_id, in_game_name, th_level')
    .in('player_tag', tags);
  if (error) throw error;
  const accounts = new Map(((data as UnlinkedAccount[]) || []).map((a) => [a.player_tag, a]));

  const { data: kicked, error: kickedError } = await supabase
    .from('kicked_accounts')
    .select('player_tag')
    .in('player_tag', tags);
  if (kickedError) throw kickedError;
  const kickedTags = new Set(((kicked as { player_tag: string }[]) || []).map((k) => k.player_tag));

  const byClan = selectUnlinkedJoins(arrivals, accounts, kickedTags);
  if (!byClan.size) return { matched: 0, alerted: 0 };

  const { data: clans, error: clansError } = await supabase.from('clans').select('id, display_name');
  if (clansError) throw clansError;
  const clanName = new Map(((clans as { id: string; display_name: string }[]) || []).map((c) => [c.id, c.display_name]));

  let matched = 0;
  let alerted = 0;
  for (const [clanId, joiners] of byClan) {
    matched += joiners.length;
    const message = renderUnlinkedJoins(clanName.get(clanId) || 'a family clan', joiners);
    const posted = await postDiscordMessage(message, await destinationForClan(clanId, 'unlinked'));
    if (!posted) continue;
    alerted += joiners.length;
    // Without this row the alert still stands, it just will not be corrected later — so a failed write
    // is logged rather than allowed to cost the remaining clans their alerts.
    const { error: recordError } = await supabase.from('unlinked_join_alerts').insert(
      joiners.map((j) => ({ message_id: posted.messageId, channel_id: posted.channelId, player_tag: j.tag, clan_id: clanId })),
    );
    if (recordError) console.error('Unlinked-join alert not recorded (it will not be settled):', recordError);
  }
  return { matched, alerted };
}

/**
 * Stamp the joiners of open alerts who need nothing more: left, moved to another family clan, linked
 * outside the alert, or removed. Reads every account fresh, so it runs after every clan is reconciled
 * and judges each joiner by where they are now rather than by what this pass happened to poll.
 *
 * A row is closed only once its alert has been edited. An alert that cannot be read or edited right
 * now (a Discord hiccup, no bot token) is retried on the next sync, until it ages out of the window.
 */
export async function settleUnlinkedJoinAlerts(): Promise<{ settled: number }> {
  const since = new Date(Date.now() - SETTLE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('unlinked_join_alerts')
    .select('message_id, channel_id, player_tag, clan_id')
    .is('closed_at', null)
    .gte('posted_at', since);
  if (error) throw error;
  const open = (data as OpenAlertEntry[]) || [];
  if (!open.length) return { settled: 0 };

  const { data: accountRows, error: accountsError } = await supabase
    .from('player_accounts')
    .select('player_tag, person_id, status, clan_id, in_game_name')
    .in('player_tag', [...new Set(open.map((e) => e.player_tag))]);
  if (accountsError) throw accountsError;
  const accounts = new Map(((accountRows as JoinerNow[]) || []).map((a) => [a.player_tag, a]));

  const byMessage = new Map<string, { channelId: string; settled: SettledJoiner[] }>();
  for (const entry of open) {
    const outcome = joinOutcome(entry, accounts.get(entry.player_tag));
    if (!outcome) continue;
    const m = byMessage.get(entry.message_id) ?? { channelId: entry.channel_id, settled: [] };
    m.settled.push({ tag: entry.player_tag, outcome });
    byMessage.set(entry.message_id, m);
  }
  if (!byMessage.size) return { settled: 0 };

  const all = [...byMessage.values()].flatMap((m) => m.settled);
  const clanIds = all.flatMap((s) => (s.outcome.kind === 'moved' ? [s.outcome.toClanId] : []));
  const personIds = all.flatMap((s) => (s.outcome.kind === 'linked' ? [s.outcome.personId] : []));
  const [clanName, personName] = await Promise.all([
    displayNames('clans', clanIds),
    displayNames('persons', personIds),
  ]);
  const names = { clan: (id: string) => clanName.get(id) || 'another clan', person: (id: string) => personName.get(id) || 'someone' };
  const now = new Date().toISOString();

  let settled = 0;
  for (const [messageId, m] of byMessage) {
    const path = `/channels/${m.channelId}/messages/${encodeURIComponent(messageId)}`;
    const alert = (await discordBotRequest('GET', path)) as DiscordMessage | null;
    if (!alert) continue;
    const reply = settleAlert(alert, m.settled, (s) => outcomeLine(s.tag, s.outcome, names, now));
    if (reply) {
      const { content, embeds, components, allowed_mentions } = reply;
      if (!(await discordBotRequest('PATCH', path, { content, embeds, components, allowed_mentions }))) continue;
    }
    const { error: closeError } = await supabase
      .from('unlinked_join_alerts')
      .update({ closed_at: now })
      .eq('message_id', messageId)
      .in('player_tag', m.settled.map((s) => s.tag));
    if (closeError) throw closeError;
    settled += m.settled.length;
  }
  return { settled };
}

async function displayNames(table: 'clans' | 'persons', ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from(table).select('id, display_name').in('id', [...new Set(ids)]);
  if (error) throw error;
  return new Map(((data as { id: string; display_name: string }[]) || []).map((r) => [r.id, r.display_name]));
}
