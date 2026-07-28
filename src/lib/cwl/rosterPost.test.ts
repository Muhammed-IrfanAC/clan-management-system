import { describe, it, expect } from 'vitest';
import {
  renderClanRoster,
  renderTransferCall,
  renderLeadershipDigest,
  type RosterEntry,
} from './rosterPost';

function entry(over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    playerTag: '#AAA',
    name: 'Player',
    thLevel: 16,
    leagueTier: null,
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
    expect(fields[0].name).toBe('Lineup (2)');
    expect(fields[0].value.indexOf('First')).toBeLessThan(fields[0].value.indexOf('Second'));
    expect(fields[1].name).toBe('Bench (1)');
    expect(fields[1].value).toContain('Benched');
  });

  it('flags a clan that is short of a full lineup', () => {
    const msg = renderClanRoster({
      seasonLabel: 'S', clanName: 'Academy', warSize: 15,
      entries: [entry({ name: 'Only' })],
    });
    expect(msg.embeds![0].description).toContain('14 short');
    expect(msg.embeds![0].color).toBe(0xf59e0b);
  });

  it('is green and says nothing about being short when the lineup is full', () => {
    const msg = renderClanRoster({
      seasonLabel: 'S', clanName: 'Warriors', warSize: 1,
      entries: [entry({ name: 'Only' })],
    });
    expect(msg.embeds![0].description).not.toContain('short');
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
    expect(fieldNames(msg)).toContain('Lineup (30) (cont.)');
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

describe('renderTransferCall', () => {
  const moves = [
    { name: 'Mover', playerTag: '#M', mentionId: '111', fromClanName: 'Reborn', toClanName: 'Warriors' },
    { name: 'NoDiscord', playerTag: '#N', mentionId: null, fromClanName: null, toClanName: 'Academy' },
  ];

  it('pings exactly the accounts being asked to move, and nobody else', () => {
    const msg = renderTransferCall({ seasonLabel: 'S', moves });
    expect(msg.allowed_mentions).toEqual({ users: ['111'] });
    expect(msg.content).toBe('<@111>');
  });

  it('names an account with no linked Discord instead of dropping it', () => {
    const msg = renderTransferCall({ seasonLabel: 'S', moves });
    const value = msg.embeds![0].fields![0].value;
    expect(value).toContain('<@111>');
    expect(value).toContain('**NoDiscord**');
    expect(value).toContain('Reborn → **Warriors**');
  });

  it('says so plainly when nothing needs to move, and pings nobody', () => {
    const msg = renderTransferCall({ seasonLabel: 'S', moves: [] });
    expect(msg.embeds![0].title).toContain('no moves needed');
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.content).toBeUndefined();
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
