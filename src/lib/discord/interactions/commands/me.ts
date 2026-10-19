/** `/me` — the invoker's own profile. Open to anyone whose Discord is linked to a person. */

import { loadProfileByPerson } from '@/lib/members/profile';
import { renderProfile } from '@/lib/members/profilePost';
import { ephemeral, type HandlerResult } from '../types';
import type { CommandHandler } from './registry';

export const me: CommandHandler = {
  name: 'me',
  async run(_interaction, actor): Promise<HandlerResult> {
    if (!actor.personId) {
      return ephemeral(
        'Your Discord account is not linked to a ClanOps profile yet. Ask leadership to link it, then try again.',
      );
    }
    return {
      kind: 'defer',
      ephemeral: true,
      work: async () => {
        const profile = await loadProfileByPerson(actor.personId!);
        if (!profile) return { content: 'Your profile could not be found.' };
        return renderProfile(profile, { now: new Date(), audience: 'self' });
      },
    };
  },
};
