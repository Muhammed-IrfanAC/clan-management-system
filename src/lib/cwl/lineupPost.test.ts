import { describe, it, expect } from 'vitest';
import { renderLineupSwap, renderRoundLineup } from './lineupPost';
import type { LineupDiff } from './lineup';

const ID = '123456789012345678';

function diff(over: Partial<LineupDiff> = {}): LineupDiff {
  return {
    swappedIn: [{ playerTag: '#IN', name: 'Inny', reason: 'from_bench' }],
    swappedOut: [{ playerTag: '#OUT', name: 'Outy' } as LineupDiff['swappedOut'][number]],
    asPlanned: 14,
    plannedSize: 15,
    actualSize: 15,
    matchesPlan: false,
    ...over,
  };
}

describe('renderRoundLineup', () => {
  it('pings the swapped-in and only names the swapped-out', () => {
    const msg = renderRoundLineup({ clanName: 'Main', roundNumber: 2, diff: diff(), swappedInMentions: [ID] });
    expect(msg.content).toBe(`<@${ID}>`);
    expect(msg.allowed_mentions).toEqual({ users: [ID] });
    const [inField, outField] = msg.embeds![0].fields!;
    expect(inField.value).toBe(`• <@${ID}> (#IN) — from the bench`);
    expect(outField.value).toBe('• Outy (#OUT)');
    expect(msg.embeds![0].title).toBe('🔄 Round 2 — lineup changed');
  });

  it('words a previous-round comparison as a rotation', () => {
    const msg = renderRoundLineup({
      clanName: 'Main', roundNumber: 3, diff: diff(), basis: 'previous_round', swappedInMentions: [null],
    });
    const names = msg.embeds![0].fields!.map((f) => f.name);
    expect(names).toContain('⬆️ Rotated in (1)');
    expect(names).toContain('⬇️ Resting this round (1)');
    expect(msg.content).toBeUndefined();
    expect(msg.allowed_mentions).toEqual({ users: [] });
  });

  it('renders a battle-day countdown, degrading an unparseable time to the raw string', () => {
    const ok = renderRoundLineup({
      clanName: 'Main', roundNumber: 1, diff: diff(), swappedInMentions: [null], startTime: '2026-10-20T10:00:00.000Z',
    });
    const ts = Date.parse('2026-10-20T10:00:00.000Z') / 1000;
    expect(ok.embeds![0].fields!.at(-1)!.value).toBe(`<t:${ts}:f> (<t:${ts}:R>)`);

    const bad = renderRoundLineup({
      clanName: 'Main', roundNumber: 1, diff: diff(), swappedInMentions: [null], startTime: 'garbage',
    });
    expect(bad.embeds![0].fields!.at(-1)!.value).toBe('garbage (garbage)');
  });
});

describe('renderLineupSwap', () => {
  it('is null when nothing changed', () => {
    expect(renderLineupSwap({ clanName: 'Main', roundNumber: 1, swappedIn: [], swappedOut: [], swappedInMentions: [] })).toBeNull();
  });

  it('pings only the swapped-in', () => {
    const msg = renderLineupSwap({
      clanName: 'Main',
      roundNumber: 1,
      swappedIn: [{ playerTag: '#IN', name: 'Inny' }],
      swappedOut: [{ playerTag: '#OUT', name: 'Outy' }],
      swappedInMentions: [ID],
    })!;
    expect(msg.allowed_mentions).toEqual({ users: [ID] });
    expect(msg.embeds![0].fields!.map((f) => f.value)).toEqual([`• <@${ID}> (#IN)`, '• Outy (#OUT)']);
  });
});
