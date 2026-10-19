import { describe, it, expect } from 'vitest';
import { discordTs, normalizeDiscordId, truncateField } from './format';

describe('normalizeDiscordId', () => {
  it('accepts a bare snowflake or a pasted mention', () => {
    expect(normalizeDiscordId('123456789012345678')).toBe('123456789012345678');
    expect(normalizeDiscordId(' <@!123456789012345678> ')).toBe('123456789012345678');
  });

  it('treats a username or blank as not linked', () => {
    expect(normalizeDiscordId('irfan')).toBeNull();
    expect(normalizeDiscordId('')).toBeNull();
    expect(normalizeDiscordId(null)).toBeNull();
  });
});

describe('discordTs', () => {
  it('renders a timestamp token, or the raw string when unparseable', () => {
    expect(discordTs('2026-10-01T00:00:00.000Z', 'R')).toBe(`<t:${Date.parse('2026-10-01T00:00:00.000Z') / 1000}:R>`);
    expect(discordTs('20261001T000000.000Z')).toBe('20261001T000000.000Z');
  });
});

describe('truncateField', () => {
  it('leaves a short value alone and trims whole lines past the limit', () => {
    expect(truncateField('a\nb')).toBe('a\nb');
    const long = Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
    const out = truncateField(long);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out.endsWith('\n…')).toBe(true);
    expect(out.split('\n').slice(0, -1).every((l) => long.includes(l))).toBe(true);
  });
});
