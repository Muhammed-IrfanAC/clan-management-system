import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, bot: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('@/lib/coc-api', () => ({ fetchFromCoCOptional: vi.fn() }));
vi.mock('@/lib/discord', () => ({ discordBotRequest: h.bot }));
vi.mock('@/lib/strikes/commit', () => ({ commitReviewStrike: vi.fn() }));

import type { Actor } from '../actor';
import { decodeCustomId } from '../customId';
import { InteractionType, type HandlerResult, type Interaction } from '../types';
import { renderKickedArrival } from '@/lib/kicks/alertPost';
import { renderUnlinkedJoins } from '@/lib/unlinked/joinPost';
import { renderReviewSuggestion } from '@/lib/strikes/reviewPost';
import { kickButtons } from './kickButtons';
import { reviewButtons } from './reviewButtons';
import { unlinkedLink } from './unlinkedLink';

const LEAD: Actor = { discordUserId: '42', personId: 'pl', displayName: 'Lead', role: 'leader', actorTag: '#LEAD', ambiguous: false };
const MEMBER: Actor = { ...LEAD, role: null };

function click(message: Record<string, unknown>, custom_id: string, over: Partial<Interaction> = {}): Interaction {
  return {
    id: 'i', application_id: 'app', token: 't', type: InteractionType.MESSAGE_COMPONENT, channel_id: 'ch1',
    data: { custom_id }, message: { id: 'm1', ...message }, ...over,
  };
}
const idOf = (custom_id: string) => decodeCustomId(custom_id)!;
const actions = (r: HandlerResult) => {
  const reply = r.kind === 'update' ? r.reply : null;
  return reply?.embeds?.[0].fields?.find((f) => f.name === 'Actions')?.value;
};

beforeEach(() => {
  h.db = createClanOpsDb();
  h.bot.mockReset();
});

describe('review buttons', () => {
  const alert = renderReviewSuggestion({
    suggestionId: 's1', memberName: 'A', playerTag: '#2PP', clanName: 'Alpha', ruleName: 'Hit-up',
    warLabel: null, description: 'd', occurredAt: null,
  });
  const dismiss = alert.components![0].components[1].custom_id;

  it('is for leadership only', async () => {
    const r = await reviewButtons.run(click(alert, dismiss), MEMBER, idOf(dismiss));
    expect(r).toMatchObject({ kind: 'reply', reply: { ephemeral: true } });
  });

  it('stamps an already-settled review with who settled it, instead of acting again', async () => {
    h.db.seed('persons', [{ id: 'p2', display_name: 'Other Lead' }]);
    h.db.seed('player_accounts', [{ player_tag: '#9YY', person_id: 'p2' }]);
    h.db.seed('strike_suggestions', [{ id: 's1', status: 'confirmed', reviewed_by: '#9YY' }]);
    const r = await reviewButtons.run(click(alert, dismiss), LEAD, idOf(dismiss));
    if (r.kind !== 'deferUpdate') throw new Error('expected deferUpdate');
    const reply = await r.work();
    expect(reply.components).toEqual([]);
    expect(reply.embeds![0].fields!.at(-1)!.value).toBe('Already confirmed by Other Lead');
  });
});

