/**
 * The interaction entry point the route calls: the router wired to the real actor lookup, the
 * handler registries and the transport.
 */

import { editInteractionReply } from '../transport';
import { resolveActor } from './actor';
import { me } from './commands/me';
import { indexBy, type ComponentHandler } from './commands/registry';
import { whois } from './commands/whois';
import { routeInteraction, type Routed } from './router';
import type { Interaction } from './types';

const commands = indexBy([me, whois], 'name');
const components = indexBy<ComponentHandler, 'namespace'>([], 'namespace');

export function handleInteraction(interaction: Interaction): Promise<Routed> {
  return routeInteraction(interaction, { resolveActor, commands, components, editReply: editInteractionReply });
}

export { verifyInteraction } from './verify';
export type { Interaction } from './types';
