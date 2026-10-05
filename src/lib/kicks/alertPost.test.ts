import { describe, it, expect } from 'vitest';
import { renderKickedArrival, type KickedArrivalPost } from './alertPost';

function post(over: Partial<KickedArrivalPost> = {}): KickedArrivalPost {
  return {
    name: 'Bob',
    tag: '#B1',
    thLevel: 15,
    clanName: 'Feeder',
    viaAlt: false,
    personName: 'Bob',
    kickedName: 'Bob',
    kickedTag: '#B1',
    kickedFromClanName: 'Main',
    kickedAt: '2026-10-01T10:00:00.000Z',
    kickedByName: 'Alice',
    comment: 'Ignored war calls twice',
    ...over,
  };
}

describe('renderKickedArrival', () => {
  it('says who joined where, when and why they were kicked, and pings nobody', () => {
    const msg = renderKickedArrival(post());
    const embed = msg.embeds![0];
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.content).toBeUndefined();
    expect(embed.title).toBe('⛔ Kicked player joined Feeder');
    expect(embed.description).toContain('**Bob** `#B1` (TH15) is back in **Feeder**');
    expect(embed.fields).toEqual([
      { name: 'Kicked', value: `<t:${Date.parse('2026-10-01T10:00:00.000Z') / 1000}:D> from Main by Alice`, inline: false },
      { name: 'Reason', value: 'Ignored war calls twice', inline: false },
    ]);
  });

  it('names the person and the kicked account when an alt is what joined', () => {
    const embed = renderKickedArrival(post({ name: 'Bobby', tag: '#B2', viaAlt: true })).embeds![0];
    expect(embed.title).toBe('⛔ Alt of a kicked player joined Feeder');
    expect(embed.description).toContain('**Bobby** `#B2`');
    expect(embed.description).toContain('alt of **Bob**, whose account **Bob** `#B1` is on the kick list');
  });

  it('copes with no reason and no source clan', () => {
    const embed = renderKickedArrival(post({ comment: '  ', kickedFromClanName: null })).embeds![0];
    expect(embed.fields![0].value).not.toContain(' from ');
    expect(embed.fields![1].value).toBe('_No comment recorded._');
  });

  it('escapes markdown in player names and keeps a long reason inside the field limit', () => {
    const embed = renderKickedArrival(post({ name: '*star*_x_', comment: 'x'.repeat(2000) })).embeds![0];
    expect(embed.description).toContain('**\\*star\\*\\_x\\_**');
    expect(embed.fields![1].value).toHaveLength(1024);
  });
});
