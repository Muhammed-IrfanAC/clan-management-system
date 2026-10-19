import { describe, it, expect, vi } from 'vitest';
import type { Actor } from './actor';
import type { CommandHandler, ComponentHandler } from './commands/registry';
import { routeInteraction, type RouterDeps } from './router';
import { EPHEMERAL, InteractionType, ResponseType, type Interaction } from './types';

const LEADER: Actor = { discordUserId: 'u1', personId: 'p1', displayName: 'Lead', role: 'leader', actorTag: '#L', ambiguous: false };

function interaction(over: Partial<Interaction> = {}): Interaction {
  return {
    id: 'i1',
    application_id: 'app',
    type: InteractionType.APPLICATION_COMMAND,
    token: 'tok',
    member: { user: { id: 'u1', username: 'lead' } },
    data: { name: 'echo' },
    ...over,
  };
}

function deps(over: Partial<RouterDeps> = {}): RouterDeps {
  const echo: CommandHandler = {
    name: 'echo',
    run: async (_i, actor) => ({ kind: 'reply', reply: { content: `hi ${actor.displayName}`, ephemeral: true } }),
    autocomplete: async () => ({ kind: 'choices', choices: Array.from({ length: 30 }, (_, n) => ({ name: `${n}`, value: `${n}` })) }),
  };
  const slow: CommandHandler = {
    name: 'slow',
    run: async () => ({ kind: 'defer', ephemeral: true, work: async () => ({ content: 'done', ephemeral: true }) }),
  };
  const broken: CommandHandler = { name: 'broken', run: async () => { throw new Error('boom'); } };
  const button: ComponentHandler = {
    namespace: 'btn',
    run: async (_i, _a, id) => {
      if (id.args[0] === 'slow') return { kind: 'deferUpdate', work: async () => ({ content: 'stamped', components: [] }) };
      if (id.args[0] === 'crash') return { kind: 'deferUpdate', work: async () => { throw new Error('boom'); } };
      if (id.args[0] === 'form') {
        return { kind: 'modal', modal: { customId: 'btn:v1:submit', title: 'Form', inputs: [{ customId: 'name', label: 'Name', value: 'Bob' }] } };
      }
      return { kind: 'update', reply: { content: `clicked ${id.args.join(',')}` } };
    },
  };
  return {
    resolveActor: vi.fn(async () => LEADER),
    commands: new Map([echo, slow, broken].map((c) => [c.name, c])),
    components: new Map([[button.namespace, button]]),
    editReply: vi.fn(async () => true),
    followUp: vi.fn(async () => true),
    ...over,
  };
}

describe('routeInteraction', () => {
  it('answers a PING without resolving anyone', async () => {
    const d = deps();
    expect((await routeInteraction(interaction({ type: InteractionType.PING }), d)).body).toEqual({ type: ResponseType.PONG });
    expect(d.resolveActor).not.toHaveBeenCalled();
  });

  it('replies to a command, as the resolved actor, with mentions off', async () => {
    const { body, background } = await routeInteraction(interaction(), deps());
    expect(body).toEqual({
      type: ResponseType.CHANNEL_MESSAGE,
      data: { allowed_mentions: { parse: [] }, content: 'hi Lead', flags: EPHEMERAL },
    });
    expect(background).toBeUndefined();
  });

  it('defers, then fills the reply in from the background work', async () => {
    const d = deps();
    const { body, background } = await routeInteraction(interaction({ data: { name: 'slow' } }), d);
    expect(body).toEqual({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } });
    await background!();
    expect(d.editReply).toHaveBeenCalledWith('app', 'tok', { content: 'done' });
  });

  it('turns a handler crash into a polite ephemeral reply', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { body } = await routeInteraction(interaction({ data: { name: 'broken' } }), deps());
    expect((body.data as { flags: number }).flags).toBe(EPHEMERAL);
    expect((body.data as { content: string }).content).toMatch(/Something went wrong/);
  });

  it('refuses an actor linked to two profiles before any handler runs', async () => {
    const run = vi.fn();
    const d = deps({
      resolveActor: async () => ({ ...LEADER, ambiguous: true }),
      commands: new Map([['echo', { name: 'echo', run }]]),
    });
    const { body } = await routeInteraction(interaction(), d);
    expect(run).not.toHaveBeenCalled();
    expect((body.data as { content: string }).content).toMatch(/more than one/);
  });

  it('caps autocomplete at 25 choices', async () => {
    const { body } = await routeInteraction(interaction({ type: InteractionType.AUTOCOMPLETE }), deps());
    expect(body.type).toBe(ResponseType.AUTOCOMPLETE_RESULT);
    expect((body.data as { choices: unknown[] }).choices).toHaveLength(25);
  });

  it('routes a button by namespace, and retires an unknown one', async () => {
    const click = (custom_id: string) =>
      routeInteraction(interaction({ type: InteractionType.MESSAGE_COMPONENT, data: { custom_id } }), deps());
    expect((await click('btn:v1:a:b')).body).toEqual({
      type: ResponseType.UPDATE_MESSAGE,
      data: { allowed_mentions: { parse: [] }, content: 'clicked a,b' },
    });
    expect(((await click('gone:v1')).body.data as { content: string }).content).toMatch(/no longer active/);
  });

  it('acknowledges a slow click, then edits the clicked message', async () => {
    const d = deps();
    const { body, background } = await routeInteraction(
      interaction({ type: InteractionType.MESSAGE_COMPONENT, data: { custom_id: 'btn:v1:slow' } }), d);
    expect(body).toEqual({ type: ResponseType.DEFERRED_UPDATE_MESSAGE });
    await background!();
    expect(d.editReply).toHaveBeenCalledWith('app', 'tok', { content: 'stamped', components: [] });
  });

  it('leaves the clicked message alone when the deferred work fails, and tells the clicker', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps();
    const { background } = await routeInteraction(
      interaction({ type: InteractionType.MESSAGE_COMPONENT, data: { custom_id: 'btn:v1:crash' } }), d);
    await background!();
    expect(d.editReply).not.toHaveBeenCalled();
    expect(d.followUp).toHaveBeenCalledWith('app', 'tok', expect.objectContaining({ ephemeral: true }));
  });

  it('opens a modal with one text input per row', async () => {
    const { body } = await routeInteraction(
      interaction({ type: InteractionType.MESSAGE_COMPONENT, data: { custom_id: 'btn:v1:form' } }), deps());
    expect(body).toEqual({
      type: ResponseType.MODAL,
      data: {
        custom_id: 'btn:v1:submit',
        title: 'Form',
        components: [{ type: 1, components: [{ type: 4, custom_id: 'name', label: 'Name', style: 1, required: false, value: 'Bob' }] }],
      },
    });
  });
});
