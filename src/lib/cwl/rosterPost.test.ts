import { describe, it, expect } from 'vitest';
import {
  renderClanRoster,
  renderTransferCalls,
  renderLeadershipDigest,
  type RosterEntry,
  type TransferMove,
} from './rosterPost';

function entry(over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    playerTag: '#AAA',
    name: 'Player',
    thLevel: 16,
    isBench: false,
    rank: 1,
    ...over,
  };
}

function fieldNames(msg: ReturnType<typeof renderClanRoster>): string[] {
  return (msg.embeds?.[0].fields || []).map((f) => f.name);
}

describe('renderClanRoster', () => {
  it('separates lineup from bench and orders both by engine rank', () => {
    const msg = renderClanRoster({
      seasonLabel: 'February 2026',
      clanName: 'Warriors',
      warSize: 2,
      entries: [
        entry({ name: 'Second', rank: 2 }),
        entry({ name: 'First', rank: 1 }),
        entry({ name: 'Benched', rank: 3, isBench: true }),
      ],
    });

    const fields = msg.embeds![0].fields!;
    expect(fields[0].name).toBe('Lineup — 2/2');
    expect(fields[0].value.indexOf('First')).toBeLessThan(fields[0].value.indexOf('Second'));
    expect(fields[1].name).toBe('Bench — 1');
    expect(fields[1].value).toContain('Benched');
  });

  it('carries name and town hall only — league per line is what made it a wall', () => {
    const msg = renderClanRoster({
      seasonLabel: 'S', clanName: 'W', warSize: 1,
      entries: [entry({ name: 'Solo', thLevel: 15 })],
    });
    const value = msg.embeds![0].fields![0].value;
    expect(value).toContain('Solo');
    expect(value).toContain('TH15');
    expect(value).not.toContain('·');
    expect(value).not.toContain('—');
  });

  it('aligns the town hall column across lineup and bench', () => {
    const msg = renderClanRoster({
      seasonLabel: 'S', clanName: 'W', warSize: 1,
      entries: [
        entry({ name: 'Short', rank: 1 }),
        entry({ name: 'A Much Longer Name', rank: 2, isBench: true }),
      ],
    });
    const [lineup, bench] = msg.embeds![0].fields!;
    // Same width in both blocks, so the two code blocks read as one continuous table.
    expect(lineup.value.split('\n')[1].indexOf('TH16')).toBe(bench.value.split('\n')[1].indexOf('TH16'));
  });

  it('flags a clan that is short of a full lineup', () => {
    const msg = renderClanRoster({
      seasonLabel: 'S', clanName: 'Academy', warSize: 15,
      entries: [entry({ name: 'Only' })],
    });
    expect(msg.embeds![0].description).toContain('14 short');
    expect(msg.embeds![0].fields![0].name).toBe('Lineup — 1/15');
    expect(msg.embeds![0].color).toBe(0xf59e0b);
  });

  it('is green and says nothing about being short when the lineup is full', () => {
    const msg = renderClanRoster({
      seasonLabel: 'S', clanName: 'Warriors', warSize: 1,
      entries: [entry({ name: 'Only' })],
    });
    expect(msg.embeds![0].description).toBeUndefined();
    expect(msg.embeds![0].color).toBe(0x22c55e);
  });

  it('splits a long lineup across fields rather than overflowing Discord’s 1024-char limit', () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry({ name: `A Realistically Long Player Name ${i}`, rank: i + 1, playerTag: `#T${i}` }),
    );
    const msg = renderClanRoster({ seasonLabel: 'S', clanName: 'Warriors', warSize: 30, entries });
    const fields = msg.embeds![0].fields!;
    for (const f of fields) expect(f.value.length).toBeLessThanOrEqual(1024);
    // Every name survives the split — the point of splitting rather than truncating.
    const all = fields.map((f) => f.value).join('\n');
    for (const e of entries) expect(all).toContain(e.name);
    expect(fieldNames(msg)).toContain('Lineup — 30/30 (cont.)');
    // Each chunk is independently fenced, or the second one renders as prose.
    for (const f of fields) expect(f.value.startsWith('```\n')).toBe(true);
  });

  it('neutralises a backtick in a name so it cannot break out of the code block', () => {
    const msg = renderClanRoster({
      seasonLabel: 'S', clanName: 'W', warSize: 1,
      entries: [entry({ name: 'Ba`ck' })],
    });
    const value = msg.embeds![0].fields![0].value;
    expect(value).toContain("Ba'ck");
    expect(value.match(/```/g)).toHaveLength(2); // opening and closing fence only
  });

  it('never pings — a roster list is information, not a call to action', () => {
    const msg = renderClanRoster({ seasonLabel: 'S', clanName: 'W', warSize: 1, entries: [entry()] });
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.content).toBeUndefined();
  });

  it('renders an empty allocation without inventing rows', () => {
    const msg = renderClanRoster({ seasonLabel: 'S', clanName: 'W', warSize: 15, entries: [] });
    expect(msg.embeds![0].fields![0].value).toContain('No accounts allocated');
  });
});

describe('renderTransferCalls', () => {
  const moves: TransferMove[] = [
    { name: 'Mover', playerTag: '#M', mentionId: '111', fromClanId: 'c1', fromClanName: 'Reborn', toClanName: 'Warriors' },
    { name: 'Second', playerTag: '#S', mentionId: '222', fromClanId: 'c1', fromClanName: 'Reborn', toClanName: 'Academy' },
    { name: 'Elsewhere', playerTag: '#E', mentionId: '333', fromClanId: 'c2', fromClanName: 'Academy', toClanName: 'Warriors' },
    { name: 'NoDiscord', playerTag: '#N', mentionId: null, fromClanId: null, fromClanName: null, toClanName: 'Academy' },
  ];

  it('splits into one message per source clan, unrouted movers last', () => {
    const groups = renderTransferCalls({ seasonLabel: 'S', moves });
    expect(groups.map((g) => g.fromClanId)).toEqual(['c1', 'c2', null]);
    expect(groups[0].message.content).toContain('moving out of **Reborn**');
    expect(groups[0].message.content).toContain('2 accounts');
  });

  it('pings only the movers in that clan — a message never mentions another clan’s people', () => {
    const [reborn, academy] = renderTransferCalls({ seasonLabel: 'S', moves });
    expect(reborn.message.allowed_mentions).toEqual({ users: ['111', '222'] });
    expect(reborn.message.content).not.toContain('333');
    expect(academy.message.allowed_mentions).toEqual({ users: ['333'] });
  });

  it('puts the mentions in content and uses no embed — an embedded mention never notifies', () => {
    const [first] = renderTransferCalls({ seasonLabel: 'S', moves });
    expect(first.message.embeds).toBeUndefined();
    expect(first.message.content).toContain('<@111> **Mover** → **Warriors**');
  });

  it('names an account with no linked Discord instead of dropping it', () => {
    const groups = renderTransferCalls({ seasonLabel: 'S', moves });
    const last = groups[groups.length - 1].message;
    expect(last.content).toContain('**NoDiscord** → **Academy**');
    expect(last.content).toContain('needs to join a clan');
    expect(last.allowed_mentions).toEqual({ users: [] });
  });

  it('sends nothing at all when nothing has to move', () => {
    expect(renderTransferCalls({ seasonLabel: 'S', moves: [] })).toEqual([]);
  });

  it('stays inside Discord’s 2000-char content limit and says how many it dropped', () => {
    const many: TransferMove[] = Array.from({ length: 120 }, (_, i) => ({
      name: `A Realistically Long Player Name ${i}`,
      playerTag: `#T${i}`,
      mentionId: `${100000000000000000 + i}`,
      fromClanId: 'c1',
      fromClanName: 'Some Feeder Clan',
      toClanName: 'The Flagship Clan',
    }));
    const [group] = renderTransferCalls({ seasonLabel: 'S', moves: many });
    expect(group.message.content!.length).toBeLessThanOrEqual(2000);
    expect(group.message.content).toContain('more — see the roster board');
  });
});

