/**
 * Handler registries: slash commands by name, components (buttons, selects, modals) by custom-id
 * namespace. Adding a feature = one handler file + one line here (+ a definition, for a command).
 */

import type { Actor } from '../actor';
import type { HandlerResult, Interaction } from '../types';

export type CommandHandler = {
  name: string;
  run(interaction: Interaction, actor: Actor): Promise<HandlerResult>;
  autocomplete?(interaction: Interaction, actor: Actor): Promise<HandlerResult>;
};

export type ComponentHandler = {
  namespace: string;
  run(interaction: Interaction, actor: Actor, id: { version: number; args: string[] }): Promise<HandlerResult>;
};

export function indexBy<T, K extends keyof T>(items: T[], key: K): Map<T[K], T> {
  return new Map(items.map((item) => [item[key], item]));
}
