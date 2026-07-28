import { supabase } from '@/lib/supabase';
import {
  discordIdsForAccountTags,
  postOrEditDiscordMessage,
  webhookUrlForClan,
  type DiscordMessage,
} from '@/lib/discord';
import { normalizeLeagueTier } from './leagues';
import {
  renderClanRoster,
  renderLeadershipDigest,
  renderTransferCall,
  type RosterEntry,
  type TransferMove,
} from './rosterPost';

/**
 * The DB/send half of "post the roster to Discord" — `rosterPost.ts` holds the pure renderers.
 *
 * Two entry points a caller cares about:
 *   - `renderSeasonPosts` builds every message and sends nothing. It is what the dashboard previews,
 *     so what a leader approves in the modal is byte-for-byte what gets posted.
 *   - `postSeasonRoster` / `postTransferCall` send them.
 *
 * The clan rosters and the digest are LIVING messages: posted once, then edited in place on every
 * subsequent call (migration 028 stores the message ids). Re-posting is the wrong shape for a roster —
 * it leaves a channel holding several contradictory versions with no way to tell which is current.
 * The transfer call is the deliberate exception: it is a ping asking people to act, and an edit does
 * not re-notify anyone, so it is sent fresh and only ever automatically once per season.
 *
 * Send failures are collected, never thrown — one clan's dead webhook must not stop the other clans
 * from getting their roster. DB failures DO throw, because a caller that cannot read the season has
 * nothing to post and should say so.
 */

type AllocationRow = {
  player_account_tag: string;
  recommended_clan_id: string | null;
  is_bench: boolean;
  rank: number | null;
  account: { in_game_name: string | null; th_level: number | null; league: string | null; league_tier_id: number | null } | null;
};

type TransferRow = {
  from_clan_id: string | null;
  to_clan_id: string | null;
  allocation: { player_account_tag: string; account: { in_game_name: string | null } | null } | null;
};

type SeasonClanRow = { clan_id: string; war_size: number; priority: number | null; roster_message_id: string | null };

export interface SeasonPosts {
  seasonLabel: string;
  /** One per participating clan, in fill-priority order. */
  clans: { clanId: string; clanName: string; message: DiscordMessage; messageId: string | null }[];
  digest: DiscordMessage;
  digestMessageId: string | null;
  transferCall: DiscordMessage;
  pendingMoves: number;
  transferCallPostedAt: string | null;
}

/**
 * Build every message for a season without sending anything. Shared by the preview endpoint and by
 * the senders below, which is the whole reason the renderers are pure.
 */
export async function renderSeasonPosts(seasonId: string): Promise<SeasonPosts> {
  const { data: season, error: seasonErr } = await supabase
    .from('cwl_seasons')
    .select('id, label, digest_message_id, transfer_call_posted_at')
    .eq('id', seasonId)
    .single();
  if (seasonErr) throw seasonErr;

  const [{ data: clanRows, error: clanErr }, { data: allocRows, error: allocErr }, { data: transferRows, error: transferErr }] =
    await Promise.all([
      supabase
        .from('cwl_season_clans')
        .select('clan_id, war_size, priority, roster_message_id')
        .eq('season_id', seasonId),
      supabase
        .from('cwl_allocations')
        .select('player_account_tag, recommended_clan_id, is_bench, rank, account:player_accounts(in_game_name, th_level, league, league_tier_id)')
        .eq('season_id', seasonId)
        .neq('status', 'removed'),
      supabase
        .from('cwl_transfers')
        .select('from_clan_id, to_clan_id, allocation:cwl_allocations!inner(season_id, player_account_tag, account:player_accounts(in_game_name))')
        .eq('allocation.season_id', seasonId)
        .eq('status', 'pending'),
    ]);
  if (clanErr) throw clanErr;
  if (allocErr) throw allocErr;
  if (transferErr) throw transferErr;

  const seasonClans = ((clanRows as SeasonClanRow[]) || [])
    .slice()
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const transfers = (transferRows as unknown as TransferRow[]) || [];
  // Names for every clan the messages can mention — including a FROM clan outside the season, which
  // is common: a player sitting in a non-participating clan still has to move out of it by name.
  const clanNames = await loadClanNames([
    ...seasonClans.map((c) => c.clan_id),
    ...transfers.flatMap((t) => [t.from_clan_id, t.to_clan_id]).filter((id): id is string => !!id),
  ]);
  const allocations = (allocRows as unknown as AllocationRow[]) || [];

  const byClan = new Map<string, RosterEntry[]>();
  let unassigned = 0;
  for (const a of allocations) {
    if (!a.recommended_clan_id) {
      unassigned += 1; // eligible, but the waterfall ran out of slots before reaching them
      continue;
    }
    const list = byClan.get(a.recommended_clan_id) || [];
    list.push({
      playerTag: a.player_account_tag,
      name: a.account?.in_game_name || a.player_account_tag,
      thLevel: a.account?.th_level ?? 0,
      leagueTier: normalizeLeagueTier(a.account?.league ?? null, a.account?.league_tier_id ?? null),
      isBench: !!a.is_bench,
      rank: a.rank,
    });
    byClan.set(a.recommended_clan_id, list);
  }

  const moves = await buildMoves(transfers, clanNames);

  const clans = seasonClans.map((c) => {
    const entries = byClan.get(c.clan_id) || [];
    const clanName = clanNames.get(c.clan_id) || 'Clan';
    return {
      clanId: c.clan_id,
      clanName,
      messageId: c.roster_message_id,
      message: renderClanRoster({
        seasonLabel: season.label,
        clanName,
        warSize: c.war_size || 15,
        entries,
      }),
    };
  });

  const digest = renderLeadershipDigest({
    seasonLabel: season.label,
    clans: seasonClans.map((c) => {
      const entries = byClan.get(c.clan_id) || [];
      return {
        clanName: clanNames.get(c.clan_id) || 'Clan',
        warSize: c.war_size || 15,
        lineupCount: entries.filter((e) => !e.isBench).length,
        benchCount: entries.filter((e) => e.isBench).length,
      };
    }),
    unassigned,
    pendingMoves: moves.length,
  });

  return {
    seasonLabel: season.label,
    clans,
    digest,
    digestMessageId: season.digest_message_id,
    transferCall: renderTransferCall({ seasonLabel: season.label, moves }),
    pendingMoves: moves.length,
    transferCallPostedAt: season.transfer_call_posted_at,
  };
}

