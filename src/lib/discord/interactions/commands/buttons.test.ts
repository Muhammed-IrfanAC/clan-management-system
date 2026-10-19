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
import { link as linkCommand } from './link';
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
    { name: 'Bob alt', tag: '#8QQ', thLevel: 14 },
    { name: 'Other', tag: '#9YY', thLevel: null },
  ]);
  const pickId = (alert.components![0].components[0] as { custom_id: string }).custom_id;
  const pickClick = (tag: string) => click(alert, pickId, { data: { custom_id: pickId, values: [tag] } });

  beforeEach(() => {
    h.db.seed('persons', [{ id: 'p1', display_name: 'Bob', discord_user_id: null }]);
    h.db.seed('player_accounts', [
      { player_tag: '#2PP', person_id: 'p1', in_game_name: 'Bob' },
      { player_tag: '#8QQ', person_id: null, in_game_name: 'Bob alt' },
      { player_tag: '#9YY', person_id: null, in_game_name: 'Other' },
    ]);
  });

  it('opens a private panel suggesting the likely owner', async () => {
    const r = await unlinkedLink.run(pickClick('#8QQ'), LEAD, idOf(pickId));
    if (r.kind !== 'reply') throw new Error('expected a reply');
    expect(r.reply.ephemeral).toBe(true);
    const [suggested, byDiscord, fresh] = r.reply.components!.map((row) => row.components[0]);
    expect(suggested).toMatchObject({ type: 2, label: 'Alt of Bob', custom_id: 'unl:v1:alt:#8QQ:p1:m1' });
    expect(byDiscord).toMatchObject({ type: 5, custom_id: 'unl:v1:altdc:#8QQ:m1' });
    expect(fresh).toMatchObject({ type: 2, label: 'New person: Bob alt', custom_id: 'unl:v1:new:#8QQ:m1' });
  });

  it('a suggestion click links, stamps the alert and offers the person’s Discord', async () => {
    h.bot.mockResolvedValueOnce(alert).mockResolvedValueOnce({});
    const altId = 'unl:v1:alt:#8QQ:p1:m1';
    const r = await unlinkedLink.run(click({ content: 'panel' }, altId, { message: { id: 'eph' } }), LEAD, idOf(altId));
    if (r.kind !== 'deferUpdate') throw new Error('expected deferUpdate');
    const panel = await r.work();
    expect(h.db.find('player_accounts', '#8QQ')!.person_id).toBe('p1');
    expect(panel.content).toMatch(/linked to \*\*Bob\*\* as an alt/);
    expect(panel.components![0].components[0]).toMatchObject({ type: 5, custom_id: 'unl:v1:dc:p1' });

    const patched = h.bot.mock.calls[1][2] as { components: { components: { options: { value: string }[] }[] }[]; embeds: { fields: { name: string; value: string }[] }[] };
    expect(patched.embeds[0].fields.at(-1)!.value).toBe('🔗 `#8QQ` linked to **Bob** as an alt by <@42>');
    expect(patched.components[0].components[0].options.map((o) => o.value)).toEqual(['#9YY']);
  });

  it('links by the owner’s Discord, and keeps the panel when that Discord is nobody', async () => {
    h.bot.mockResolvedValue(null); // alert edit is best-effort
    const id = 'unl:v1:altdc:#8QQ:m1';
    const choose = (user: string) => click({ content: 'panel', components: [] }, id, { data: { custom_id: id, values: [user] }, message: { id: 'eph', content: 'panel', components: [] } });

    const miss = await unlinkedLink.run(choose('333333333333333333'), LEAD, idOf(id));
    if (miss.kind !== 'deferUpdate') throw new Error('expected deferUpdate');
    expect((await miss.work()).content).toMatch(/^⚠️ <@333333333333333333> is not linked to anyone[\s\S]*panel$/);

    h.db.rows('persons')[0].discord_user_id = '444444444444444444';
    const hit = await unlinkedLink.run(choose('444444444444444444'), LEAD, idOf(id));
    if (hit.kind !== 'deferUpdate') throw new Error('expected deferUpdate');
    expect((await hit.work()).content).toMatch(/Their Discord is <@444444444444444444>/);
    expect(h.db.find('player_accounts', '#8QQ')!.person_id).toBe('p1');
  });

  it('stamps the alert instead of opening a panel when the account was linked meanwhile', async () => {
    h.db.find('player_accounts', '#8QQ')!.person_id = 'p1';
    const r = await unlinkedLink.run(pickClick('#8QQ'), LEAD, idOf(pickId));
    expect(actions(r)).toBe('🔗 `#8QQ` was already linked to **Bob**');
  });

  it('links a Discord to the new person', async () => {
    const id = 'unl:v1:dc:p1';
    const r = await unlinkedLink.run(click({}, id, { data: { custom_id: id, values: ['555555555555555555'] } }), LEAD, idOf(id));
    if (r.kind !== 'deferUpdate') throw new Error('expected deferUpdate');
    expect((await r.work()).content).toMatch(/now linked to <@555555555555555555>/);
  });
});

describe('/link', () => {
  const run = (options: { name: string; value: string }[], actor = LEAD) =>
    linkCommand.run({ id: 'i', application_id: 'app', token: 't', type: InteractionType.APPLICATION_COMMAND, data: { name: 'link', options: options.map((o) => ({ ...o, type: 3 })) } }, actor);

  it('is for leadership, and wants a person picked from the suggestions', async () => {
    expect(await run([{ name: 'account', value: '#8QQ' }], MEMBER)).toMatchObject({ kind: 'reply', reply: { ephemeral: true } });
    expect(await run([{ name: 'account', value: '#8QQ' }, { name: 'person', value: 'bob' }])).toMatchObject({
      kind: 'reply', reply: { content: expect.stringMatching(/from the suggestions/) },
    });
  });

  it('with no person, makes a new one named after the account and offers their Discord', async () => {
    h.db.seed('player_accounts', [{ player_tag: '#8QQ', person_id: null, in_game_name: 'Fresh' }]);
    const r = await run([{ name: 'account', value: '8qq' }]);
    if (r.kind !== 'defer') throw new Error('expected defer');
    const reply = await r.work();
    expect(reply.content).toMatch(/`#8QQ` is linked to \*\*Fresh\*\* \(new person\)/);
    expect(reply.components![0].components[0]).toMatchObject({ type: 5 });
  });
});