describe('renderLeadershipDigest', () => {
  const clans = [
    { clanName: 'Warriors', warSize: 30, lineupCount: 30, benchCount: 4 },
    { clanName: 'Academy', warSize: 30, lineupCount: 22, benchCount: 0 },
  ];

  it('calls out clans the waterfall left short', () => {
    const msg = renderLeadershipDigest({ seasonLabel: 'S', clans, unassigned: 6, pendingMoves: 3 });
    expect(msg.embeds![0].description).toContain('SHORT 8');
    expect(msg.embeds![0].fields![0].value).toContain('**1** clan short');
    expect(msg.embeds![0].color).toBe(0xf59e0b);
  });

  it('reports a clean fill without a warning', () => {
    const msg = renderLeadershipDigest({
      seasonLabel: 'S',
      clans: [clans[0]],
      unassigned: 0,
      pendingMoves: 0,
    });
    expect(msg.embeds![0].fields![0].value).toContain('Every clan has a full lineup');
    expect(msg.embeds![0].description).not.toContain('SHORT');
  });

  it('pads clan names so the table reads as columns', () => {
    const msg = renderLeadershipDigest({ seasonLabel: 'S', clans, unassigned: 0, pendingMoves: 0 });
    const [first, second] = msg.embeds![0].description!.split('\n').slice(1, 3);
    expect(first.indexOf('30/30')).toBe(second.indexOf('22/30'));
  });
});
