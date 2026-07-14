'use client';

import { useMemo, useState } from 'react';
import { TrendingUp, AlertTriangle, BarChart3, Users } from 'lucide-react';
import LineChart, { type ChartSeries } from '@/components/charts/LineChart';
import type { CareerHistory, CareerStat } from '@/lib/cwl/history';

type SortKey = 'totalStars' | 'seasonsPlayed' | 'attacksUsed' | 'avgDestruction' | 'missed' | 'name';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'totalStars', label: 'Total stars' },
  { key: 'seasonsPlayed', label: 'Seasons' },
  { key: 'attacksUsed', label: 'Attacks used' },
  { key: 'avgDestruction', label: 'Avg destruction' },
  { key: 'missed', label: 'Missed attacks' },
  { key: 'name', label: 'Name' },
];

const STARS_COLOR = 'rgba(96,165,250,0.95)';
const PARTICIPANTS_COLOR = 'rgba(52,211,153,0.95)';

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--color-muted)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const dash = (n: number | null, suffix = '') => (n === null ? '—' : `${n.toFixed(1)}${suffix}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Cross-season CWL history: family trends, repeat missed-attackers, and a per-person career table. */
export default function HistoryView({ history }: { history: CareerHistory }) {
  const { perPerson, trend, repeatMissers, totalSeasonsWithData } = history;
  const [sort, setSort] = useState<SortKey>('totalStars');

  const sorted = useMemo(() => {
    const rows = perPerson.slice();
    rows.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      const av = (a[sort] as number | null) ?? -1;
      const bv = (b[sort] as number | null) ?? -1;
      return bv - av;
    });
    return rows;
  }, [perPerson, sort]);

  const repeatKeys = useMemo(() => new Set(repeatMissers.map((p) => p.key)), [repeatMissers]);

  const starsSeries: ChartSeries[] = [{ label: 'Stars per attack', color: STARS_COLOR, points: trend.map((t) => ({ x: t.label, y: t.starsPerAttack ?? 0 })), fill: true }];
  const participantsSeries: ChartSeries[] = [{ label: 'Members fielded', color: PARTICIPANTS_COLOR, points: trend.map((t) => ({ x: t.label, y: t.participants })), fill: true }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {/* Family Trends */}
      <div className="card" style={{ padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
          <TrendingUp size={16} className="text-cta" />
          <div>
            <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Family Trends</h3>
            <p className="text-muted" style={{ fontSize: '0.72rem', margin: '2px 0 0' }}>How the family has warred across {totalSeasonsWithData} season{totalSeasonsWithData === 1 ? '' : 's'}.</p>
          </div>
        </div>
        {trend.length < 2 ? (
          <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>Trends appear once at least two seasons have synced round data.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-lg)' }}>
            <div>
              <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: 4 }}>Stars per attack</div>
              <LineChart series={starsSeries} granularityLabel="Per season" height={220} ariaSummary="Average stars per CWL attack across seasons, oldest to newest." />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: 4 }}>Members fielded</div>
              <LineChart series={participantsSeries} granularityLabel="Per season" height={220} ariaSummary="Distinct members fielded in CWL across seasons, oldest to newest." />
            </div>
          </div>
        )}
      </div>

      {/* Repeat Missed-Attackers */}
      <div className="card" style={{ padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
          <AlertTriangle size={16} style={{ color: 'var(--color-danger)' }} />
          <div>
            <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Repeat Missed-Attackers</h3>
            <p className="text-muted" style={{ fontSize: '0.72rem', margin: '2px 0 0' }}>Members who missed attacks in more than one season.</p>
          </div>
        </div>
        {repeatMissers.length === 0 ? (
          <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>No repeat missed-attackers — nice.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            {repeatMissers.map((p) => (
              <div key={p.key} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 'var(--space-sm)', padding: '6px 8px', borderRadius: 'var(--radius-md)', background: 'rgba(248,113,113,0.06)' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  missed in {p.seasonsMissedIn} seasons · {p.missed} total
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Career Table */}
      <div className="card" style={{ padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <BarChart3 size={16} className="text-cta" />
            <div>
              <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Career Record</h3>
              <p className="text-muted" style={{ fontSize: '0.72rem', margin: '2px 0 0' }}>Every member's CWL history across all seasons — recognition, not a ranking.</p>
            </div>
          </div>
          <select className="input" style={{ width: 'auto', padding: '6px 10px' }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
          </select>
        </div>

        {perPerson.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-lg)' }}>
            <Users size={24} className="text-muted" style={{ marginBottom: 'var(--space-sm)' }} />
            <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>No career data yet — history appears after your first synced season.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Member</th>
                  <th style={th}>Seasons</th>
                  <th style={th}>Attend</th>
                  <th style={th}>Rounds</th>
                  <th style={th}>Attacks</th>
                  <th style={th}>Stars</th>
                  <th style={th}>Avg %</th>
                  <th style={th}>Missed</th>
                  <th style={th}>Miss %</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m: CareerStat) => {
                  const flagged = repeatKeys.has(m.key);
                  return (
                    <tr key={m.key} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 500 }}>{m.name}</td>
                      <td style={td}>{m.seasonsPlayed}</td>
                      <td style={td}>{pct(m.attendanceRate)}</td>
                      <td style={td}>{m.roundsPlayed}</td>
                      <td style={td}>{m.attacksUsed}</td>
                      <td style={td}>{m.totalStars}</td>
                      <td style={td}>{dash(m.avgDestruction, '%')}</td>
                      <td style={{ ...td, color: m.missed > 0 ? 'var(--color-danger)' : undefined, fontWeight: flagged ? 700 : m.missed > 0 ? 600 : 400 }}>{m.missed}</td>
                      <td style={{ ...td, color: flagged ? 'var(--color-danger)' : undefined }}>{m.missedRate === null ? '—' : pct(m.missedRate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
