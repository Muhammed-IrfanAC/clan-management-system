/**
 * Stamping an alert with what was done about it — PURE.
 *
 * An alert with buttons is a shared worklist item: several leaders read the same channel, so once one
 * acts the message itself must say so, or the next leader acts again. The stamp is an "Actions" field
 * on the alert's embed (one line per action, newest last) and the buttons the action used up are
 * removed. The original text is kept: the alert stays a record of what happened, not just its outcome.
 *
 * Works from the message Discord hands back with the click, so a handler needs nothing but the
 * interaction to update it — no re-render, no stored copy of the alert.
 */

import { truncateField } from '../format';
import type { DiscordActionRow, DiscordEmbed } from '../types';
import type { Reply } from './types';

const FIELD_NAME = 'Actions';
/** Resolved alerts drop their alert colour, so a channel scan shows what is still open. */
export const COLOR_RESOLVED = 0x22c55e;

export type StampOptions = {
  /** Buttons/selects left on the message. Default: none — the alert is fully handled. */
  components?: DiscordActionRow[];
  /** Keep the alert colour (more is still open, e.g. one of several unlinked joiners linked). */
  stillOpen?: boolean;
};

export function stampResolution(
  message: { content?: string; embeds?: DiscordEmbed[] } | undefined,
  line: string,
  opts: StampOptions = {},
): Reply {
  const [first, ...rest] = message?.embeds ?? [];
  const embed: DiscordEmbed = first ? { ...first } : {};
  const fields = [...(embed.fields ?? [])];
  const at = fields.findIndex((f) => f.name === FIELD_NAME);
  // Keep the newest lines when the field fills up: the latest action is the one a reader needs.
  const value = at >= 0 ? keepTail(`${fields[at].value}\n${line}`) : truncateField(line);
  if (at >= 0) fields[at] = { ...fields[at], value };
  else fields.push({ name: FIELD_NAME, value, inline: false });
  embed.fields = fields;
  if (!opts.stillOpen) embed.color = COLOR_RESOLVED;

  return {
    content: message?.content ?? '',
    embeds: [embed, ...rest],
    components: opts.components ?? [],
    // An edit never re-notifies, but the role mention in the content must not become live either.
    allowed_mentions: { parse: [] },
  };
}

function keepTail(value: string): string {
  const LIMIT = 1024;
  if (value.length <= LIMIT) return value;
  const lines = value.split('\n');
  while (lines.length > 1 && lines.join('\n').length > LIMIT - 2) lines.shift();
  return truncateField(`…\n${lines.join('\n')}`);
}

/** `<@id>` renders as the clicker's name; with mentions off it never pings them. */
export const byUser = (discordUserId: string) => `<@${discordUserId}>`;

/** The message's components with one select option removed; rows left empty are dropped. */
export function withoutOption(components: DiscordActionRow[] | undefined, selectId: string, value: string): DiscordActionRow[] {
  return (components ?? [])
    .map((row) => ({
      ...row,
      components: row.components.flatMap((c) => {
        if (c.type !== 3 || c.custom_id !== selectId) return [c];
        const options = c.options.filter((o) => o.value !== value);
        return options.length ? [{ ...c, options, max_values: Math.min(c.max_values ?? 1, options.length) }] : [];
      }),
    }))
    .filter((row) => row.components.length > 0);
}
