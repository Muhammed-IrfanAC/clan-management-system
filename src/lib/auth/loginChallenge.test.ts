/**
 * The login-code flow end to end against the in-memory DB, with the Discord DM captured instead
 * of sent — the code a test "types" is read out of the DM exactly as a user would.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';
import { CODE_TTL_MS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS } from './loginCode';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, dms: [] as { to: string; content: string }[], dmOk: true }));

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('@/lib/discord', async () => ({
  normalizeDiscordId: (await import('@/lib/discord/format')).normalizeDiscordId,
  sendDirectMessage: vi.fn(async (to: string, msg: { content: string }) => {
    if (!h.dmOk) return false;
    h.dms.push({ to, content: msg.content });
    return true;
  }),
}));

import { startLoginChallenge, verifyLoginChallenge } from './loginChallenge';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const LEADER_DISCORD = '123456789012345678';

function codeFromLastDm(): string {
  return /\*\*(\d{6})\*\*/.exec(h.dms[h.dms.length - 1].content)![1];
}

async function start(tag = '#LEADER', now = NOW) {
  const r = await startLoginChallenge(tag, now);
  if (r.kind !== 'sent') throw new Error(`expected sent, got ${r.kind}`);
  return r;
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret';
  h.dms = [];
  h.dmOk = true;
  h.db = createClanOpsDb()
    .seed('persons', [
      { id: 'p-leader', access_role: 'leader', discord_user_id: `<@${LEADER_DISCORD}>` },
      { id: 'p-member', access_role: null, discord_user_id: '223456789012345678' },
      { id: 'p-nodiscord', access_role: 'co_leader', discord_user_id: null },
    ])
    .seed('player_accounts', [
      { player_tag: '#LEADER', person_id: 'p-leader' },
      { player_tag: '#LEADERALT', person_id: 'p-leader' },
      { player_tag: '#MEMBER', person_id: 'p-member' },
      { player_tag: '#NODISCORD', person_id: 'p-nodiscord' },
      { player_tag: '#GUEST', person_id: null },
    ]);
  h.db.seed('login_challenges', []);
});

describe('startLoginChallenge', () => {
  it("DMs a code to the person's Discord and stores only its hash", async () => {
    const r = await start('leader');
    expect(h.dms).toHaveLength(1);
    expect(h.dms[0].to).toBe(LEADER_DISCORD);
    expect(h.dms[0].content).toContain('#LEADER');
    const row = h.db.find('login_challenges', r.challengeId)!;
    expect(row.person_id).toBe('p-leader');
    expect(JSON.stringify(row)).not.toContain(codeFromLastDm());
  });

  it('works from any account linked to the access-holding person', async () => {
    await start('#LEADERALT');
    expect(h.dms[0].to).toBe(LEADER_DISCORD);
  });

  it('refuses tags without access, and access without a linked Discord, sending nothing', async () => {
    expect((await startLoginChallenge('#MEMBER', NOW)).kind).toBe('no_access');
    expect((await startLoginChallenge('#GUEST', NOW)).kind).toBe('no_access');
    expect((await startLoginChallenge('#NOPE', NOW)).kind).toBe('no_access');
    expect((await startLoginChallenge('#NODISCORD', NOW)).kind).toBe('no_discord');
    expect(h.dms).toHaveLength(0);
  });

  it('rate-limits per person, across all of their accounts', async () => {
    await start('#LEADER');
    const again = await startLoginChallenge('#LEADERALT', NOW + 1000);
    expect(again).toEqual({ kind: 'rate_limited', retryAfterSec: RESEND_COOLDOWN_MS / 1000 - 1 });
    expect(h.dms).toHaveLength(1);
    await start('#LEADER', NOW + RESEND_COOLDOWN_MS);
  });

  it('counts a failed DM against the limit', async () => {
    h.dmOk = false;
    expect((await startLoginChallenge('#LEADER', NOW)).kind).toBe('dm_failed');
    expect((await startLoginChallenge('#LEADER', NOW + 1000)).kind).toBe('rate_limited');
  });
});

describe('verifyLoginChallenge', () => {
  it('accepts the right code once, re-reading the live role', async () => {
    const r = await start();
    const code = codeFromLastDm();
    expect(await verifyLoginChallenge(r.challengeId, `${code.slice(0, 3)} ${code.slice(3)}`, NOW + 1000))
      .toEqual({ kind: 'ok', playerTag: '#LEADER', role: 'leader' });
    expect((await verifyLoginChallenge(r.challengeId, code, NOW + 2000)).kind).toBe('invalid');
  });

  it('counts wrong guesses and locks the challenge at the limit', async () => {
    const r = await start();
    const code = codeFromLastDm();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(await verifyLoginChallenge(r.challengeId, wrong, NOW)).toEqual({ kind: 'wrong_code', attemptsLeft: MAX_ATTEMPTS - i });
    }
    expect((await verifyLoginChallenge(r.challengeId, wrong, NOW)).kind).toBe('locked');
    expect((await verifyLoginChallenge(r.challengeId, code, NOW)).kind).toBe('locked');
  });

  it('rejects an expired code even if it is right', async () => {
    const r = await start();
    expect((await verifyLoginChallenge(r.challengeId, codeFromLastDm(), NOW + CODE_TTL_MS)).kind).toBe('expired');
  });

  it("does not accept one challenge's code on another", async () => {
    const first = await start();
    const firstCode = codeFromLastDm();
    const second = await start('#LEADER', NOW + RESEND_COOLDOWN_MS);
    if (firstCode === codeFromLastDm()) return; // one-in-a-million collision; nothing to assert
    expect((await verifyLoginChallenge(second.challengeId, firstCode, NOW + RESEND_COOLDOWN_MS)).kind).toBe('wrong_code');
    expect((await verifyLoginChallenge(first.challengeId, firstCode, NOW + RESEND_COOLDOWN_MS)).kind).toBe('ok');
  });

  it('refuses the session if access was revoked after the code was sent', async () => {
    const r = await start();
    h.db.find('persons', 'p-leader')!.access_role = null;
    expect((await verifyLoginChallenge(r.challengeId, codeFromLastDm(), NOW)).kind).toBe('no_access');
  });

  it('treats malformed input as invalid without touching the DB', async () => {
    const before = h.db.log.length;
    for (const [id, code] of [['not-a-uuid', '123456'], [undefined, '123456'], ['00000000-0000-0000-0000-000000000000', 'abc']] as const) {
      expect((await verifyLoginChallenge(id, code, NOW)).kind).toBe('invalid');
    }
    expect(h.db.log.length).toBe(before);
  });
});
