import type { DiscordMessage } from '@/lib/discord/types';
import { discordTs } from '@/lib/discord/format';

/**
 * The DM carrying a login code. Names the account it was requested for, and says what an
 * unexpected one means: someone typed your tag, which is harmless without the code.
 */
export function renderLoginCodeDm(code: string, playerTag: string, expiresAt: string): DiscordMessage {
  return {
    content: [
      `Your ClanOps login code is **${code}**`,
      `-# For ${playerTag} · expires ${discordTs(expiresAt, 'R')}`,
      `-# Didn't ask for this? Someone entered your tag on the login page. Don't share the code; nobody can get in without it.`,
    ].join('\n'),
    allowed_mentions: { parse: [] },
  };
}
