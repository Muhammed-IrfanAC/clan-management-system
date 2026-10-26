import { describe, it, expect } from 'vitest';
import { desiredLevels, isDue, planRoleChanges, resolveRoles, roleLevels, thRoleName } from './thRoles';

const U1 = '111111111111111111';
const U2 = '222222222222222222';

describe('roleLevels', () => {
  it('spans TH9 to the highest active level', () => {
    expect(roleLevels([12, 17, null, 8])).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('grows on its own when a new town hall appears', () => {
    expect(roleLevels([18, 19]).at(-1)).toBe(19);
  });

  it('is empty when nobody has reached TH9', () => {
    expect(roleLevels([7, 8, null])).toEqual([]);
  });
});

describe('resolveRoles', () => {
  it('keeps a stored role even after it was renamed', () => {
    const r = resolveRoles([9], new Map([[9, 'r9']]), [{ id: 'r9', name: 'Town Hall Nine' }]);
    expect(r.roleIds.get(9)).toBe('r9');
    expect(r.toCreate).toEqual([]);
    expect(r.adopted).toEqual([]);
  });

  it('adopts a hand-made role by name instead of duplicating it', () => {
    const r = resolveRoles([9, 10], new Map(), [{ id: 'x', name: 'th 10' }]);
    expect(r.roleIds.get(10)).toBe('x');
    expect(r.adopted).toEqual([10]);
    expect(r.toCreate).toEqual([9]);
  });

  it('re-makes a stored role deleted from the server, and ignores integration roles', () => {
    const r = resolveRoles([9], new Map([[9, 'gone']]), [{ id: 'bot', name: 'TH9', managed: true }]);
    expect(r.toCreate).toEqual([9]);
  });

  it('keeps managing a stored level the family no longer reaches', () => {
    const r = resolveRoles([9], new Map([[9, 'r9'], [18, 'r18']]), [{ id: 'r9', name: 'TH9' }, { id: 'r18', name: 'TH18' }]);
    expect(r.roleIds.get(18)).toBe('r18');
    expect(r.toCreate).toEqual([]);
  });
});

describe('desiredLevels', () => {
  it('gives a person one role per TH among their accounts, TH9+ only', () => {
    const d = desiredLevels(
      [
        { person_id: 'p1', th_level: 17 },
        { person_id: 'p1', th_level: 12 },
        { person_id: 'p1', th_level: 8 },
        { person_id: 'p2', th_level: 15 },
        { person_id: null, th_level: 16 },
      ],
      new Map([['p1', `<@${U1}>`], ['p2', 'not-an-id']]),
    );
    expect([...d.get(U1)!].sort()).toEqual([12, 17]);
    expect(d.size).toBe(1);
  });
});

describe('planRoleChanges', () => {
  const roleIds = new Map([[16, 'r16'], [17, 'r17']]);

  it('swaps the role on an upgrade and leaves unmanaged roles alone', () => {
    const changes = planRoleChanges(
      [{ userId: U1, roles: ['r16', 'member'] }],
      new Map([[U1, new Set([17])]]),
      roleIds,
    );
    expect(changes).toEqual([
      { userId: U1, roleId: 'r16', level: 16, op: 'remove' },
      { userId: U1, roleId: 'r17', level: 17, op: 'add' },
    ]);
  });

  it('strips TH roles from someone who no longer qualifies', () => {
    expect(planRoleChanges([{ userId: U2, roles: ['r17'] }], new Map(), roleIds)).toEqual([
      { userId: U2, roleId: 'r17', level: 17, op: 'remove' },
    ]);
  });

  it('changes nothing for someone already correct', () => {
    expect(planRoleChanges([{ userId: U1, roles: ['r17'] }], new Map([[U1, new Set([17])]]), roleIds)).toEqual([]);
  });
});

describe('isDue', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  it('runs once a day', () => {
    expect(isDue(null, now)).toBe(true);
    expect(isDue('2026-10-26T00:00:00Z', now)).toBe(false);
    expect(isDue('2026-10-25T11:59:00Z', now)).toBe(true);
  });
});

it('names roles TH<n>', () => {
  expect(thRoleName(19)).toBe('TH19');
});
