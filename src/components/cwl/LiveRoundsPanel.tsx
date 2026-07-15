'use client';

import { useState } from 'react';
import { Swords, ChevronDown, ChevronRight, Star } from 'lucide-react';
import type { CWLRound, CWLWarMember } from '@/types/database';

const STATE_LABEL: Record<string, string> = {
  preparation: 'Prep', inWar: 'Battle Day', warEnded: 'Ended',
};

/** Live per-round CWL lineups for the season, grouped by family clan. Read-only — filled by sync. */
export default function LiveRoundsPanel({
  rounds,
  members,
  clanName,
}: {
  rounds: CWLRound[];
  members: CWLWarMember[];
  clanName: (clanId: string) => string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (rounds.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
        <Swords size={24} className="text-muted" style={{ marginBottom: 'var(--space-sm)' }} />
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          No live rounds yet — run a sync during CWL week to pull lineups.
        </p>
      </div>
    );
  }

  const membersByRound = new Map<string, CWLWarMember[]>();
  for (const m of members) {
    if (!membersByRound.has(m.round_id)) membersByRound.set(m.round_id, []);
    membersByRound.get(m.round_id)!.push(m);
  }

  // Group rounds by family clan, each sorted by round number.
  const byClan = new Map<string, CWLRound[]>();
  for (const r of rounds) {
    if (!byClan.has(r.clan_id)) byClan.set(r.clan_id, []);
    byClan.get(r.clan_id)!.push(r);
  }
  for (const list of byClan.values()) list.sort((a, b) => a.round_number - b.round_number);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {Array.from(byClan.entries()).map(([clanId, clanRounds]) => (
        <div key={clanId} className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>{clanName(clanId)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            {clanRounds.map((r) => {
              const isOpen = !!open[r.id];
              const roster = (membersByRound.get(r.id) || []).slice().sort((a, b) => (a.map_position ?? 99) - (b.map_position ?? 99));
              const ended = r.state === 'warEnded';
              return (
                <div key={r.id}>
                  <button
                    onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}
                    style={{
                      display: 'grid', gridTemplateColumns: '18px 1fr auto', alignItems: 'center', gap: 'var(--space-sm)',
                      background: 'transparent', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                      padding: '6px 4px', borderRadius: 'var(--radius-md)',
                    }}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                    <span style={{ fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: 600 }}>Round {r.round_number}</span>
                      <span className="text-muted"> vs {r.opponent_name || '—'}</span>
                      <span className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', marginLeft: 6 }}>{STATE_LABEL[r.state] || r.state}</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
                      <Star size={12} className="text-cta" /> {r.our_stars}
                      <span className="text-muted"> · {Math.round(r.our_destruction)}% · {r.our_attacks_used}/{r.team_size ?? '—'}</span>
                    </span>
                  </button>

                  {isOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 4px 8px 26px' }}>
                      {roster.length === 0 && <span className="text-muted" style={{ fontSize: '0.8rem' }}>No lineup recorded.</span>}
                      {roster.map((m) => {
                        const missed = m.attacks_used === 0 && ended;
                        return (
                          <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.8rem' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{m.map_position ?? '—'}. </span>
                              {m.name || m.player_tag}
                              <span className="text-muted" style={{ fontSize: '0.7rem' }}> · TH{m.th_level ?? '—'}</span>
                            </span>
                            {missed ? (
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-danger)', letterSpacing: '0.04em' }}>MISSED</span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
                                {m.attacks_used > 0 ? (
                                  <>
                                    <Star size={11} className="text-cta" /> {m.stars} <span className="text-muted">· {Math.round(m.destruction)}%</span>
                                  </>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: '0.7rem' }}>not yet</span>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
