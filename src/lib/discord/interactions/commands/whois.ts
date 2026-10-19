/**
 * `/whois` — leadership looks up a player by tag (with name autocomplete) or by Discord user.
 *
 * Gated on dashboard access, the same bar as opening the dashboard: anyone with an `access_role`
 * can already see every profile there. Autocomplete is gated too, or the suggestion list alone would
 * leak the roster to anyone typing the command.
 */

import { supabase } from '@/lib/supabase';
import { loadProfileByPerson, loadProfileByTag, searchAccounts } from '@/lib/members/profile';
import { renderProfile } from '@/lib/members/profilePost';
import { isLeadership } from '../actor';
import { ephemeral, focusedOption, optionValue, type HandlerResult } from '../types';
import type { CommandHandler } from './registry';

export const whois: CommandHandler = {
  name: 'whois',
  async run(interaction, actor): Promise<HandlerResult> {
    if (!isLeadership(actor)) return ephemeral('`/whois` is for leadership.');

    const player = optionValue(interaction, 'player');
    const user = optionValue(interaction, 'user');
    if (typeof player !== 'string' && typeof user !== 'string') {
      return ephemeral('Give a `player` (tag or name) or a Discord `user`.');
    }

    return {
      kind: 'defer',
      ephemeral: true,
      work: async () => {
        const profile = typeof player === 'string'
          ? await loadProfileByTag(player)
          : await profileForDiscordUser(user as string);
        if (!profile) {
          return {
            content: typeof player === 'string'
              ? `No account found for \`${player}\`. Pick a suggestion, or give the exact tag.`
              : `<@${user}> is not linked to anyone in ClanOps.`,
            allowed_mentions: { parse: [] },
          };
        }
        return renderProfile(profile, { now: new Date(), audience: 'leadership' });
      },
    };
  },

  async autocomplete(interaction, actor): Promise<HandlerResult> {
    if (!isLeadership(actor)) return { kind: 'choices', choices: [] };
    const typed = focusedOption(interaction)?.value;
    return { kind: 'choices', choices: await searchAccounts(typeof typed === 'string' ? typed : '') };
  },
};

async function profileForDiscordUser(discordUserId: string) {
  const { data } = await supabase
    .from('persons')
    .select('id')
    .in('discord_user_id', [discordUserId, `<@${discordUserId}>`, `<@!${discordUserId}>`]);
  // Two persons claiming one Discord id is a data error; refuse to guess between them.
  if (!data || data.length !== 1) return null;
  return loadProfileByPerson((data[0] as { id: string }).id);
}