export interface PostResult {
  posted: number;
  /** Clan names (or 'digest') whose send failed — surfaced to the leader rather than swallowed. */
  failed: string[];
}

/**
 * Post — or update — every clan's roster plus the leadership digest.
 *
 * Safe to call repeatedly: each message is edited in place, so this is also the "refresh after a
 * transfer landed" action. A clan with no webhook and no global fallback simply fails and is
 * reported; the rest still go out.
 */
export async function postSeasonRoster(seasonId: string): Promise<PostResult> {
  const posts = await renderSeasonPosts(seasonId);
  const result: PostResult = { posted: 0, failed: [] };

  for (const clan of posts.clans) {
    const messageId = await postOrEditDiscordMessage(clan.message, {
      webhookUrl: await webhookUrlForClan(clan.clanId),
      messageId: clan.messageId,
    });
    if (!messageId) {
      result.failed.push(clan.clanName);
      continue;
    }
    result.posted += 1;
    // Only write when it actually changed — a successful edit returns the same id.
    if (messageId !== clan.messageId) {
      await supabase
        .from('cwl_season_clans')
        .update({ roster_message_id: messageId })
        .eq('season_id', seasonId)
        .eq('clan_id', clan.clanId);
    }
  }

  // The digest has no clan of its own, so it goes to the global DISCORD_WEBHOOK_URL — the family-wide
  // channel. (While the routing override is on, so does everything else.)
  const digestId = await postOrEditDiscordMessage(posts.digest, {
    webhookUrl: null,
    messageId: posts.digestMessageId,
  });
  if (!digestId) {
    result.failed.push('leadership digest');
  } else {
    result.posted += 1;
    if (digestId !== posts.digestMessageId) {
      await supabase.from('cwl_seasons').update({ digest_message_id: digestId }).eq('id', seasonId);
    }
  }

  return result;
}

/**
 * Post the "these accounts must move" call-to-action, family-wide.
 *
 * `auto` marks the call made by the season entering `transfers_pending`: that one is skipped if it
 * has already been sent, because a status flip made for an unrelated reason must not re-ping the
 * family. A leader pressing the button explicitly always sends.
 */
export async function postTransferCall(seasonId: string, opts: { auto?: boolean } = {}): Promise<PostResult> {
  const posts = await renderSeasonPosts(seasonId);
  if (opts.auto && posts.transferCallPostedAt) return { posted: 0, failed: [] };

  // Sent fresh, never edited: editing a message does not re-notify anyone, and the whole purpose of
  // this message is the notification.
  const messageId = await postOrEditDiscordMessage(posts.transferCall, { webhookUrl: null });
  if (!messageId) return { posted: 0, failed: ['transfer call'] };

  await supabase
    .from('cwl_seasons')
    .update({ transfer_call_posted_at: new Date().toISOString() })
    .eq('id', seasonId);
  return { posted: 1, failed: [] };
}

/** Clan id → display name, for the ids in this season only. */
async function loadClanNames(clanIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(clanIds));
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from('clans').select('id, display_name').in('id', unique);
  return new Map(((data as { id: string; display_name: string }[]) || []).map((c) => [c.id, c.display_name]));
}

/** Pending transfers → renderable moves, with each mover's Discord id resolved for the ping. */
async function buildMoves(rows: TransferRow[], clanNames: Map<string, string>): Promise<TransferMove[]> {
  const usable = rows.filter((r) => r.allocation && r.to_clan_id);
  const tags = usable.map((r) => r.allocation!.player_account_tag);
  const mentions = await discordIdsForAccountTags(tags);

  return usable.map((r, i) => ({
    name: r.allocation!.account?.in_game_name || r.allocation!.player_account_tag,
    playerTag: r.allocation!.player_account_tag,
    mentionId: mentions[i],
    fromClanName: r.from_clan_id ? clanNames.get(r.from_clan_id) || null : null,
    toClanName: clanNames.get(r.to_clan_id!) || 'the assigned clan',
  }));
}
