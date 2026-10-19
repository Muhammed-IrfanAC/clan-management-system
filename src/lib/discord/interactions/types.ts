/**
 * The slice of Discord's interaction model this app uses. Discord sends far more; anything not
 * named here is ignored rather than typed. See
 * https://discord.com/developers/docs/interactions/receiving-and-responding
 */

import type { DiscordActionRow, DiscordEmbed, DiscordMessage } from '../types';

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
  MODAL: 9,
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
    /** MODAL_SUBMIT: the modal's rows of text inputs, with what was typed. */
    components?: { type: number; components: { type: number; custom_id: string; value?: string }[] }[];
  };
  /** The message a component sits on (and, for a modal opened from one, the message behind it). */
  message?: {
    id: string;
    channel_id?: string;
    content?: string;
    embeds?: DiscordEmbed[];
    components?: DiscordActionRow[];
  };
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

/** A submitted modal's text input by custom id, trimmed; undefined when absent or blank. */
export function modalValue(i: Interaction, customId: string): string | undefined {
  for (const row of i.data?.components ?? []) {
    const input = row.components.find((c) => c.custom_id === customId);
    if (input) return input.value?.trim() || undefined;
  }
  return undefined;
}

/** A reply as a handler states it; `ephemeral` maps to the message flag. */
export type Reply = DiscordMessage & { ephemeral?: boolean };

export const TextInputStyle = { SHORT: 1, PARAGRAPH: 2 } as const;

/** A modal: up to five text inputs, one per row. Its submit arrives as MODAL_SUBMIT on `customId`. */
export type Modal = {
  customId: string;
  title: string;
  inputs: {
    customId: string;
    label: string;
    style?: (typeof TextInputStyle)[keyof typeof TextInputStyle];
    required?: boolean;
    value?: string;
    placeholder?: string;
    maxLength?: number;
  }[];
};

/**
 * What a handler asks the router to do.
 *  - `reply`: answer now (within Discord's 3-second window).
 *  - `defer`: acknowledge now ("thinking…") and finish `work` in the background, editing the reply in.
 *    Anything that touches the CoC API, or might be slow on a cold start, defers.
 *  - `update`: replace the message a component was clicked on (buttons, selects).
 *  - `deferUpdate`: acknowledge a click now and replace that message with `work`'s result later —
 *    the `update` for anything that writes to the DB or posts elsewhere first.
 *  - `modal`: open a form (only in answer to a command or a component, never to a modal submit).
 *  - `choices`: autocomplete suggestions.
 */
export type HandlerResult =
  | { kind: 'reply'; reply: Reply }
  | { kind: 'defer'; ephemeral: boolean; work: () => Promise<Reply> }
  | { kind: 'update'; reply: Reply }
  | { kind: 'deferUpdate'; work: () => Promise<Reply> }
  | { kind: 'modal'; modal: Modal }
  | { kind: 'choices'; choices: { name: string; value: string }[] };

export const reply = (r: Reply): HandlerResult => ({ kind: 'reply', reply: r });
export const ephemeral = (content: string): HandlerResult => ({ kind: 'reply', reply: { content, ephemeral: true } });
