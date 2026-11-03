import { describe, it, expect } from 'vitest';
import { renderLineupPost, type LineupPostInput } from './nextLineupPost';

function input(over: Partial<LineupPostInput> = {}): LineupPostInput {
  return {
    clanName: '9-1',
    seasonLabel: '2026-11',
    roundNumber: 3,
    opponentName: 'Red Giant',
    enemyKnown: true,
    warSize: 2,
    lineup: [
      { mapPosition: 2, name: 'Bravo', thLevel: 16, enemyTh: 16, mentionId: '111111111111111111' },
      { mapPosition: 1, name: 'Alpha', thLevel: 17, enemyTh: 18, mentionId: null },
    ],
    bench: ['Charlie'],
    ping: true,
    ...over,
  };
}

describe('renderLineupPost', () => {
  it('puts mentions in the content (embeds never notify) and only for linked players', () => {
    const msg = renderLineupPost(input());
    expect(msg.content).toContain('War 3 vs Red Giant');
    expect(msg.content).toContain('<@111111111111111111>');
    expect(msg.allowed_mentions).toEqual({ parse: [], users: ['111111111111111111'] });
    expect(JSON.stringify(msg.embeds)).not.toContain('<@');
  });

  it('lists the lineup in map order with the mirror base, and the bench by name', () => {
    const embed = renderLineupPost(input()).embeds![0];
    const table = embed.fields![0].value;
    expect(table.indexOf('Alpha')).toBeLessThan(table.indexOf('Bravo'));
    expect(table).toContain('→ TH18');
    expect(embed.fields![1]).toEqual({ name: 'Sitting out — 1', value: 'Charlie' });
  });

  it('pings nobody when ping is off', () => {
    const msg = renderLineupPost(input({ ping: false }));
    expect(msg.content).not.toContain('<@');
    expect(msg.allowed_mentions!.users).toEqual([]);
  });

  it('marks a lineup provisional before the opponent is drawn, and flags a short one', () => {
    const embed = renderLineupPost(input({ enemyKnown: false, opponentName: null, warSize: 3 })).embeds![0];
    expect(embed.title).toBe('War 3 lineup');
    expect(embed.description).toMatch(/provisional/);
    expect(embed.description).toMatch(/1 short/);
  });

  it('splits a 30v30 table across fields under the embed limit', () => {
    const lineup = Array.from({ length: 30 }, (_, i) => ({
      mapPosition: i + 1, name: `Player with a long name ${i}`, thLevel: 17, enemyTh: 17, mentionId: null,
    }));
    const fields = renderLineupPost(input({ lineup, warSize: 30 })).embeds![0].fields!;
    const lineupFields = fields.filter((f) => f.name.startsWith('Lineup'));
    expect(lineupFields.length).toBeGreaterThan(1);
    expect(lineupFields.every((f) => f.value.length <= 1024)).toBe(true);
    // Spread evenly: no field ends up with a lone straggler row.
    const rowsPer = lineupFields.map((f) => f.value.split('\n').length - 2);
    expect(Math.max(...rowsPer) - Math.min(...rowsPer)).toBeLessThanOrEqual(1);
    expect(lineupFields.map((f) => f.value).join('').match(/TH17  →/g)).toHaveLength(30);
  });

  it('escapes Discord markdown in names outside the code fence', () => {
    const msg = renderLineupPost(input({ opponentName: '__Red*Giant__', bench: ['*Bob*'] }));
    expect(msg.content).toContain('\\_\\_Red\\*Giant\\_\\_');
    expect(msg.embeds![0].fields![1].value).toBe('\\*Bob\\*');
    // Embed titles render no markdown, so they carry the name as written.
    expect(msg.embeds![0].title).toBe('War 3 lineup vs __Red*Giant__');
  });
});
