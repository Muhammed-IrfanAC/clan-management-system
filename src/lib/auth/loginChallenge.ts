/**
 * The DB half of Discord login codes (rules in `loginCode.ts`). One `login_challenges` row per code
 * sent: the HMAC of the code, its expiry, a guess counter and when it was used. Flat selects only,
 * so it runs on `fakeSupabase`.
 */

import { randomUUID } from 'crypto';
import { supabase } from '@/lib/supabase';
import { normalizeDiscordId, sendDirectMessage } from '@/lib/discord';
import type { AccessRole } from '@/types/database';
import {
  CODE_TTL_MS, ISSUE_WINDOW_MS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS,
  challengeVerdict, generateCode, hashCode, hashesMatch, issueVerdict, normalizeCode,
} from './loginCode';
import { renderLoginCodeDm } from './loginCodePost';

export type StartResult =
  | { kind: 'sent'; challengeId: string; expiresAt: string; resendAfterSec: number }
  | { kind: 'no_access' }
  | { kind: 'no_discord' }
  | { kind: 'rate_limited'; retryAfterSec: number }
  | { kind: 'dm_failed' };

export type VerifyResult =
  | { kind: 'ok'; playerTag: string; role: AccessRole }
  | { kind: 'wrong_code'; attemptsLeft: number }
  | { kind: 'invalid' | 'expired' | 'locked' | 'no_access' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codeSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export function normalizeTag(raw: string): string {
  const t = raw.trim().toUpperCase();
  return t.startsWith('#') ? t : `#${t}`;
}

/**
 * Who may log in as `playerTag`: the account's person, if that person holds dashboard access. Access
 * lives on the person, so any of their linked accounts works (see auth-server.ts).
 */
async function accessHolder(playerTag: string) {
  const { data: account, error } = await supabase
    .from('player_accounts')
    .select('player_tag, person_id')
    .eq('player_tag', playerTag)
    .maybeSingle();
  if (error) throw error;
  if (!account?.person_id) return null;
  const { data: person, error: pErr } = await supabase
    .from('persons')
    .select('id, access_role, discord_user_id')
    .eq('id', account.person_id)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!person?.access_role) return null;
  return { personId: person.id as string, role: person.access_role as AccessRole, discordId: normalizeDiscordId(person.discord_user_id) };
}

/** Send a login code for `rawTag` to its person's Discord DMs. */
export async function startLoginChallenge(rawTag: string, now = Date.now()): Promise<StartResult> {
  const playerTag = normalizeTag(rawTag);
  const holder = await accessHolder(playerTag);
  if (!holder) return { kind: 'no_access' };
  if (!holder.discordId) return { kind: 'no_discord' };

  const { data: recent, error } = await supabase
    .from('login_challenges')
    .select('created_at')
    .eq('person_id', holder.personId)
    .gte('created_at', new Date(now - ISSUE_WINDOW_MS).toISOString());
  if (error) throw error;
  const verdict = issueVerdict((recent ?? []).map((r) => r.created_at as string), now);
  if (!verdict.ok) return { kind: 'rate_limited', retryAfterSec: verdict.retryAfterSec };

  // The row is written before the DM is sent, so a send that fails still counts against the limit —
  // otherwise a tag whose owner has DMs off could be used to hammer the Discord API.
  const id = randomUUID();
  const code = generateCode();
  const expiresAt = new Date(now + CODE_TTL_MS).toISOString();
  const { error: insErr } = await supabase.from('login_challenges').insert({
    id,
    person_id: holder.personId,
    player_tag: playerTag,
    code_hash: hashCode(id, code, codeSecret()),
    expires_at: expiresAt,
    attempts: 0,
    consumed_at: null,
    created_at: new Date(now).toISOString(),
  });
  if (insErr) throw insErr;

  // Housekeeping: a code is worthless a day on. Best-effort; a failure leaves rows for next time.
  await supabase.from('login_challenges').delete().lt('created_at', new Date(now - 24 * 3600_000).toISOString());

  const sent = await sendDirectMessage(holder.discordId, renderLoginCodeDm(code, playerTag, expiresAt));
  if (!sent) return { kind: 'dm_failed' };
  return { kind: 'sent', challengeId: id, expiresAt, resendAfterSec: RESEND_COOLDOWN_MS / 1000 };
}

/** Check a code against its challenge; on success the challenge is spent and the live role returned. */
export async function verifyLoginChallenge(challengeId: unknown, rawCode: unknown, now = Date.now()): Promise<VerifyResult> {
  const code = normalizeCode(rawCode);
  if (typeof challengeId !== 'string' || !UUID.test(challengeId) || !code) return { kind: 'invalid' };

  const { data: ch, error } = await supabase
    .from('login_challenges')
    .select('id, person_id, player_tag, code_hash, expires_at, attempts, consumed_at')
    .eq('id', challengeId)
    .maybeSingle();
  if (error) throw error;
  if (!ch) return { kind: 'invalid' };

  const verdict = challengeVerdict(ch, now);
  if (verdict === 'used') return { kind: 'invalid' };
  if (verdict !== 'open') return { kind: verdict };

  // Count the guess before judging it, conditionally on the count we read: two guesses racing on one
  // challenge cannot both spend the same attempt. supabase-js has no atomic increment without an RPC.
  const { data: counted, error: cErr } = await supabase
    .from('login_challenges')
    .update({ attempts: ch.attempts + 1 })
    .eq('id', ch.id)
    .eq('attempts', ch.attempts)
    .is('consumed_at', null)
    .select('id');
  if (cErr) throw cErr;
  if (!counted?.length) return { kind: 'invalid' };

  if (!hashesMatch(hashCode(ch.id, code, codeSecret()), ch.code_hash)) {
    const left = MAX_ATTEMPTS - (ch.attempts + 1);
    return left ? { kind: 'wrong_code', attemptsLeft: left } : { kind: 'locked' };
  }

  const { data: spent, error: sErr } = await supabase
    .from('login_challenges')
    .update({ consumed_at: new Date(now).toISOString() })
    .eq('id', ch.id)
    .is('consumed_at', null)
    .select('id');
  if (sErr) throw sErr;
  if (!spent?.length) return { kind: 'invalid' };

  // Access is re-read now, not trusted from when the code was sent: it may have been revoked since.
  const holder = await accessHolder(ch.player_tag);
  if (!holder || holder.personId !== ch.person_id) return { kind: 'no_access' };
  return { kind: 'ok', playerTag: ch.player_tag, role: holder.role };
}
