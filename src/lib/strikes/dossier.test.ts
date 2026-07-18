import { describe, it, expect } from 'vitest';
import { buildDossiers, buildWorklist, hasEngaged, type StrikeWithContext } from './dossier';

const NOW = new Date('2026-07-18T12:00:00.000Z');
const DAY = 86_400_000;

// A minimal strike row with sensible defaults; override per-test.
function strike(personId: string, opts: Partial<StrikeWithContext> = {}): StrikeWithContext {
  const issuedAt = opts.issued_at ?? NOW.toISOString();
  return {
    id: `${personId}-${issuedAt}`,
    person_id: personId,
    player_account_tag: '#TAG',
    clan_id: null,
    rule_id: null,
    war_source: 'manual',
    war_round_id: null,
    war_label: null,
    strike_key: null,
    origin: 'manual',
    issued_at: issuedAt,
    expires_at: new Date(new Date(issuedAt).getTime() + 90 * DAY).toISOString(),
    logged_by: '#LEADER',
    owned: false,
    apologised: false,
    understands_rule: false,
    promised: false,
    leadership_approved: false,
    approved_by: null,
    approved_at: null,
    elder_restored_at: null,
    war_eligible_at: null,
    removal_at: null,
    rejoin_at: null,
    discord_message_id: null,
    notes: null,
    created_at: issuedAt,
    person: { id: personId, display_name: `Player ${personId}` },
    ...opts,
  };
}

// N days before NOW, as ISO.
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

describe('buildDossiers', () => {
  it('groups strikes by person and derives the active count/level', () => {
    const dossiers = buildDossiers(
      [strike('A', { issued_at: daysAgo(1) }), strike('A', { issued_at: daysAgo(2) }), strike('B')],
      NOW,
    );
    const a = dossiers.find((d) => d.personId === 'A')!;
    const b = dossiers.find((d) => d.personId === 'B')!;
    expect(a.status.activeCount).toBe(2);
    expect(a.status.level).toBe('orange');
    expect(b.status.activeCount).toBe(1);
    expect(b.status.level).toBe('green');
  });

  it('excludes expired strikes from the active set but keeps them in history', () => {
    const d = buildDossiers([strike('A', { issued_at: daysAgo(120) }), strike('A', { issued_at: daysAgo(3) })], NOW)[0];
    expect(d.strikes).toHaveLength(2);
    expect(d.activeStrikes).toHaveLength(1);
    expect(d.status.activeCount).toBe(1);
  });

  it('sorts strikes newest-first and persons by severity', () => {
    const dossiers = buildDossiers(
      [strike('B'), strike('A', { issued_at: daysAgo(5) }), strike('A', { issued_at: daysAgo(1) }), strike('A', { issued_at: daysAgo(3) })],
      NOW,
    );
    expect(dossiers[0].personId).toBe('A'); // 3 active > B's 1
    expect(dossiers[0].strikes[0].issued_at).toBe(daysAgo(1)); // newest first
  });
});

describe('hasEngaged', () => {
  it('is true when any checklist box is ticked', () => {
    expect(hasEngaged(strike('A'))).toBe(false);
    expect(hasEngaged(strike('A', { apologised: true }))).toBe(true);
    expect(hasEngaged(strike('A', { promised: true }))).toBe(true);
  });
});

describe('buildWorklist', () => {
  it('splits unresolved into awaiting-response vs awaiting-approval by engagement', () => {
    const dossiers = buildDossiers(
      [
        strike('A'),                              // unresolved, no engagement
        strike('B', { owned: true, promised: true }), // unresolved, engaged
      ],
      NOW,
    );
    const wl = buildWorklist(dossiers, NOW);
    expect(wl.unresolved).toHaveLength(2);
    expect(wl.awaitingResponse.map((d) => d.personId)).toEqual(['A']);
    expect(wl.awaitingApproval.map((d) => d.personId)).toEqual(['B']);
  });

  it('surfaces Elder-restoration when active strikes are all approved', () => {
    const dossiers = buildDossiers([strike('A', { leadership_approved: true })], NOW);
    const wl = buildWorklist(dossiers, NOW);
    expect(wl.eligibleForElderRestoration.map((d) => d.personId)).toEqual(['A']);
    expect(wl.unresolved).toHaveLength(0); // approved => war-eligible => not unresolved
  });

  it('flags removal at 3 active strikes regardless of approval', () => {
    const dossiers = buildDossiers(
      [
        strike('A', { issued_at: daysAgo(1), leadership_approved: true }),
        strike('A', { issued_at: daysAgo(2), leadership_approved: true }),
        strike('A', { issued_at: daysAgo(3), leadership_approved: true }),
      ],
      NOW,
    );
    const wl = buildWorklist(dossiers, NOW);
    expect(wl.removalFlagged.map((d) => d.personId)).toEqual(['A']);
  });

  it('lists strikes expiring within the soon-window', () => {
    const dossiers = buildDossiers(
      [strike('A', { issued_at: daysAgo(80) }), strike('B', { issued_at: daysAgo(10) })],
      NOW,
    );
    const wl = buildWorklist(dossiers, NOW);
    // A expires in ~10 days (within 14); B expires in ~80 days (not soon).
    expect(wl.expiringSoon.map((d) => d.personId)).toEqual(['A']);
  });
});
