/**
 * The interaction entry point the route calls: the router wired to the real actor lookup, the
 * handler registries and the transport.
 */

import { editInteractionReply, sendInteractionFollowUp } from '../transport';
import { resolveActor } from './actor';
import { kickButtons } from './commands/kickButtons';
import { link } from './commands/link';
import { me } from './commands/me';
import { indexBy, type ComponentHandler } from './commands/registry';
import { reviewButtons } from './commands/reviewButtons';
import { unlinkedLink } from './commands/unlinkedLink';
import { whois } from './commands/whois';
import { routeInteraction, type Routed } from './router';
import type { Interaction } from './types';

const commands = indexBy([me, whois, link], 'name');
const components = indexBy<ComponentHandler, 'namespace'>([reviewButtons, kickButtons, unlinkedLink], 'namespace');

export function handleInteraction(interaction: Interaction): Promise<Routed> {
  return routeInteraction(interaction, {
    resolveActor,
    commands,
    components,
    editReply: editInteractionReply,
    followUp: sendInteractionFollowUp,
  });
}

export { verifyInteraction } from './verify';
export type { Interaction } from './types';
