/**
 * Push the slash-command definitions to Discord (a bulk overwrite, so a removed definition is
 * deleted there too).
 *
 * Guild-scoped when DISCORD_GUILD_ID is set — changes appear instantly and only in the family server
 * — else global, which Discord can take up to an hour to propagate. Run after any change to
 * `commands/definitions.ts`; it is idempotent.
 */

import { discordBotRequest } from '../transport';
import { COMMAND_DEFINITIONS } from './commands/definitions';

export async function syncCommands(): Promise<{ ok: true; scope: 'guild' | 'global'; names: string[] } | { ok: false; error: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID?.trim();
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID is not set' };
  if (!process.env.DISCORD_BOT_TOKEN?.trim()) return { ok: false, error: 'DISCORD_BOT_TOKEN is not set' };

  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const path = guildId ? `/applications/${appId}/guilds/${guildId}/commands` : `/applications/${appId}/commands`;
  const result = (await discordBotRequest('PUT', path, COMMAND_DEFINITIONS)) as { name: string }[] | null;
  if (!result) return { ok: false, error: 'Discord rejected the command sync — see the server logs' };
  return { ok: true, scope: guildId ? 'guild' : 'global', names: result.map((c) => c.name) };
}
