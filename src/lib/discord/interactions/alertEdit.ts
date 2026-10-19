/**
 * Edit an alert from a DIFFERENT message than the one clicked — a confirmation or a link panel is
 * an ephemeral message of its own, and the alert it acts on has to be stamped through the bot.
 * Best-effort: the action itself has already happened, so a failed stamp is logged, never thrown.
 */

import { discordBotRequest } from '@/lib/discord';
import type { DiscordMessage } from '../types';
import type { Reply } from './types';

export async function editAlert(
  channelId: string | undefined,
  messageId: string,
  transform: (alert: DiscordMessage) => Reply,
): Promise<void> {
  if (!channelId) return;
  const path = `/channels/${channelId}/messages/${encodeURIComponent(messageId)}`;
  const alert = (await discordBotRequest('GET', path)) as DiscordMessage | null;
  if (!alert) return;
  const { content, embeds, components, allowed_mentions } = transform(alert);
  await discordBotRequest('PATCH', path, { content, embeds, components, allowed_mentions });
}