describe('kick buttons', () => {
  const alert = renderKickedArrival({
    name: 'Bad', tag: '#2PP', thLevel: 15, clanName: 'Alpha', viaAlt: false, personName: null, kickedName: 'Bad',
    kickedTag: '#2PP', kickedFromClanName: null, kickedAt: '2026-10-01T00:00:00Z', kickedByName: 'Lead', comment: 'x',
  });
  const [handled, remove] = alert.components![0].components.map((c) => c.custom_id);

  it('"Handled" stamps the alert and clears its buttons', async () => {
    const r = await kickButtons.run(click(alert, handled), LEAD, idOf(handled));
    expect(actions(r)).toBe('✅ Handled by <@42>');
    expect(r.kind === 'update' && r.reply.components).toEqual([]);
  });

  it('"Welcome back" asks first, then removes the entry and stamps the original alert', async () => {
    h.db.seed('player_accounts', [{ player_tag: '#2PP' }]);
    h.db.seed('kicked_accounts', [{ player_tag: '#2PP', kicked_by: '#LEAD', kicked_at: '2026-10-01T00:00:00Z' }]);

    const ask = await kickButtons.run(click(alert, remove), LEAD, idOf(remove));
    if (ask.kind !== 'reply') throw new Error('expected a reply');
    expect(ask.reply.ephemeral).toBe(true);
    expect(h.db.rows('kicked_accounts')).toHaveLength(1);

    const confirm = ask.reply.components![0].components[0].custom_id;
    h.bot.mockResolvedValueOnce(alert).mockResolvedValueOnce({});
    const done = await kickButtons.run(click({}, confirm, { message: { id: 'eph' } }), LEAD, idOf(confirm));
    if (done.kind !== 'deferUpdate') throw new Error('expected deferUpdate');
    await done.work();
    expect(h.db.rows('kicked_accounts')).toHaveLength(0);
    expect(h.bot).toHaveBeenNthCalledWith(1, 'GET', '/channels/ch1/messages/m1');
    const patched = h.bot.mock.calls[1][2] as { components: unknown[]; embeds: { fields: { value: string }[] }[] };
    expect(patched.components).toEqual([]);
    expect(patched.embeds[0].fields.at(-1)!.value).toMatch(/removed from the kick list by <@42>/);
  });
});

describe('unlinked link', () => {
  const alert = renderUnlinkedJoins('Alpha', [
    { name: 'Fresh', tag: '#8QQ', thLevel: 14 },
    { name: 'Other', tag: '#9YY', thLevel: null },
  ]);
  const pick = (alert.components![0].components[0] as { custom_id: string }).custom_id;

  it('opens a form for the picked account, prefilled with its name', async () => {
    const r = await unlinkedLink.run(click(alert, pick, { data: { custom_id: pick, values: ['#8QQ'] } }), LEAD, idOf(pick));
    if (r.kind !== 'modal') throw new Error('expected a modal');
    expect(r.modal.title).toBe('Link #8QQ');
    expect(r.modal.inputs[1].value).toBe('Fresh');
  });

  it('links on submit, stamps the alert and leaves the other joiner pickable', async () => {
    h.db.seed('player_accounts', [{ player_tag: '#8QQ', person_id: null }]);
    const submitId = 'unl:v1:link:#8QQ';
    const submit = click(alert, submitId, {
      type: InteractionType.MODAL_SUBMIT,
      data: { custom_id: submitId, components: [{ type: 1, components: [{ type: 4, custom_id: 'new_name', value: 'Fresh Face' }] }] },
    });
    const r = await unlinkedLink.run(submit, LEAD, idOf(submitId));
    expect(actions(r)).toBe('🔗 `#8QQ` linked to **Fresh Face** (new person) by <@42>');
    if (r.kind !== 'update') throw new Error('expected update');
    const select = r.reply.components![0].components[0] as { options: { value: string }[] };
    expect(select.options.map((o) => o.value)).toEqual(['#9YY']);
    expect(h.db.find('player_accounts', '#8QQ')!.person_id).toBeTruthy();
  });

  it('tells the leader privately when the account was linked meanwhile', async () => {
    h.db.seed('persons', [{ id: 'p1', display_name: 'Bob' }]);
    h.db.seed('player_accounts', [{ player_tag: '#8QQ', person_id: 'p1' }]);
    const submitId = 'unl:v1:link:#8QQ';
    const r = await unlinkedLink.run(
      click(alert, submitId, { type: InteractionType.MODAL_SUBMIT, data: { custom_id: submitId, components: [] } }), LEAD, idOf(submitId));
    expect(r).toMatchObject({ kind: 'reply', reply: { ephemeral: true, content: expect.stringMatching(/already linked/) } });
  });
});
