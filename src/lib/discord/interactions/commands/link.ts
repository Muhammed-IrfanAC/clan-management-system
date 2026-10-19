/**
 * `/link account:<unlinked account> [person:<person>]` — leadership links an account without an
 * alert to click: as an alt of `person`, or, with no person, as a new person named after the account.
 * The fallback the link panel points to for an owner who is neither name-suggested nor on Discord.
 *
 * Both options autocomplete, and autocomplete is gated like `/whois`'s, since the suggestions alone
 * would list the roster. `person` searches person names AND their accounts' names and tags, because
 * a leader thinks "Bob's alt" and Bob's person may be named differently from his accounts.
 */

import {
  LinkError,
  linkUnlinkedAccount,
  loadAccountForLink,
  searchPersons,
  searchUnlinkedAccounts,
} from '@/lib/unlinked/link';
import { renderLinked } from '@/lib/unlinked/linkPanel';
import { isLeadership } from '../actor';
import { ephemeral, focusedOption, optionValue, type HandlerResult } from '../types';
import type { CommandHandler } from './registry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const link: CommandHandler = {
  name: 'link',
  async run(interaction, actor): Promise<HandlerResult> {
    if (!isLeadership(actor)) return ephemeral('`/link` is for leadership.');
    const account = optionValue(interaction, 'account');
    const person = optionValue(interaction, 'person');
    if (typeof account !== 'string') return ephemeral('Give the `account` to link.');
    if (person !== undefined && (typeof person !== 'string' || !UUID.test(person))) {
      return ephemeral('Pick the `person` from the suggestions — type part of their name or one of their accounts.');
    }

    return {
      kind: 'defer',
      ephemeral: true,
      work: async () => {
        try {
          const target = typeof person === 'string'
            ? { personId: person }
            : { newPersonName: (await loadAccountForLink(account))?.name ?? account };
          const result = await linkUnlinkedAccount(account, target);
          return renderLinked(result.tag, result);
        } catch (err) {
          if (err instanceof LinkError) return { content: `⚠️ ${err.message}`, allowed_mentions: { parse: [] } };
          throw err;
        }
      },
    };
  },

  async autocomplete(interaction, actor): Promise<HandlerResult> {
    if (!isLeadership(actor)) return { kind: 'choices', choices: [] };
    const focused = focusedOption(interaction);
    const typed = typeof focused?.value === 'string' ? focused.value : '';
    const choices = focused?.name === 'person' ? await searchPersons(typed) : await searchUnlinkedAccounts(typed);
    return { kind: 'choices', choices };
  },
};
