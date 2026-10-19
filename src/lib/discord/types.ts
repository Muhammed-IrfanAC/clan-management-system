/**
 * Discord message shapes. Dependency-free so pure renderers, their tests and client components (the
 * roster-post preview) can import them without pulling in the Supabase client behind the transport.
 */

export type DiscordEmbedField = { name: string; value: string; inline?: boolean };

export type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  timestamp?: string;
  footer?: { text: string };
};

/**
 * Message components (buttons, selects). INTERACTIVE ones work only on a message the bot posted:
 * a channel webhook cannot carry them, so the transport strips `components` from every webhook send,
 * and a renderer that offers buttons must still read correctly without them.
 */
export const ButtonStyle = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4 } as const;

export type DiscordButton = {
  type: 2;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  label: string;
  custom_id: string;
  emoji?: { name: string };
  disabled?: boolean;
};

export type DiscordSelectOption = { label: string; value: string; description?: string };

export type DiscordStringSelect = {
  type: 3;
  custom_id: string;
  placeholder?: string;
  options: DiscordSelectOption[];
  min_values?: number;
  max_values?: number;
};

/** Discord's own member picker (searchable); the chosen user ids arrive in `data.values`. */
export type DiscordUserSelect = {
  type: 5;
  custom_id: string;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
};

export type DiscordActionRow = { type: 1; components: Array<DiscordButton | DiscordStringSelect | DiscordUserSelect> };

/** The editable part of a webhook message — what a pure renderer produces. Deliberately excludes
 * `username`: Discord's message-EDIT endpoint accepts only content/embeds/allowed_mentions, so a
 * payload that carries a username cannot be replayed as an edit. */
export type DiscordMessage = {
  content?: string;
  embeds?: DiscordEmbed[];
  // Restrict which mentions actually ping. Defaults to none so stray text can't mass-ping.
  allowed_mentions?: { parse?: Array<'users' | 'roles' | 'everyone'>; users?: string[]; roles?: string[] };
  /** Bot sends only — dropped on the way to a webhook (see DiscordActionRow). */
  components?: DiscordActionRow[];
};

/**
 * What KIND of message is being routed. 'default' is everything addressed to particular people — a
 * strike, a transfer call, a round-reveal notice — and goes to the clan channel they read.
 * 'announcement' is a standing post for the whole family (the CWL roster) and goes to the
 * announcement channel when one is configured. 'leadership' is for leadership's eyes only (a kicked
 * player rejoining) and goes to the leadership channel when one is configured. 'unlinked' is the
 * unlinked-player join alert: its own channel if set, else the leadership channel — it is a call to
 * leadership too, so it should not leak into a clan channel just because it has no channel yet.
 */
export type ChannelPurpose = 'default' | 'announcement' | 'leadership' | 'unlinked';

/**
 * Where a message is delivered: a channel the BOT posts to (by id, with DISCORD_BOT_TOKEN), or a
 * webhook. Routing resolves one; the transport sends to either. A message posted one way can only be
 * edited the same way, which the living-message fallback absorbs (see postOrEditDiscordMessage).
 */
export type Destination =
  | { kind: 'channel'; channelId: string }
  | { kind: 'webhook'; url: string };
