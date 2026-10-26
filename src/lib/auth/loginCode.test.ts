import { describe, it, expect } from 'vitest';
import {
  CODE_TTL_MS, ISSUE_WINDOW_MS, MAX_ATTEMPTS, MAX_CODES_PER_WINDOW, RESEND_COOLDOWN_MS,
  challengeVerdict, generateCode, hashCode, hashesMatch, issueVerdict, normalizeCode,
} from './loginCode';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('generateCode', () => {
  it('is always six digits, leading zeros kept', () => {
    for (let i = 0; i < 500; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
});

describe('normalizeCode', () => {
  it('accepts a code typed with a space or dash', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('123-456')).toBe('123456');
    expect(normalizeCode('012345')).toBe('012345');
  });
  it('rejects anything else', () => {
    for (const bad of ['12345', '1234567', 'abcdef', '', null, 123456, undefined]) expect(normalizeCode(bad)).toBeNull();
  });
});

describe('hashCode', () => {
  it('binds the code to its challenge and the secret', () => {
    const h = hashCode('a', '123456', 's');
    expect(hashesMatch(h, hashCode('a', '123456', 's'))).toBe(true);
    expect(hashesMatch(h, hashCode('b', '123456', 's'))).toBe(false);
    expect(hashesMatch(h, hashCode('a', '123456', 't'))).toBe(false);
    expect(hashesMatch(h, hashCode('a', '123457', 's'))).toBe(false);
    expect(h).not.toContain('123456');
  });
});

describe('issueVerdict', () => {
  it('allows the first code', () => {
    expect(issueVerdict([], NOW)).toEqual({ ok: true });
  });

  it('holds a resend until the cooldown has passed', () => {
    expect(issueVerdict([ago(10_000)], NOW)).toEqual({ ok: false, retryAfterSec: (RESEND_COOLDOWN_MS - 10_000) / 1000 });
    expect(issueVerdict([ago(RESEND_COOLDOWN_MS)], NOW)).toEqual({ ok: true });
  });

  it('caps codes per window, until the oldest falls out of it', () => {
    const spaced = Array.from({ length: MAX_CODES_PER_WINDOW }, (_, i) => ago(ISSUE_WINDOW_MS - 60_000 - i * 2 * 60_000));
    expect(issueVerdict(spaced, NOW)).toEqual({ ok: false, retryAfterSec: 60 });
    expect(issueVerdict(spaced.slice(1), NOW)).toEqual({ ok: true });
  });

  it('ignores codes older than the window', () => {
    const old = Array.from({ length: 10 }, () => ago(ISSUE_WINDOW_MS + 1));
    expect(issueVerdict(old, NOW)).toEqual({ ok: true });
  });
});

describe('challengeVerdict', () => {
  const open = { expires_at: new Date(NOW + CODE_TTL_MS).toISOString(), attempts: 0, consumed_at: null };
  it('is open while unused, unexpired and under the guess limit', () => {
    expect(challengeVerdict(open, NOW)).toBe('open');
    expect(challengeVerdict({ ...open, attempts: MAX_ATTEMPTS - 1 }, NOW)).toBe('open');
  });
  it('closes on use, expiry, or too many guesses — use first', () => {
    expect(challengeVerdict({ ...open, consumed_at: ago(1) }, NOW)).toBe('used');
    expect(challengeVerdict({ ...open, expires_at: ago(0) }, NOW)).toBe('expired');
    expect(challengeVerdict({ ...open, attempts: MAX_ATTEMPTS }, NOW)).toBe('locked');
    expect(challengeVerdict({ ...open, attempts: MAX_ATTEMPTS, consumed_at: ago(1), expires_at: ago(1) }, NOW)).toBe('used');
  });
});
