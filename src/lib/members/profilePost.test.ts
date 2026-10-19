import { describe, it, expect } from 'vitest';
import { renderProfile, type Profile, type ProfileAccount } from './profilePost';

const NOW = new Date('2026-10-19T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function account(over: Partial<ProfileAccount> = {}): ProfileAccount {
  return { tag: '#M1', name: 'Main', thLevel: 16, clanName: 'Alpha', status: 'active', isMain: true, strikes: [], kicked: false, ...over };
}

function profile(over: Partial<Profile> = {}): Profile {
  return { personName: 'Bob', discordUserId: '123456789012345678', accessRole: null, accounts: [account()], ...over };
}

describe('renderProfile', () => {
  it('shows each account with its own strike standing', () => {
    const msg = renderProfile(profile({
      accounts: [
        account(),
        account({ tag: '#A1', name: 'Alt', isMain: false, strikes: [{ issuedAt: daysAgo(10), leadershipApproved: false }] }),
      ],
    }), { now: NOW, audience: 'self' });
    const [main, alt] = msg.embeds![0].fields!;
    expect(main.name).toBe('⭐ Main (#M1)');
    expect(main.value).toContain('No active strikes');
    expect(main.value).toContain('✅ War-eligible');
    expect(alt.value).toContain('**1** active strike');
    expect(alt.value).toContain('⛔ Not war-eligible');
  });

  it('ignores strikes outside the 90-day window', () => {
    const msg = renderProfile(profile({ accounts: [account({ strikes: [{ issuedAt: daysAgo(120), leadershipApproved: false }] })] }), { now: NOW, audience: 'self' });
    expect(msg.embeds![0].fields![0].value).toContain('No active strikes');
  });

  it('keeps kick-list and access details for leadership only', () => {
    const p = profile({ accessRole: 'co_leader', accounts: [account({ kicked: true })] });
    const self = renderProfile(p, { now: NOW, audience: 'self' }).embeds![0];
    const lead = renderProfile(p, { now: NOW, audience: 'leadership' }).embeds![0];
    expect(JSON.stringify(self)).not.toMatch(/kick list|Co-leader/);
    expect(lead.fields![0].value).toContain('🚫 On the kick list');
    expect(lead.description).toContain('Dashboard access: **Co-leader**');
  });

  it('never pings, and says so when an account is unlinked', () => {
    const msg = renderProfile(profile({ personName: null, discordUserId: null }), { now: NOW, audience: 'leadership' });
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.embeds![0].title).toBe('Main');
    expect(msg.embeds![0].description).toContain('not linked');
  });

  it('lists active accounts before departed ones', () => {
    const msg = renderProfile(profile({
      accounts: [account({ tag: '#OLD', name: 'Aardvark', status: 'left', isMain: false }), account({ tag: '#NEW', name: 'Zed', isMain: false })],
    }), { now: NOW, audience: 'self' });
    expect(msg.embeds![0].fields!.map((f) => f.name)).toEqual(['Zed (#NEW)', 'Aardvark (#OLD)']);
  });
});
