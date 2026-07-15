'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { CWLRound, CWLWarMember } from '@/types/database';
import { computeSeasonPerformance, type MemberPerf } from '@/lib/cwl/performance';

type SortKey = 'totalStars' | 'attacksUsed' | 'avgDestruction' | 'missed' | 'name';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'totalStars', label: 'Total stars' },
  { key: 'attacksUsed', label: 'Attacks used' },
  { key: 'avgDestruction', label: 'Avg destruction' },
  { key: 'missed', label: 'Missed attacks' },
  { key: 'name', label: 'Name' },
];

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--color-muted)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const dash = (n: number | null, suffix = '') => (n === null ? '—' : `${n.toFixed(1)}${suffix}`);

/** Season-wide per-member CWL performance recognition (not a ranking). Reads the stored round data. */
export default function PerformancePanel({ rounds, members }: { rounds: CWLRound[]; members: CWLWarMember[] }) {
  const [sort, setSort] = useState<SortKey>('totalStars');
  const { perMember, totals } = useMemo(() => computeSeasonPerformance(rounds, members), [rounds, members]);

  const sorted = useMemo(() => {
    const rows = perMember.slice();
    rows.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      const av = (a[sort] as number | null) ?? -1;
      const bv = (b[sort] as number | null) ?? -1;
      return bv - av;
    });
    return rows;
  }, [perMember, sort]);

  if (perMember.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
        <BarChart3 size={24} className="text-muted" style={{ marginBottom: 'var(--space-sm)' }} />
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>No performance data yet for this season.</p>
      </div>
    );
  }

  const cell = (m: MemberPerf) => (
    <tr key={m.key} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <td style={{ ...td, textAlign: 'left', fontWeight: 500 }}>{m.name}</td>
      <td style={td}>{m.roundsPlayed}</td>
      <td style={td}>{m.attacksUsed}</td>
      <td style={td}>{m.totalStars}</td>
      <td style={td}>{dash(m.avgDestruction, '%')}</td>
      <td style={{ ...td, color: m.missed > 0 ? 'var(--color-danger)' : undefined, fontWeight: m.missed > 0 ? 700 : 400 }}>{m.missed}</td>
    </tr>
  );

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <BarChart3 size={16} className="text-cta" />
          <div>
            <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Season Performance</h3>
            <p className="text-muted" style={{ fontSize: '0.72rem', margin: '2px 0 0' }}>Recognising war effort across all rounds — not a ranking.</p>
          </div>
        </div>
        <select className="input" style={{ width: 'auto', padding: '6px 10px' }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Member</th>
              <th style={th}>Rounds</th>
              <th style={th}>Attacks</th>
              <th style={th}>Stars</th>
              <th style={th}>Avg %</th>
              <th style={th}>Missed</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(cell)}
            <tr style={{ borderTop: '2px solid rgba(255,255,255,0.1)' }}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{totals.name}</td>
              <td style={{ ...td, fontWeight: 700 }}>{totals.roundsPlayed}</td>
              <td style={{ ...td, fontWeight: 700 }}>{totals.attacksUsed}</td>
              <td style={{ ...td, fontWeight: 700 }}>{totals.totalStars}</td>
              <td style={{ ...td, fontWeight: 700 }}>{dash(totals.avgDestruction, '%')}</td>
              <td style={{ ...td, fontWeight: 700, color: totals.missed > 0 ? 'var(--color-danger)' : undefined }}>{totals.missed}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
