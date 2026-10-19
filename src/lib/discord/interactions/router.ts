/**
 * Dispatch a VERIFIED interaction to its handler and turn the handler's intent into Discord's
 * response shape. The route verifies the signature first; nothing here re-checks it.
 *
 * Returns the immediate response body plus, for a deferred handler, the background work that fills
 * the reply in — the route hands that to `after()`, so it runs once the 3-second acknowledgement is
 * already on its way. Dependencies are injected so the router is tested without a database.
 */

import type { Actor } from './actor';
import { decodeCustomId } from './customId';
import type { CommandHandler, ComponentHandler } from './commands/registry';
import { EPHEMERAL, InteractionType, ResponseType, invokerId, type HandlerResult, type Interaction, type Reply } from './types';

export type RouterDeps = {
  resolveActor(discordUserId: string): Promise<Actor>;
  commands: Map<string, CommandHandler>;
  components: Map<string, ComponentHandler>;
  editReply(applicationId: string, token: string, reply: Reply): Promise<boolean>;
};

export type Routed = { body: Record<string, unknown>; background?: () => Promise<void> };

const SOMETHING_WRONG = 'Something went wrong handling that. Leadership has the logs.';

export async function routeInteraction(interaction: Interaction, deps: RouterDeps): Promise<Routed> {
  if (interaction.type === InteractionType.PING) return { body: { type: ResponseType.PONG } };

  const userId = invokerId(interaction);
  if (!userId) return toResponse(interaction, message('Could not tell who sent that.'), deps);

  let result: HandlerResult;
  try {
    const actor = await deps.resolveActor(userId);
    if (actor.ambiguous) {
      result = message('Your Discord account is linked to more than one ClanOps profile. Ask leadership to fix the link.');
    } else {
      result = await dispatch(interaction, actor, deps);
    }
  } catch (err) {
    console.error(`Discord interaction ${interaction.data?.name ?? interaction.data?.custom_id} failed:`, err);
    result = interaction.type === InteractionType.AUTOCOMPLETE ? { kind: 'choices', choices: [] } : message(SOMETHING_WRONG);
  }
  return toResponse(interaction, result, deps);
}

async function dispatch(interaction: Interaction, actor: Actor, deps: RouterDeps): Promise<HandlerResult> {
  switch (interaction.type) {
    case InteractionType.APPLICATION_COMMAND: {
      const handler = deps.commands.get(interaction.data?.name ?? '');
      return handler ? handler.run(interaction, actor) : message('That command is not available any more.');
    }
    case InteractionType.AUTOCOMPLETE: {
      const handler = deps.commands.get(interaction.data?.name ?? '');
      return handler?.autocomplete ? handler.autocomplete(interaction, actor) : { kind: 'choices', choices: [] };
    }
    case InteractionType.MESSAGE_COMPONENT:
    case InteractionType.MODAL_SUBMIT: {
      const id = decodeCustomId(interaction.data?.custom_id);
      const handler = id && deps.components.get(id.namespace);
      return handler ? handler.run(interaction, actor, id) : message('This button is no longer active.');
    }
    default:
      return message('Unsupported interaction.');
  }
}

function message(content: string): HandlerResult {
  return { kind: 'reply', reply: { content, ephemeral: true } };
}

function data(reply: Reply): Record<string, unknown> {
  const { ephemeral, ...rest } = reply;
  return {
    allowed_mentions: { parse: [] },
    ...rest,
    ...(ephemeral ? { flags: EPHEMERAL } : {}),
  };
}

function toResponse(interaction: Interaction, result: HandlerResult, deps: RouterDeps): Routed {
  switch (result.kind) {
    case 'reply':
      return { body: { type: ResponseType.CHANNEL_MESSAGE, data: data(result.reply) } };
    case 'update':
      return { body: { type: ResponseType.UPDATE_MESSAGE, data: data(result.reply) } };
    case 'choices':
      return { body: { type: ResponseType.AUTOCOMPLETE_RESULT, data: { choices: result.choices.slice(0, 25) } } };
    case 'defer':
      return {
        body: { type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: result.ephemeral ? { flags: EPHEMERAL } : {} },
        background: async () => {
          let reply: Reply;
          try {
            reply = await result.work();
          } catch (err) {
            console.error(`Discord deferred interaction ${interaction.data?.name ?? interaction.data?.custom_id} failed:`, err);
            reply = { content: SOMETHING_WRONG };
          }
          // The ephemeral flag was fixed by the deferral; an edit cannot change it.
          const { ephemeral: _ignored, ...rest } = reply;
          void _ignored;
          await deps.editReply(interaction.application_id, interaction.token, rest);
        },
      };
  }
}
