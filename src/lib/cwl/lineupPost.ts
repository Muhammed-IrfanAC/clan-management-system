/**
 * Pure renderers for the two CWL lineup notices — the round reveal and a mid-preparation swap. The
 * DB/send half is `lineupNotify.ts`.
 */

import { COLOR_WARNING, discordTs, truncateField } from '@/lib/discord/format';
import type { DiscordEmbedField, DiscordMessage } from '@/lib/discord/types';
import type { LineupDiff } from './lineup';

/**
 * Announce a CWL round's lineup at reveal, calling out how it differs from the formed roster.
 *
 * Posted once per round, the moment the war is revealed and still in preparation — the window where
 * a swap is still actionable. The asymmetry in mentions is deliberate and is the whole point of the
 * message: someone SWAPPED IN has to know they are playing today, so they get a real @ping. Someone
 * swapped out is named without a ping — they need the information, not a notification telling them
 * they lost their slot. `allowed_mentions.users` is restricted to exactly the swapped-in ids, so a
 * name appearing in the swapped-out list can never resolve into a ping.
 *
 * `basis` says what the lineup was compared AGAINST, and it changes the wording because it changes
 * the meaning. Against the plan ('plan'), an absent starter really was swapped out. Against the
 * previous round ('previous_round'), the two lists are a rotation — same war size in, same war size
 * out — and calling a rested player "swapped out" overstates what happened to them.
 */
export function renderRoundLineup(params: {
  clanName: string;
  roundNumber: number;
  opponentName?: string | null;
  startTime?: string | null;
  diff: LineupDiff;
  basis?: 'plan' | 'previous_round';
  // Discord ids for the swapped-IN accounts only, in the same order; null where the person has no
  // linked Discord (or the account has no person at all — a guest roster).
  swappedInMentions: (string | null)[];
}): DiscordMessage {
  const { clanName, roundNumber, opponentName, startTime, diff, swappedInMentions } = params;
  const basis = params.basis ?? 'plan';
  const rotation = basis === 'previous_round';

  const mentionIds = swappedInMentions.filter((id): id is string => !!id);

  const fields: DiscordEmbedField[] = [];

  if (diff.swappedIn.length) {
    fields.push({
      name: rotation ? `⬆️ Rotated in (${diff.swappedIn.length})` : `⬆️ Swapped in (${diff.swappedIn.length})`,
      value: truncateField(
        diff.swappedIn
          .map((p, i) => {
            const who = swappedInMentions[i] ? `<@${swappedInMentions[i]}>` : `**${p.name}**`;
            // A bench call-up is worth naming — the roster working as designed. The other reason is
            // NOT printed any more: signupReconcile.ts rewrites the plan from the in-game signup list
            // every sync, so "not on this clan's roster" was reporting a gap that reconciliation had
            // already closed. It read to the player as an accusation of being somewhere they should
            // not be, about a lineup leadership themselves had just set.
            return p.reason === 'from_bench'
              ? `• ${who} (${p.playerTag}) — from the bench`
              : `• ${who} (${p.playerTag})`;
          })
          .join('\n'),
      ),
    });
  }

  if (diff.swappedOut.length) {
    fields.push({
      name: rotation ? `⬇️ Resting this round (${diff.swappedOut.length})` : `⬇️ Swapped out (${diff.swappedOut.length})`,
      // Plain names, never mentions — see the doc block.
      value: truncateField(diff.swappedOut.map((p) => `• ${p.name} (${p.playerTag})`).join('\n')),
    });
  }

  fields.push({
    name: 'Lineup',
    value: rotation
      ? `**${diff.actualSize}** in the war · **${diff.asPlanned}** unchanged from the last round`
      : `**${diff.actualSize}** in the war · **${diff.asPlanned}** of **${diff.plannedSize}** planned starters fielded`,
    inline: false,
  });

  if (startTime) {
    fields.push({ name: 'Battle day starts', value: `${discordTs(startTime, 'f')} (${discordTs(startTime, 'R')})`, inline: false });
  }

  const title = diff.matchesPlan
    ? rotation
      ? `⚔️ Round ${roundNumber} — same lineup as the last round`
      : `⚔️ Round ${roundNumber} — lineup matches the roster`
    : `🔄 Round ${roundNumber} — lineup changed`;

  return {
    content: mentionIds.length ? mentionIds.map((id) => `<@${id}>`).join(' ') : undefined,
    allowed_mentions: { users: mentionIds },
    embeds: [
      {
        title,
        description: `**${clanName}**${opponentName ? ` vs ${opponentName}` : ''}`,
        color: diff.matchesPlan ? 0x22c55e : COLOR_WARNING,
        fields,
        footer: { text: 'ClanOps · CWL' },
      },
    ],
  };
}

/**
 * A lineup SWAP during preparation — the lineup changed after it had already been revealed. Null
 * when nothing changed, so there is nothing to send.
 *
 * Separate from renderRoundLineup on purpose. That one announces the reveal and reads the war
 * against the formed roster; this one reads it against the lineup we saw last poll, which from
 * sign-up onward is the only comparison that still carries information (see cwl/lineupChange.ts).
 * The audience is different too: a swap is aimed squarely at the player who has just been given a
 * war they were not expecting, so the swapped-IN accounts get a real @mention in the message
 * content — a mention inside an embed renders but never notifies — while the swapped-out are named
 * with `allowed_mentions` withheld, exactly as the reveal notice does.
 */
export function renderLineupSwap(params: {
  clanName: string;
  roundNumber: number;
  opponentName?: string | null;
  startTime?: string | null;
  swappedIn: { playerTag: string; name: string }[];
  swappedOut: { playerTag: string; name: string }[];
  /** Discord ids for the swapped-IN accounts, in the same order; null where there is no link. */
  swappedInMentions: (string | null)[];
}): DiscordMessage | null {
  const { clanName, roundNumber, opponentName, startTime, swappedIn, swappedOut, swappedInMentions } = params;
  if (!swappedIn.length && !swappedOut.length) return null;

  const mentionIds = swappedInMentions.filter((id): id is string => !!id);
  const fields: DiscordEmbedField[] = [];

  if (swappedIn.length) {
    fields.push({
      name: `⬆️ Now in the war (${swappedIn.length})`,
      value: truncateField(
        swappedIn
          .map((p, i) => `• ${swappedInMentions[i] ? `<@${swappedInMentions[i]}>` : `**${p.name}**`} (${p.playerTag})`)
          .join('\n'),
      ),
    });
  }

  if (swappedOut.length) {
    fields.push({
      name: `⬇️ No longer in the war (${swappedOut.length})`,
      value: truncateField(swappedOut.map((p) => `• ${p.name} (${p.playerTag})`).join('\n')),
    });
  }

  if (startTime) {
    fields.push({ name: 'Battle day starts', value: `${discordTs(startTime, 'f')} (${discordTs(startTime, 'R')})`, inline: false });
  }

  return {
    content: mentionIds.length ? mentionIds.map((id) => `<@${id}>`).join(' ') : undefined,
    allowed_mentions: { users: mentionIds },
    embeds: [
      {
        title: `🔁 Round ${roundNumber} — lineup swap`,
        description: `**${clanName}**${opponentName ? ` vs ${opponentName}` : ''} · the war roster changed during preparation`,
        color: COLOR_WARNING,
        fields,
        footer: { text: 'ClanOps · CWL' },
      },
    ],
  };
}
