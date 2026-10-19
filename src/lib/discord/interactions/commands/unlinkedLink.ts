/**
 * Linking an unlinked joiner from its alert (`unlinked/joinPost.ts` → `unlinked/linkPanel.ts`).
 * Same bar as Members → Unlinked Accounts: dashboard access.
 *
 *  - `pick` (the alert's select): opens the private link panel for that account — or, if somebody
 *    linked it since the alert was posted, stamps that on the alert and drops it from the select.
 *  - `alt` (a suggested match), `altdc` (the owner's Discord), `new` (a new person): link it
 *    (`unlinked/link.ts`), stamp the alert, and turn the panel into the result — which offers the
 *    person's Discord when they have none yet.
 *  - `dc`: link that Discord to the person. Also offered by `/link`.
 *
 * Everything after `pick` is deferred: a link is several reads and writes plus an edit of the alert.
 * A refusal (`LinkError`) is shown in the panel; the alert is left alone.
 */

import type { DiscordActionRow } from '../../types';
import {
  LinkError,
  linkPersonDiscord,
  linkUnlinkedAccount,
  loadAccountForLink,
  loadPersonCandidates,
  personsForDiscordUser,
  type LinkTarget,
} from '@/lib/unlinked/link';
import { suggestPersons } from '@/lib/unlinked/match';
import { escapeMarkdown, linkIds, renderLinked, renderLinkPanel, UNLINKED_NS } from '@/lib/unlinked/linkPanel';
import type { Actor } from '../actor';
import { isLeadership } from '../actor';
import { editAlert } from '../alertEdit';
import { byUser, stampResolution, withoutOption } from '../resolution';
import { ephemeral, InteractionType, type HandlerResult, type Interaction, type Reply } from '../types';
import type { ComponentHandler } from './registry';

export const unlinkedLink: ComponentHandler = {
  namespace: UNLINKED_NS,
  async run(interaction, actor, id): Promise<HandlerResult> {
    if (!isLeadership(actor)) return ephemeral('Linking accounts is for leadership.');
    if (id.version !== 1 || interaction.type !== InteractionType.MESSAGE_COMPONENT) {
      return ephemeral('This control is no longer active.');
    }
    const [action, ...args] = id.args;
    const picked = interaction.data?.values?.[0];

    switch (action) {
      case 'pick':
        return pick(interaction, picked);
      case 'alt': {
        const [tag, personId, alertId] = args;
        if (!tag || !personId || !alertId) break;
        return deferred(() => link(interaction, actor, tag, alertId, { personId }));
      }
      case 'altdc': {
        const [tag, alertId] = args;
        if (!tag || !alertId || !picked) break;
        return deferred(async () => {
          const owners = await personsForDiscordUser(picked);
          if (owners.length !== 1) {
            const why = owners.length
              ? `⚠️ <@${picked}> is linked to more than one person — fix that on the dashboard first.`
              : `⚠️ <@${picked}> is not linked to anyone in ClanOps. Pick another, or make a new person.`;
            // Keep the panel usable for another pick; replace any earlier warning rather than stacking.
            const panel = (interaction.message?.content ?? '').replace(/^⚠️[^\n]*\n\n/, '');
            return { content: `${why}\n\n${panel}`, components: interaction.message?.components ?? [], allowed_mentions: { parse: [] } };
          }
          return link(interaction, actor, tag, alertId, { personId: owners[0].id });
        });
      }
      case 'new': {
        const [tag, alertId] = args;
        if (!tag || !alertId) break;
        return deferred(async () => {
          const account = await loadAccountForLink(tag);
          return link(interaction, actor, tag, alertId, { newPersonName: account?.name ?? tag });
        });
      }
      case 'dc': {
        const [personId] = args;
        if (!personId || !picked) break;
        return deferred(() => linkDiscord(personId, picked));
      }
    }
    return ephemeral('This control is no longer active.');
  },
};

function deferred(work: () => Promise<Reply>): HandlerResult {
  return {
    kind: 'deferUpdate',
    work: async () => {
      try {
        return await work();
      } catch (err) {
        if (err instanceof LinkError) return { content: `⚠️ ${err.message}`, components: [], allowed_mentions: { parse: [] } };
        throw err;
      }
    },
  };
}

async function pick(interaction: Interaction, tag: string | undefined): Promise<HandlerResult> {
  const alertId = interaction.message?.id;
  if (!tag || !alertId) return ephemeral('Pick an account to link.');
  const account = await loadAccountForLink(tag);
  if (!account) return ephemeral(`\`${tag}\` is no longer a ClanOps account.`);

  if (account.person) {
    // Linked since the alert went out (dashboard or `/link`): the alert should say so, not offer it.
    const components = withoutOption(interaction.message?.components, linkIds.pick(), account.tag);
    return {
      kind: 'update',
      reply: stampResolution(
        interaction.message,
        `🔗 \`${account.tag}\` was already linked to **${escapeMarkdown(account.person.displayName)}**`,
        { components, stillOpen: components.length > 0 },
      ),
    };
  }
  const suggestions = suggestPersons({ name: account.name, clanId: account.clanId }, await loadPersonCandidates());
  return { kind: 'reply', reply: renderLinkPanel(account, suggestions, alertId) };
}

async function link(interaction: Interaction, actor: Actor, tag: string, alertId: string, target: LinkTarget): Promise<Reply> {
  const result = await linkUnlinkedAccount(tag, target);
  const line =
    `🔗 \`${tag}\` linked to **${escapeMarkdown(result.personName)}**` +
    `${result.created ? ' (new person)' : ' as an alt'} by ${byUser(actor.discordUserId)}`;
  await editAlert(interaction.channel_id, alertId, (alert) => {
    const components = withoutOption(alert.components as DiscordActionRow[] | undefined, linkIds.pick(), tag);
    return stampResolution(alert, line, { components, stillOpen: components.length > 0 });
  });
  return renderLinked(tag, result);
}

/** Exported for `/link`, which offers the same Discord picker after linking. */
export async function linkDiscord(personId: string, discordUserId: string): Promise<Reply> {
  const { personName, unchanged } = await linkPersonDiscord(personId, discordUserId);
  return {
    content: unchanged
      ? `**${escapeMarkdown(personName)}** was already linked to <@${discordUserId}>.`
      : `✅ **${escapeMarkdown(personName)}** is now linked to <@${discordUserId}> — \`/me\` works for them now.`,
    components: [],
    allowed_mentions: { parse: [] },
  };
}
