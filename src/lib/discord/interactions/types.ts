/**
 * The slice of Discord's interaction model this app uses. Discord sends far more; anything not
 * named here is ignored rather than typed. See
 * https://discord.com/developers/docs/interactions/receiving-and-responding
 */

import type { DiscordMessage } from '../types';

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  AUTOCOMPLETE_RESULT: 8,
} as const;

/** Message flag: only the invoking user sees the reply. */
export const EPHEMERAL = 1 << 6;

export const OptionType = {
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
} as const;

export type CommandOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
  options?: CommandOption[];
};

export type Interaction = {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  // In a guild the invoker arrives as `member.user`; in a DM as `user`.
  member?: { user: { id: string; username: string } };
  user?: { id: string; username: string };
  data?: {
    name?: string;
    options?: CommandOption[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
    resolved?: { users?: Record<string, { id: string; username: string }> };
  };
  message?: { id: string };
};

/** The invoking Discord user's id, wherever Discord put it. */
export function invokerId(i: Interaction): string | null {
  return i.member?.user.id ?? i.user?.id ?? null;
}

/** A top-level option's value by name (sub-commands are not used yet). */
export function optionValue(i: Interaction, name: string): string | number | boolean | undefined {
  return i.data?.options?.find((o) => o.name === name)?.value;
}

/** The option the user is typing into, for an AUTOCOMPLETE interaction. */
export function focusedOption(i: Interaction): CommandOption | undefined {
  return i.data?.options?.find((o) => o.focused);
}

/** A reply as a handler states it; `ephemeral` maps to the message flag. */
export type Reply = DiscordMessage & { ephemeral?: boolean; components?: unknown[] };

/**
 * What a handler asks the router to do.
 *  - `reply`: answer now (within Discord's 3-second window).
 *  - `defer`: acknowledge now ("thinking…") and finish `work` in the background, editing the reply in.
 *    Anything that touches the CoC API, or might be slow on a cold start, defers.
 *  - `update`: replace the message a component was clicked on (buttons, selects).
 *  - `choices`: autocomplete suggestions.
 */
export type HandlerResult =
  | { kind: 'reply'; reply: Reply }
  | { kind: 'defer'; ephemeral: boolean; work: () => Promise<Reply> }
  | { kind: 'update'; reply: Reply }
  | { kind: 'choices'; choices: { name: string; value: string }[] };

export const reply = (r: Reply): HandlerResult => ({ kind: 'reply', reply: r });
export const ephemeral = (content: string): HandlerResult => ({ kind: 'reply', reply: { content, ephemeral: true } });
