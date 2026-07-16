import { describe, it, expect } from 'vitest';
import {
  normalizeMode,
  clanAutomatesSource,
  filterViolationsByClanMode,
} from './automationScope';
import type { RuleAutomationMode } from '@/types/database';
import type { DetectedViolation } from './types';

function violation(over: Partial<DetectedViolation> & { source: 'regular' | 'cwl' }): DetectedViolation {
  return {
    personId: 'p',
    playerTag: '#T',
    clanId: 'clan1',
    memberName: 'M',
    description: 'd',
    dedupKey: 'k',
    occurredAt: '2026-07-15T12:00:00.000Z',
    ...over,
  };
}

describe('normalizeMode', () => {
  it('passes through valid modes', () => {
    expect(normalizeMode('always')).toBe('always');
    expect(normalizeMode('cwl_only')).toBe('cwl_only');
    expect(normalizeMode('never')).toBe('never');
  });
  it('defaults unknown/null to always', () => {
    expect(normalizeMode(null)).toBe('always');
    expect(normalizeMode(undefined)).toBe('always');
    expect(normalizeMode('garbage')).toBe('always');
  });
});

describe('clanAutomatesSource', () => {
  const cases: Array<[RuleAutomationMode, 'regular' | 'cwl', boolean]> = [
    ['always', 'regular', true],
    ['always', 'cwl', true],
    ['cwl_only', 'regular', false],
    ['cwl_only', 'cwl', true],
    ['never', 'regular', false],
    ['never', 'cwl', false],
  ];
  it.each(cases)('mode=%s source=%s => %s', (mode, source, expected) => {
    expect(clanAutomatesSource(mode, source)).toBe(expected);
  });
});

describe('filterViolationsByClanMode', () => {
  it('drops regular-war violations for a cwl_only clan but keeps its CWL ones', () => {
    const modes = new Map<string, RuleAutomationMode>([['clan1', 'cwl_only']]);
    const vs = [
      violation({ source: 'regular', dedupKey: 'reg' }),
      violation({ source: 'cwl', dedupKey: 'cwl' }),
    ];
    expect(filterViolationsByClanMode(vs, modes).map(v => v.dedupKey)).toEqual(['cwl']);
  });

  it('drops everything for a never clan', () => {
    const modes = new Map<string, RuleAutomationMode>([['clan1', 'never']]);
    const vs = [violation({ source: 'regular' }), violation({ source: 'cwl' })];
    expect(filterViolationsByClanMode(vs, modes)).toHaveLength(0);
  });

  it('keeps all when the clan is unknown or unset (defaults to always)', () => {
    const modes = new Map<string, RuleAutomationMode>();
    const vs = [
      violation({ source: 'regular' }),
      violation({ source: 'cwl' }),
      violation({ source: 'regular', clanId: null }),
    ];
    expect(filterViolationsByClanMode(vs, modes)).toHaveLength(3);
  });

  it('applies each clan its own mode', () => {
    const modes = new Map<string, RuleAutomationMode>([
      ['always-clan', 'always'],
      ['never-clan', 'never'],
    ]);
    const vs = [
      violation({ source: 'regular', clanId: 'always-clan', dedupKey: 'a' }),
      violation({ source: 'cwl', clanId: 'never-clan', dedupKey: 'b' }),
    ];
    expect(filterViolationsByClanMode(vs, modes).map(v => v.dedupKey)).toEqual(['a']);
  });
});
