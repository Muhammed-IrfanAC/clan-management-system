import { describe, it, expect } from 'vitest';
import { renderStrikePost, type StrikePostParams } from './strikePost';
import { expiryOf } from './status';

const ISSUED = '2026-10-01T10:00:00.000Z';

function params(over: Partial<StrikePostParams> = {}): StrikePostParams {
  return {
    memberName: 'Bob',
    playerTag: '#B1',
    ruleName: 'Use both attacks',
    warLabel: 'vs Enemy',
    reasons: ['Missed 1 of 2 attacks'],
    strikeNumber: 1,
    level: 'green',
    activeStrikes: [{ issuedAt: ISSUED, label: 'Missed attack', leadershipApproved: false }],
    mentionDiscordId: '123456789012345678',
    ...over,
  };
}

describe('renderStrikePost', () => {
  it('pings exactly the member and names the strike number', () => {
    const msg = renderStrikePost(params());
    expect(msg.content).toBe('<@123456789012345678>');
    expect(msg.allowed_mentions).toEqual({ users: ['123456789012345678'] });
    expect(msg.embeds![0].title).toBe('🟢 Strike 1 Issued');
    expect(msg.embeds![0].fields!.map((f) => f.name)).toEqual(['Member', 'War', 'Current strike', 'Active record', 'Consequence']);
  });

  it('sends the same notice without a ping when the member has no linked Discord', () => {
    const msg = renderStrikePost(params({ mentionDiscordId: null }));
    expect(msg.content).toBeUndefined();
    expect(msg.allowed_mentions).toEqual({ parse: [] });
  });

  it('lists only the PREVIOUS active strikes, by expiry, tagging restored ones', () => {
    const older = '2026-08-01T10:00:00.000Z';
    const msg = renderStrikePost(params({
      strikeNumber: 2,
      level: 'orange',
      activeStrikes: [
        { issuedAt: older, label: 'Late snipe', leadershipApproved: true },
        { issuedAt: ISSUED, label: 'Missed attack', leadershipApproved: false },
      ],
    }));
    const prev = msg.embeds![0].fields!.find((f) => f.name === 'Previous active strike')!;
    const ts = Math.floor(Date.parse(expiryOf(older)) / 1000);
    expect(prev.value).toBe(`\`1.\` **[Restored]** Late snipe — expires <t:${ts}:D> (<t:${ts}:R>)`);
  });

  it('flags the removal threshold at red', () => {
    expect(renderStrikePost(params({ level: 'red', strikeNumber: 3 })).embeds![0].title)
      .toBe('🔴 Strike 3 Issued — removal threshold reached');
  });

  it('leads a late snipe with the evidence', () => {
    const msg = renderStrikePost(params({
      lateSnipe: {
        windowHours: 6,
        violations: [{ evidence: { late_attacks: [{ hours_left: 2.5 }] } } as never],
      },
    }));
    const embed = msg.embeds![0];
    expect(embed.title).toBe('🟢 Strike 1 of 3 Issued — Better Late Than Never');
    expect(embed.fields![0].name).toBe('Evidence of violation');
    expect(embed.fields![0].value).toContain('**Attack 1:** 2h 30m remaining in war');
    expect(embed.fields![0].value).toContain('before the final **6h** of war');
  });
});
