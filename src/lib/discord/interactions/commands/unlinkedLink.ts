/**
 * "Link…" on an unlinked-join alert (`unlinked/joinPost.ts`). Same bar as Members → Unlinked
 * Accounts: dashboard access.
 *
 *  - `pick` (the select): opens a form for the chosen account — the tag of an account they already
 *    have linked (an alt), or a name for a new person, prefilled with the in-game name.
 *  - `link` (the form's submit): links it (`unlinked/link.ts`, which refuses an account somebody has
 *    linked since), then stamps the alert and takes the account out of the select. A refusal is told
 *    to the leader privately and leaves the alert alone.
 */

import type { DiscordActionRow } from '../../types';
import { LinkError, linkUnlinkedAccount } from '@/lib/unlinked/link';
import { UNLINKED_NS, unlinkedLinkId, unlinkedPickId } from '@/lib/unlinked/joinPost';
import { isLeadership } from '../actor';
import { byUser, stampResolution, withoutOption } from '../resolution';
import { ephemeral, modalValue, InteractionType, type HandlerResult } from '../types';
import type { ComponentHandler } from './registry';

const ALT_OF = 'alt_of';
const NEW_NAME = 'new_name';

export const unlinkedLink: ComponentHandler = {
  namespace: UNLINKED_NS,
  async run(interaction, actor, id): Promise<HandlerResult> {
    if (!isLeadership(actor)) return ephemeral('Linking accounts is for leadership.');
    if (id.version !== 1) return ephemeral('This control is no longer active.');
    const [action, argTag] = id.args;

    if (action === 'pick' && interaction.type === InteractionType.MESSAGE_COMPONENT) {
      const tag = interaction.data?.values?.[0];
      if (!tag) return ephemeral('Pick an account to link.');
      const name = optionLabel(interaction.message?.components, tag);
      return {
        kind: 'modal',
        modal: {
          customId: unlinkedLinkId(tag),
          title: `Link ${tag}`,
          inputs: [
            { customId: ALT_OF, label: 'Alt of — a tag they already have linked', placeholder: '#ABC123 (leave blank for a new person)', maxLength: 15 },
            { customId: NEW_NAME, label: 'Or: name for a new person', value: name, maxLength: 80 },
          ],
        },
      };
    }

    if (action === 'link' && argTag && interaction.type === InteractionType.MODAL_SUBMIT) {
      let result: Awaited<ReturnType<typeof linkUnlinkedAccount>>;
      try {
        result = await linkUnlinkedAccount({
          tag: argTag,
          altOfTag: modalValue(interaction, ALT_OF),
          newPersonName: modalValue(interaction, NEW_NAME),
        });
      } catch (err) {
        if (err instanceof LinkError) return ephemeral(err.message);
        throw err;
      }
      const components = withoutOption(interaction.message?.components, unlinkedPickId(), argTag);
      const line = `🔗 \`${argTag}\` linked to **${result.personName.replace(/([*_`~|\\>])/g, '\\$1')}**${result.created ? ' (new person)' : ' as an alt'} by ${byUser(actor.discordUserId)}`;
      return { kind: 'update', reply: stampResolution(interaction.message, line, { components, stillOpen: components.length > 0 }) };
    }

    return ephemeral('This control is no longer active.');
  },
};

/** The in-game name the alert showed for a tag, to prefill the new person's name. */
function optionLabel(components: DiscordActionRow[] | undefined, tag: string): string | undefined {
  for (const row of components ?? []) {
    for (const c of row.components) {
      if (c.type === 3) {
        const label = c.options.find((o) => o.value === tag)?.label;
        if (label) return label;
      }
    }
  }
  return undefined;
}
