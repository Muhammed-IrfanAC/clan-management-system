import { describe, it, expect } from 'vitest';
import { nameKey, suggestPersons, type PersonCandidate } from './match';

const person = (personId: string, displayName: string, accountNames: string[] = [], clanIds: string[] = []): PersonCandidate =>
  ({ personId, displayName, accountNames, clanIds });

describe('nameKey', () => {
  it('folds case, decoration and alt-style suffixes', () => {
    expect(nameKey('Bob²')).toBe('bob');
    expect(nameKey('bob alt')).toBe('bob');
    expect(nameKey('Bob 2.0')).toBe('bob');
    expect(nameKey('★ BOB II')).toBe('bob');
  });

  it('never strips a name to nothing', () => {
    expect(nameKey('2')).toBe('2');
    expect(nameKey('Alt')).toBe('alt');
  });
});

describe('suggestPersons', () => {
  const people = [
    person('p1', 'Bob', ['Bob'], ['c1']),
    person('p2', 'Robert', ['Bobby Tables'], ['c2']),
    person('p3', 'Alice', ['Alice', 'Ali Alt']),
    person('p4', 'Bob (other)', ['Bob'], ['c2']),
  ];

  it('ranks exact name matches first, breaking ties on the clan the joiner is in', () => {
    expect(suggestPersons({ name: 'bob alt', clanId: 'c2' }, people).map((s) => s.personId)).toEqual(['p4', 'p1', 'p2']);
  });

  it('matches on any of the person’s account names, not just the display name', () => {
    expect(suggestPersons({ name: 'Bobby Tables 2' }, people)[0]).toMatchObject({ personId: 'p2', score: 3 });
  });

  it('suggests nobody for an unrelated name', () => {
    expect(suggestPersons({ name: 'Zed' }, people)).toEqual([]);
  });
});
