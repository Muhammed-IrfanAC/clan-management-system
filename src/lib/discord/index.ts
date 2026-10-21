/**
 * The server-side Discord API: routing, identity and the send primitives.
 *
 * Message RENDERERS do not live here — each lives with its domain (`strikes/strikePost.ts`,
 * `cwl/lineupPost.ts`, `kicks/alertPost.ts`, …) and imports only `./types` and `./format`, so this
 * directory stays infrastructure. Pure code and client components import from `@/lib/discord/types`
 * (and `/format`), never from here, because this entry point pulls in the Supabase client.
 */

export type { ChannelPurpose, Destination, DiscordEmbed, DiscordEmbedField, DiscordMessage } from './types';
export { normalizeChannelId, normalizeDiscordId } from './format';
export { botConfigured, destinationForClan, invalidateDiscordRouteCache } from './routing';
export { discordIdsForAccountTags, discordUserIdForPerson } from './identity';
export {
  discordBotRequest, editInteractionReply, postDiscordMessage, postOrEditDiscordMessage, sendDiscordMessage, sendInteractionFollowUp,
} from './transport';
