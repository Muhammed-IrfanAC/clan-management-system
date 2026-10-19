/**
 * The buttons on a "kicked player is back" alert (`kicks/alertPost.ts`). Any dashboard user may
 * manage the kick list, so dashboard access is the bar here too.
 *
 *  - `handled`: leadership dealt with it (usually: kicked again). Nothing to write — the stamp on the
 *    alert IS the record, and it is what stops the next leader from acting on it too.
 *  - `remove`: they are welcome back. Taking an entry off the list deletes its reason with it, so the
 *    click only ASKS, privately; `confirm` (carrying the alert's message id) does it and then stamps
 *    the alert through the bot, since the confirmation is a different message from the alert.
 */

import { discordBotRequest } from '@/lib/discord';
import { KickListError, removeKick } from '@/lib/kicks/kickList';
import { KICK_NS, kickButtonId } from '@/lib/kicks/alertPost';
import { ButtonStyle, type DiscordMessage } from '../../types';
import { isLeadership } from '../actor';
import { byUser, stampResolution } from '../resolution';
import { ephemeral, type HandlerResult, type Interaction } from '../types';
import type { ComponentHandler } from './registry';

export const kickButtons: ComponentHandler = {
  namespace: KICK_NS,
  async run(interaction, actor, id): Promise<HandlerResult> {
    if (!isLeadership(actor)) return ephemeral('The kick list is for leadership.');
    if (id.version !== 1) return ephemeral('This button is no longer active.');
    const [action, tag, alertMessageId] = id.args;

    switch (action) {
      case 'handled':
        return { kind: 'update', reply: stampResolution(interaction.message, `✅ Handled by ${byUser(actor.discordUserId)}`) };

      case 'remove':
        if (!tag || !interaction.message) return ephemeral('This button is no longer active.');
        return {
          kind: 'reply',
          reply: {
            ephemeral: true,
            content: `Take \`${tag}\` off the kick list? The recorded reason is deleted with the entry.`,
            components: [{
              type: 1,
              components: [{
                type: 2,
                style: ButtonStyle.DANGER,
                label: 'Yes, remove from the kick list',
                custom_id: kickButtonId('confirm', tag, interaction.message.id),
              }],
            }],
          },
        };

      case 'confirm':
        if (!tag || !alertMessageId) return ephemeral('This button is no longer active.');
        return {
          kind: 'deferUpdate',
          work: async () => {
            let removed = true;
            try {
              await removeKick(tag);
            } catch (err) {
              if (!(err instanceof KickListError) || err.status !== 404) throw err;
              removed = false;
            }
            await stampAlert(interaction, alertMessageId, removed
              ? `👋 Welcome back — removed from the kick list by ${byUser(actor.discordUserId)}`
              : '👋 Already off the kick list');
            return { content: removed ? `\`${tag}\` is off the kick list.` : 'It was already off the kick list.', components: [] };
          },
        };

      default:
        return ephemeral('This button is no longer active.');
    }
  },
};

/** Stamp the original alert, which is not the message this click came from. Best-effort. */
async function stampAlert(interaction: Interaction, messageId: string, line: string): Promise<void> {
  const channelId = interaction.channel_id;
  if (!channelId) return;
  const path = `/channels/${channelId}/messages/${encodeURIComponent(messageId)}`;
  const alert = (await discordBotRequest('GET', path)) as DiscordMessage | null;
  if (!alert) return;
  const { content, embeds, components, allowed_mentions } = stampResolution(alert, line);
  await discordBotRequest('PATCH', path, { content, embeds, components, allowed_mentions });
}
