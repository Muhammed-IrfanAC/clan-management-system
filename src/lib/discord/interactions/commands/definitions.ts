/**
 * Slash-command DEFINITIONS — the JSON Discord stores and shows in its command picker. Pure data, so
 * registration (`register.ts`) can read it without loading the handlers and their database code.
 *
 * Discord's own permission settings are deliberately not used to hide leadership commands: who is
 * leadership is decided by `persons.access_role`, and every handler checks it live. A member who runs
 * `/whois` gets a polite refusal, not a lookup.
 *
 * Changing a definition only takes effect once commands are re-synced (Settings → Discord → Sync
 * commands, or POST /api/discord/commands).
 */

import { OptionType } from '../types';

// Guild install only — no DMs, no user-installed contexts. Every command assumes a family server.
const GUILD_ONLY = { contexts: [0], integration_types: [0] };

export const COMMAND_DEFINITIONS = [
  {
    name: 'me',
    description: 'Your ClanOps profile: linked accounts, clans and strike standing',
    type: 1,
    ...GUILD_ONLY,
  },
  {
    name: 'whois',
    description: 'Leadership: look up a player by tag or Discord user',
    type: 1,
    ...GUILD_ONLY,
    options: [
      { name: 'player', description: 'Player tag or name', type: OptionType.STRING, required: false, autocomplete: true },
      { name: 'user', description: 'Discord user', type: OptionType.USER, required: false },
    ],
  },
  {
    name: 'link',
    description: 'Leadership: link an unlinked account as someone’s alt, or as a new person',
    type: 1,
    ...GUILD_ONLY,
    options: [
      { name: 'account', description: 'The unlinked account (name or tag)', type: OptionType.STRING, required: true, autocomplete: true },
      { name: 'person', description: 'Whose alt it is — leave out to make a new person', type: OptionType.STRING, required: false, autocomplete: true },
    ],
  },
] as const;

export type CommandName = (typeof COMMAND_DEFINITIONS)[number]['name'];
