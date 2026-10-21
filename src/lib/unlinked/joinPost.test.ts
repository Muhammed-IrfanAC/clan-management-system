import { describe, it, expect } from 'vitest';
import { LEADERSHIP_ROLE_ID } from '@/lib/discord/roles';
import {
  joinOutcome,
  outcomeLine,
  renderUnlinkedJoins,
  selectUnlinkedJoins,
  settleAlert,
  type JoinerNow,
  type SettledJoiner,
  type UnlinkedAccount,
} from './joinPost';

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

describe('joinOutcome', () => {
  const now = (over: Partial<JoinerNow> = {}): JoinerNow => ({
    player_tag: '#A', person_id: null, status: 'active', clan_id: 'c1', in_game_name: 'A', ...over,
  });
  const entry = { clan_id: 'c1' };

  it('is null while the joiner is still an unlinked member of the clan', () => {
    expect(joinOutcome(entry, now())).toBeNull();
  });

  it('settles a joiner who left, moved, was linked or was removed', () => {
    expect(joinOutcome(entry, now({ status: 'left' }))).toEqual({ kind: 'left' });
    expect(joinOutcome(entry, now({ status: 'inactive' }))).toEqual({ kind: 'left' });
    expect(joinOutcome(entry, now({ clan_id: 'c2' }))).toEqual({ kind: 'moved', toClanId: 'c2' });
    expect(joinOutcome(entry, now({ person_id: 'p1' }))).toEqual({ kind: 'linked', personId: 'p1' });
    expect(joinOutcome(entry, undefined)).toEqual({ kind: 'gone' });
  });

  it('reads a linked joiner as linked even once they have left', () => {
    expect(joinOutcome(entry, now({ person_id: 'p1', status: 'left' }))).toEqual({ kind: 'linked', personId: 'p1' });
  });
});

describe('settleAlert', () => {
  const NOW = '2026-10-21T12:00:00Z';
  const names = { clan: (id: string) => (id === 'c2' ? 'Feeder' : '?'), person: () => 'Bob' };
  const line = (s: SettledJoiner) => outcomeLine(s.tag, s.outcome, names, NOW);
  const alert = () =>
    renderUnlinkedJoins('Main', [
      { name: 'A', tag: '#A', thLevel: 15 },
      { name: 'B', tag: '#B', thLevel: 15 },
    ]);
  const offered = (msg: { components?: { components: unknown[] }[] }) =>
    (msg.components ?? []).flatMap((r) => r.components as { options: { value: string }[] }[]).flatMap((c) => c.options.map((o) => o.value));

  it('stamps a departure, drops it from the select and keeps the alert open for the rest', () => {
    const out = settleAlert(alert(), [{ tag: '#A', outcome: { kind: 'left' } }], line)!;
    expect(out.embeds![0].fields).toEqual([
      { name: 'Actions', value: '🚪 `#A` left <t:1792584000:R>, before anyone linked them', inline: false },
    ]);
    expect(offered(out)).toEqual(['#B']);
    expect(out.embeds![0].color).toBe(alert().embeds![0].color);
    expect(out.allowed_mentions).toEqual({ parse: [] }); // the edit must not re-ping Leadership
  });

  it('resolves the alert once every joiner is settled', () => {
    const out = settleAlert(
      alert(),
      [
        { tag: '#A', outcome: { kind: 'left' } },
        { tag: '#B', outcome: { kind: 'moved', toClanId: 'c2' } },
      ],
      line,
    )!;
    expect(out.components).toEqual([]);
    expect(out.embeds![0].fields![0].value).toContain('↪️ `#B` moved to **Feeder**');
    expect(out.embeds![0].color).not.toBe(alert().embeds![0].color);
  });

  it('stamps a link made elsewhere, but not one the alert already recorded', () => {
    const elsewhere = settleAlert(alert(), [{ tag: '#A', outcome: { kind: 'linked', personId: 'p1' } }], line)!;
    expect(elsewhere.embeds![0].fields![0].value).toBe('🔗 `#A` was linked to **Bob** outside this alert');

    // A link from the alert's own panel already removed #A from the select and stamped it.
    expect(settleAlert(elsewhere, [{ tag: '#A', outcome: { kind: 'linked', personId: 'p1' } }], line)).toBeNull();
  });
});
