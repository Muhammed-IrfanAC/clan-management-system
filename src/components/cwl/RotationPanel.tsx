'use client';

import { useMemo } from 'react';
import { Repeat, Users } from 'lucide-react';
import type { CWLRound, CWLWarMember } from '@/types/database';
import { suggestClanRotation, roundsPlayedByPerson, type ClanRotation } from '@/lib/cwl/rotation';
import type { RosterPlayer } from './types';

const th: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--color-muted)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/**
 * Forward-looking bench rotation: for every not-yet-locked round it suggests who sits, distributing
 * bench days evenly using each person's rounds-played so far. Read-only planning aid — the leader
 * still sets lineups in-game.
 */
export default function RotationPanel({
  players,
  seasonClans,
  clans,
  rounds,
  members,
}: {
  players: RosterPlayer[];
  seasonClans: { clanId: string; warSize: number }[];
  clans: { id: string; display_name: string }[];
  rounds: CWLRound[];
  members: CWLWarMember[];
}) {
  const clanName = (id: string) => clans.find((c) => c.id === id)?.display_name ?? 'Unknown clan';

  const rotations = useMemo<ClanRotation[]>(() => {
    return seasonClans.map((sc) => {
      // The signed roster for this clan (recommended there, not removed from the season).
      const roster = players
        .filter((p) => p.recommendedClanId === sc.clanId && p.status !== 'removed')
        .map((p) => ({ personId: p.personId, name: p.name, thLevel: p.thLevel, league: p.league, playedSoFar: 0 }));

      // Seed each person's rounds already fought, and treat those round numbers as locked.
      const played = roundsPlayedByPerson(rounds, members, sc.clanId);
      for (const r of roster) r.playedSoFar = played.get(r.personId) ?? 0;
      const lockedRoundNumbers = rounds.filter((r) => r.clan_id === sc.clanId).map((r) => r.round_number);

      return suggestClanRotation(sc.clanId, roster, sc.warSize, lockedRoundNumbers);
    });
  }, [players, seasonClans, rounds, members]);

  const anyRoster = rotations.some((r) => r.rosterSize > 0);
  if (!anyRoster) {
    return (
      <div className="card" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
        <Repeat size={24} className="text-muted" style={{ marginBottom: 'var(--space-sm)' }} />
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          No roster yet — allocate players to suggest a bench rotation.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {rotations.map((rot) => (
        <div key={rot.clanId} className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{clanName(rot.clanId)}</div>
            <span className="text-muted" style={{ fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums' }}>
              roster {rot.rosterSize} · war {rot.warSize} · {rot.remainingRoundNumbers.length} round{rot.remainingRoundNumbers.length === 1 ? '' : 's'} left
            </span>
          </div>

          {rot.rosterSize === 0 ? (
            <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>No players allocated to this clan.</p>
          ) : rot.noBenchNeeded ? (
            <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
              Roster fits the war size — everyone plays every round, no benching needed.
            </p>
          ) : rot.remainingRoundNumbers.length === 0 ? (
            <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
              All {rot.totalRounds} rounds already have live lineups — nothing left to plan.
            </p>
          ) : (
            <>
              {/* Per-round bench suggestion — the actionable "who sits" list. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'var(--space-md)' }}>
                {rot.rounds.map((r) => (
                  <div key={r.roundNumber} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'baseline', gap: 'var(--space-sm)', padding: '4px 0' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Round {r.roundNumber}</span>
                    <span style={{ fontSize: '0.8rem' }}>
                      <span className="text-muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: 6 }}>Bench</span>
                      {r.bench.length === 0
                        ? <span className="text-muted">— nobody</span>
                        : r.bench.map((s, i) => (
                            <span key={s.personId}>
                              {i > 0 && <span className="text-muted">, </span>}
                              {s.name}<span className="text-muted" style={{ fontSize: '0.68rem' }}> TH{s.thLevel}</span>
                            </span>
                          ))}
                    </span>
                  </div>
                ))}
              </div>

              {/* Fairness summary — projected war days per player so leaders can see the balance. */}
              <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: 'var(--color-muted)', letterSpacing: '0.05em', marginBottom: 4 }}>Projected war days</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: 'left' }}>Member</th>
                      <th style={th} title="Rounds already fought">Played</th>
                      <th style={th} title="Rounds we suggest they play next">Suggested</th>
                      <th style={th} title="Rounds we suggest they sit">Bench</th>
                      <th style={th} title="Projected war days by season end">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rot.summary.map((s) => (
                      <tr key={s.personId} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 500 }}>{s.name}</td>
                        <td style={td}>{s.playedSoFar}</td>
                        <td style={td}>{s.suggestedPlays}</td>
                        <td style={{ ...td, color: s.benchRounds > 0 ? 'var(--color-muted)' : undefined }}>{s.benchRounds}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{s.projectedTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
