import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyInteraction } from './verify';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
// The raw 32-byte key, hex — the form the Developer Portal shows as "Public Key".
const PUBLIC_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

const NOW = new Date('2026-10-19T12:00:00Z');
const TS = String(Math.floor(NOW.getTime() / 1000));
const BODY = '{"type":1}';

function signed(body = BODY, ts = TS) {
  return sign(null, Buffer.from(ts + body), privateKey).toString('hex');
}

describe('verifyInteraction', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyInteraction({ rawBody: BODY, signature: signed(), timestamp: TS, publicKeyHex: PUBLIC_HEX, now: NOW })).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyInteraction({ rawBody: '{"type":2}', signature: signed(), timestamp: TS, publicKeyHex: PUBLIC_HEX, now: NOW })).toBe(false);
  });

  it('rejects a replayed (stale) timestamp even with a valid signature', () => {
    const old = String(Number(TS) - 3600);
    expect(verifyInteraction({ rawBody: BODY, signature: signed(BODY, old), timestamp: old, publicKeyHex: PUBLIC_HEX, now: NOW })).toBe(false);
  });

  it('rejects missing headers, a malformed signature, or no configured key', () => {
    expect(verifyInteraction({ rawBody: BODY, signature: null, timestamp: TS, publicKeyHex: PUBLIC_HEX, now: NOW })).toBe(false);
    expect(verifyInteraction({ rawBody: BODY, signature: 'zz', timestamp: TS, publicKeyHex: PUBLIC_HEX, now: NOW })).toBe(false);
    expect(verifyInteraction({ rawBody: BODY, signature: signed(), timestamp: TS, publicKeyHex: undefined, now: NOW })).toBe(false);
  });

  it('rejects a signature from another key', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    const sig = sign(null, Buffer.from(TS + BODY), other).toString('hex');
    expect(verifyInteraction({ rawBody: BODY, signature: sig, timestamp: TS, publicKeyHex: PUBLIC_HEX, now: NOW })).toBe(false);
  });
});
