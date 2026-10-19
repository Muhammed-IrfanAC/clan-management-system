import { describe, it, expect } from 'vitest';
import { decodeCustomId, encodeCustomId } from './customId';

describe('custom ids', () => {
  it('round-trips namespace, version and args', () => {
    const id = encodeCustomId('hitup', 1, ['abc', 'confirm']);
    expect(id).toBe('hitup:v1:abc:confirm');
    expect(decodeCustomId(id)).toEqual({ namespace: 'hitup', version: 1, args: ['abc', 'confirm'] });
  });

  it('refuses args that would corrupt the encoding, or an id over 100 chars', () => {
    expect(() => encodeCustomId('x', 1, ['a:b'])).toThrow();
    expect(() => encodeCustomId('x', 1, ['a'.repeat(100)])).toThrow();
  });

  it('decodes anything else to null', () => {
    expect(decodeCustomId(undefined)).toBeNull();
    expect(decodeCustomId('legacy-button')).toBeNull();
    expect(decodeCustomId('x:vNaN')).toBeNull();
  });
});
