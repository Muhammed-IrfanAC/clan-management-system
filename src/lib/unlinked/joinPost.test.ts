import { describe, it, expect } from 'vitest';
import { LEADERSHIP_ROLE_ID } from '@/lib/discordRoles';
import { renderUnlinkedJoins, selectUnlinkedJoins, type UnlinkedAccount } from './joinPost';

function acct(tag: string, over: Partial<UnlinkedAccount> = {}): [string, UnlinkedAccount] {
  return [tag, { player_tag: tag, person_id: null, in_game_name: `P${tag}`, th_level: 15, ...over }];
}

describe('selectUnlinkedJoins', () => {
  it('keeps arrivals with no person, grouped by clan in arrival order', () => {
    const accounts = new Map([acct('#A'), acct('#B', { person_id: 'p1' }), acct('#C'), acct('#D')]);
    const out = selectUnlinkedJoins(
      [
        { tag: '#A', clanId: 'c1' },
        { tag: '#B', clanId: 'c1' },
        { tag: '#C', clanId: 'c2' },
        { tag: '#D', clanId: 'c1' },
      ],
      accounts,
      new Set(),
    );
    expect([...out.keys()]).toEqual(['c1', 'c2']);
    expect(out.get('c1')!.map((j) => j.tag)).toEqual(['#A', '#D']);
    expect(out.get('c2')).toEqual([{ name: 'P#C', tag: '#C', thLevel: 15 }]);
  });

  it('leaves out kicked accounts, unknown tags and duplicate arrivals', () => {
    const accounts = new Map([acct('#A'), acct('#K')]);
    const out = selectUnlinkedJoins(
      [
        { tag: '#A', clanId: 'c1' },
        { tag: '#A', clanId: 'c2' },
        { tag: '#K', clanId: 'c1' },
        { tag: '#X', clanId: 'c1' },
      ],
      accounts,
      new Set(['#K']),
    );
    expect([...out.entries()]).toEqual([['c1', [{ name: 'P#A', tag: '#A', thLevel: 15 }]]]);
  });

  it('falls back to the tag when the account has no name yet', () => {
    const out = selectUnlinkedJoins([{ tag: '#A', clanId: 'c1' }], new Map([acct('#A', { in_game_name: null })]), new Set());
    expect(out.get('c1')![0].name).toBe('#A');
  });
});

describe('renderUnlinkedJoins', () => {
  it('pings only the Leadership role, in content, and lists the joiner', () => {
    const msg = renderUnlinkedJoins('Feeder', [{ name: 'Bob', tag: '#B1', thLevel: 14 }]);
    expect(msg.content).toBe(`<@&${LEADERSHIP_ROLE_ID}> An unlinked player joined **Feeder** — please take the necessary action.`);
    expect(msg.allowed_mentions).toEqual({ parse: [], roles: [LEADERSHIP_ROLE_ID] });
    expect(msg.embeds![0].title).toBe('🔗 Unlinked player joined Feeder');
    expect(msg.embeds![0].description).toBe('• **Bob** `#B1` · TH14');
  });

  it('pluralises, escapes names and caps a long list', () => {
    const joiners = Array.from({ length: 33 }, (_, i) => ({ name: i === 0 ? '*x*' : `P${i}`, tag: `#T${i}`, thLevel: null }));
    const msg = renderUnlinkedJoins('Main', joiners);
    expect(msg.content).toContain('33 unlinked players joined **Main**');
    const lines = msg.embeds![0].description!.split('\n');
    expect(lines).toHaveLength(31);
    expect(lines[0]).toBe('• **\\*x\\*** `#T0`');
    expect(lines[30]).toBe('…and 3 more');
  });
});
