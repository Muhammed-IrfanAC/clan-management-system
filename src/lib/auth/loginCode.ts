/**
 * Pure rules for Discord login codes (the DB half is `loginChallenge.ts`).
 *
 * A player tag is public — it is printed on every profile in the game — so knowing one proves
 * nothing. Login therefore sends a one-time code to the Discord account linked to the tag's
 * person, and only the code opens a session. The numbers below bound what a stranger who types a
 * leader's tag can do: a 6-digit code, 5 guesses per code, at most 5 codes per person per 15
 * minutes — 25 guesses in a million per window, and no more than 5 DMs to pester a leader with.
 */

import { createHmac, randomInt, timingSafeEqual } from 'crypto';

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const ISSUE_WINDOW_MS = 15 * 60_000;
export const MAX_CODES_PER_WINDOW = 5;

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/** What the user typed, reduced to digits ("123 456" and "123-456" both work); null if not a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/**
 * The stored form of a code. Keyed by the server secret and bound to its challenge id, so a leaked
 * row is neither the code nor reusable on another challenge.
 */
export function hashCode(challengeId: string, code: string, secret: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export function hashesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * May a new code be sent to this person now? `recent` is when each of their codes in the last
 * ISSUE_WINDOW_MS was created. Returns the wait in whole seconds when not.
 */
export function issueVerdict(recent: string[], now: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const times = recent.map((t) => Date.parse(t)).filter((t) => now - t < ISSUE_WINDOW_MS).sort((a, b) => a - b);
  const waits: number[] = [];
  const latest = times[times.length - 1];
  if (latest !== undefined && now - latest < RESEND_COOLDOWN_MS) waits.push(latest + RESEND_COOLDOWN_MS - now);
  if (times.length >= MAX_CODES_PER_WINDOW) waits.push(times[times.length - MAX_CODES_PER_WINDOW] + ISSUE_WINDOW_MS - now);
  if (!waits.length) return { ok: true };
  return { ok: false, retryAfterSec: Math.ceil(Math.max(...waits) / 1000) };
}

export interface ChallengeState {
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
}

/** Whether a challenge can still take a guess. */
export function challengeVerdict(ch: ChallengeState, now: number): 'open' | 'used' | 'expired' | 'locked' {
  if (ch.consumed_at) return 'used';
  if (Date.parse(ch.expires_at) <= now) return 'expired';
  if (ch.attempts >= MAX_ATTEMPTS) return 'locked';
  return 'open';
}
