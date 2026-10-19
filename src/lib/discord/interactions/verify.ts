/**
 * Ed25519 verification of an incoming interaction — the endpoint's only authentication.
 *
 * Discord signs `timestamp + rawBody` with the application's key and refuses to save an endpoint
 * URL that accepts a bad signature (it probes with one when you set it). Anyone can POST to the
 * route, so an unverified body must never reach the router: it would let a stranger act as any
 * Discord user, which the actor lookup then trusts.
 *
 * Pure (node:crypto only), so it is tested with a generated key pair.
 */

import { createPublicKey, verify, type KeyObject } from 'node:crypto';

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow it.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Reject a signature whose timestamp is further than this from now — a replayed request. */
const MAX_SKEW_S = 5 * 60;

let keyCache: { hex: string; key: KeyObject } | null = null;

function publicKey(hex: string): KeyObject | null {
  if (keyCache?.hex === hex) return keyCache.key;
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
  keyCache = { hex, key };
  return key;
}

export function verifyInteraction(params: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  publicKeyHex: string | undefined;
  now?: Date;
}): boolean {
  const { rawBody, signature, timestamp, publicKeyHex } = params;
  if (!signature || !timestamp || !publicKeyHex) return false;
  if (!/^[0-9a-f]{128}$/i.test(signature) || !/^\d+$/.test(timestamp)) return false;

  const nowS = Math.floor((params.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowS - Number(timestamp)) > MAX_SKEW_S) return false;

  const key = publicKey(publicKeyHex.trim());
  if (!key) return false;
  try {
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}
