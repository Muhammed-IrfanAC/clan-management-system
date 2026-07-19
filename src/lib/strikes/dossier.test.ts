import { describe, it, expect } from 'vitest';
import { buildDossiers, buildWorklist, type StrikeWithContext } from './dossier';

const NOW = new Date('2026-07-18T12:00:00.000Z');
const DAY = 86_400_000;

// A minimal strike row with sensible defaults; override per-test. The first arg is the ACCOUNT key
// (dossiers group per account): it seeds both the player tag (`#<key>`) and, by default, the person
// id — pass `person_id` explicitly to model two accounts of the SAME person.
function strike(acct: string, opts: Partial<StrikeWithContext> = {}): StrikeWithContext {
  const issuedAt = opts.issued_at ?? NOW.toISOString();
  const personId = opts.person_id ?? acct;
  return {
    id: `${acct}-${issuedAt}`,
    person_id: personId,
    player_account_tag: `#${acct}`,
    clan_id: null,
    rule_id: null,
    war_source: 'manual',
    war_round_id: null,
    war_label: null,
    strike_key: null,
    origin: 'manual',
    issued_at: issuedAt,
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
    player_account: { in_game_name: `Acct ${acct}` },
    ...opts,
  };
}

// N days before NOW, as ISO.
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

describe('buildDossiers', () => {
  it('groups strikes by account and derives the active count/level', () => {
    const dossiers = buildDossiers(
      [strike('A', { issued_at: daysAgo(1) }), strike('A', { issued_at: daysAgo(2) }), strike('B')],
      NOW,
    );
    const a = dossiers.find((d) => d.accountTag === '#A')!;
    const b = dossiers.find((d) => d.accountTag === '#B')!;
    expect(a.status.activeCount).toBe(2);
    expect(a.status.level).toBe('orange');
    expect(b.status.activeCount).toBe(1);
    expect(b.status.level).toBe('green');
  });

  it('judges two accounts of the SAME person independently (never combined)', () => {
    const dossiers = buildDossiers(
      [
        strike('MAIN', { person_id: 'p1', issued_at: daysAgo(1) }),
        strike('MAIN', { person_id: 'p1', issued_at: daysAgo(2) }),
        strike('ALT', { person_id: 'p1', issued_at: daysAgo(3) }),
      ],
      NOW,
    );
    const main = dossiers.find((d) => d.accountTag === '#MAIN')!;
    const alt = dossiers.find((d) => d.accountTag === '#ALT')!;
    expect(main.personId).toBe('p1');
    expect(alt.personId).toBe('p1');
    expect(main.status.activeCount).toBe(2); // not 3 — the alt's strike doesn't count against the main
    expect(alt.status.activeCount).toBe(1);
  });

  it('excludes expired strikes from the active set but keeps them in history', () => {
    const d = buildDossiers([strike('A', { issued_at: daysAgo(120) }), strike('A', { issued_at: daysAgo(3) })], NOW)[0];
    expect(d.strikes).toHaveLength(2);
    expect(d.activeStrikes).toHaveLength(1);
    expect(d.status.activeCount).toBe(1);
  });

  it('sorts strikes newest-first and accounts by severity', () => {
    const dossiers = buildDossiers(
      [strike('B'), strike('A', { issued_at: daysAgo(5) }), strike('A', { issued_at: daysAgo(1) }), strike('A', { issued_at: daysAgo(3) })],
      NOW,
    );
    expect(dossiers[0].accountTag).toBe('#A'); // 3 active > B's 1
    expect(dossiers[0].strikes[0].issued_at).toBe(daysAgo(1)); // newest first
  });
});

describe('buildWorklist', () => {
  it('lists active, not-yet-approved dossiers as unresolved (war-ineligible)', () => {
    const dossiers = buildDossiers(
      [
        strike('A'),                             // active, unapproved -> unresolved
        strike('B', { leadership_approved: true }), // active, approved -> war-eligible, not unresolved
      ],
      NOW,
    );
    const wl = buildWorklist(dossiers, NOW);
    expect(wl.unresolved.map((d) => d.accountTag)).toEqual(['#A']);
  });

  it('surfaces Elder-restoration when active strikes are all approved', () => {
    const dossiers = buildDossiers([strike('A', { leadership_approved: true })], NOW);
    const wl = buildWorklist(dossiers, NOW);
    expect(wl.eligibleForElderRestoration.map((d) => d.accountTag)).toEqual(['#A']);
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
    expect(wl.removalFlagged.map((d) => d.accountTag)).toEqual(['#A']);
  });

  it('lists strikes expiring within the soon-window', () => {
    const dossiers = buildDossiers(
      [strike('A', { issued_at: daysAgo(80) }), strike('B', { issued_at: daysAgo(10) })],
      NOW,
    );
    const wl = buildWorklist(dossiers, NOW);
    // A expires in ~10 days (within 14); B expires in ~80 days (not soon).
    expect(wl.expiringSoon.map((d) => d.accountTag)).toEqual(['#A']);
  });
});
