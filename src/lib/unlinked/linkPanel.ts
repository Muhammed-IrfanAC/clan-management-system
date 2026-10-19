import { ButtonStyle, type DiscordActionRow } from '@/lib/discord/types';
import { encodeCustomId } from '@/lib/discord/interactions/customId';
import type { Reply } from '@/lib/discord/interactions/types';
import type { PersonSuggestion } from './match';

/**
 * PURE: the private panel a leader links an unlinked account from, opened by picking the account in
 * an unlinked-join alert (`joinPost.ts`). Handlers: `interactions/commands/unlinkedLink.ts`.
 *
 * Ordered by how often each answer is the right one. Most joiners are somebody's alt, and alts are
 * usually named like their owner, so the name matches (`match.ts`) come first as one-click buttons.
 * Next is Discord's own member picker — the owner is almost always in the server, and their Discord
 * resolves to their person — and last a new person named after the account. `/link` covers an owner
 * who is neither suggested nor on Discord.
 *
 * Every id that acts on the account carries the alert's message id, so the alert can be stamped
 * when the link is made from this separate, ephemeral message.
 */

export const UNLINKED_NS = 'unl';
const VERSION = 1;

export const linkIds = {
  /** The select on the alert itself. */
  pick: () => encodeCustomId(UNLINKED_NS, VERSION, ['pick']),
  alt: (tag: string, personId: string, alertId: string) => encodeCustomId(UNLINKED_NS, VERSION, ['alt', tag, personId, alertId]),
  altByDiscord: (tag: string, alertId: string) => encodeCustomId(UNLINKED_NS, VERSION, ['altdc', tag, alertId]),
  newPerson: (tag: string, alertId: string) => encodeCustomId(UNLINKED_NS, VERSION, ['new', tag, alertId]),
  /** Set a person's Discord — offered once a link leaves the person without one. */
  discord: (personId: string) => encodeCustomId(UNLINKED_NS, VERSION, ['dc', personId]),
};

/** Player and person names are free text; a stray `*` or `_` would restyle the rest of the line. */
export function escapeMarkdown(s: string): string {
  return s.replace(/([*_`~|\\>])/g, '\\$1');
}

export function renderLinkPanel(
  account: { tag: string; name: string },
  suggestions: PersonSuggestion[],
  alertId: string,
  notice?: string,
): Reply {
  const rows: DiscordActionRow[] = [];
  if (suggestions.length) {
    rows.push({
      type: 1,
      components: suggestions.map((s) => ({
        type: 2,
        style: ButtonStyle.PRIMARY,
        label: `Alt of ${s.displayName}`.slice(0, 80),
        custom_id: linkIds.alt(account.tag, s.personId, alertId),
      })),
    });
  }
  rows.push({
    type: 1,
    components: [{ type: 5, custom_id: linkIds.altByDiscord(account.tag, alertId), placeholder: 'Alt of… pick the owner’s Discord' }],
  });
  rows.push({
    type: 1,
    components: [{
      type: 2,
      style: ButtonStyle.SUCCESS,
      label: `New person: ${account.name}`.slice(0, 80),
      custom_id: linkIds.newPerson(account.tag, alertId),
    }],
  });

  const lines = [
    `Link **${escapeMarkdown(account.name)}** \`${account.tag}\` —`,
    suggestions.length ? '• an alt of a likely match,' : null,
    '• an alt of whoever owns a Discord account,',
    '• or a new person named after the account.',
    '-# Owner not suggested and not on Discord? Use `/link`.',
  ].filter(Boolean);

  return {
    ephemeral: true,
    content: `${notice ? `${notice}\n\n` : ''}${lines.join('\n')}`,
    components: rows,
    allowed_mentions: { parse: [] },
  };
}

/** The panel once the account is linked: done, or offering the person's Discord if they lack one. */
export function renderLinked(
  tag: string,
  result: { personId: string; personName: string; created: boolean; personDiscordId: string | null },
): Reply {
  const who = `**${escapeMarkdown(result.personName)}**`;
  const done = `🔗 \`${tag}\` is linked to ${who}${result.created ? ' (new person)' : ' as an alt'}.`;
  if (result.personDiscordId) {
    return { content: `${done} Their Discord is <@${result.personDiscordId}>.`, components: [], allowed_mentions: { parse: [] } };
  }
  return {
    content: `${done}\n${who} has no Discord linked yet — pick theirs to link it, or leave it for later.`,
    components: [{ type: 1, components: [{ type: 5, custom_id: linkIds.discord(result.personId), placeholder: `Link ${result.personName.slice(0, 60)}’s Discord (optional)` }] }],
    allowed_mentions: { parse: [] },
  };
}
