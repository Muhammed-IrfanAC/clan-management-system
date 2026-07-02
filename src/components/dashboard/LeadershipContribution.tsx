'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Award, Activity } from 'lucide-react';
import { OnboardingEvent } from '@/types/database';
import {
  computeContributions,
  ContributionPeriod,
  ContributionRow,
  RecruitmentLog,
} from '@/lib/contribution';

const PERIODS: { key: ContributionPeriod; label: string }[] = [
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'all', label: 'ALL' },
];

// Sortable columns. Counts sort high→low; avg time sorts fast→slow (nulls last).
type SortKey = 'babiesMade' | 'conversion' | 'avgOnboardingDays' | 'engagementAttempts' | 'recruitReplies' | 'discordInvites' | 'discordJoins' | 'linkedChecked';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'babiesMade', label: 'Babies made' },
  { key: 'conversion', label: 'Conversion' },
  { key: 'avgOnboardingDays', label: 'Avg time' },
  { key: 'engagementAttempts', label: 'Engagement' },
  { key: 'recruitReplies', label: 'Replies' },
  { key: 'discordInvites', label: 'Discord invites' },
  { key: 'discordJoins', label: 'Discord joins' },
  { key: 'linkedChecked', label: 'Linked accounts' },
];

const fmtDays = (d: number | null) =>
  d == null ? '—' : d < 1 ? `${Math.max(1, Math.round(d * 24))}h` : `${d.toFixed(1)}d`;
const fmtPct = (c: number | null) => (c == null ? '—' : `${Math.round(c * 100)}%`);

function sortRows(rows: ContributionRow[], key: SortKey): ContributionRow[] {
  return [...rows].sort((a, b) => {
    if (key === 'avgOnboardingDays') {
      // Fastest first; leaders with no promotions sink to the bottom.
      if (a.avgOnboardingDays == null) return 1;
      if (b.avgOnboardingDays == null) return -1;
      return a.avgOnboardingDays - b.avgOnboardingDays;
    }
    const av = (a[key] as number | null) ?? -1;
    const bv = (b[key] as number | null) ?? -1;
    return bv - av;
  });
}

export default function LeadershipContribution({ selectedClanId }: { selectedClanId: string }) {
  const [period, setPeriod] = useState<ContributionPeriod>('30d');
  const [sortKey, setSortKey] = useState<SortKey>('babiesMade');
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{ rows: ContributionRow[]; totals: ContributionRow } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Family-wide fetch, then scope by clan in JS via each person's RECRUITMENT clan — onboarding
      // events themselves mostly carry no clan_id, so the recruitment log is the reliable clan anchor.
      const [{ data: rawEvents }, { data: rawRecruits }] = await Promise.all([
        supabase.from('onboarding_events').select('event_type, actor_tag, outcome, person_id, created_at'),
        supabase.from('leadership_logs').select('logged_by, related_person_id, logged_at, clan_id').eq('category', 'recruitment'),
      ]);

      const events = (rawEvents as unknown as OnboardingEvent[]) || [];
      const recruits = (rawRecruits as (RecruitmentLog & { clan_id: string | null })[]) || [];

      // person_id → clan of the earliest recruitment log (the clan that recruited them).
      const personClan = new Map<string, string | null>();
      const personRecruitAt = new Map<string, number>();
      for (const r of recruits) {
        if (!r.related_person_id || !r.logged_at) continue;
        const at = new Date(r.logged_at).getTime();
        const prev = personRecruitAt.get(r.related_person_id);
        if (prev === undefined || at < prev) {
          personRecruitAt.set(r.related_person_id, at);
          personClan.set(r.related_person_id, r.clan_id);
        }
      }

      const clanScoped = selectedClanId !== 'all';
      const scopedEvents = clanScoped
        ? events.filter(e => personClan.get(e.person_id) === selectedClanId)
        : events;
      const scopedRecruits = clanScoped
        ? recruits.filter(r => r.clan_id === selectedClanId)
        : recruits;

      // Onboarding-time baseline: persons.created_at for the recruited cohort.
      const personIds = Array.from(new Set(scopedRecruits.map(r => r.related_person_id).filter(Boolean) as string[]));
      const personsCreatedAt: Record<string, string> = {};
      if (personIds.length) {
        const { data: persons } = await supabase.from('persons').select('id, created_at').in('id', personIds);
        for (const p of (persons as { id: string; created_at: string }[] | null) || []) {
          personsCreatedAt[p.id] = p.created_at;
        }
      }

      // Resolve leader tags → display names (persona name, else in-game name, else tag).
      const tags = Array.from(new Set([
        ...scopedEvents.map(e => e.actor_tag),
        ...scopedRecruits.map(r => r.logged_by),
      ].filter(Boolean) as string[]));
      const nameByTag: Record<string, string> = {};
      if (tags.length) {
        const { data: accts } = await supabase
          .from('player_accounts')
          .select('player_tag, in_game_name, person:persons (display_name)')
          .in('player_tag', tags);
        type AcctRow = { player_tag: string; in_game_name: string | null; person: { display_name: string } | null };
        for (const a of (accts as AcctRow[] | null) || []) {
          nameByTag[a.player_tag] = a.person?.display_name || a.in_game_name || a.player_tag;
        }
      }

      const res = computeContributions(scopedEvents, scopedRecruits, personsCreatedAt, period, new Date(), nameByTag);
      setResult(res);
    } catch (err) {
      console.error('Leadership contribution error:', err);
      setResult({ rows: [], totals: computeContributions([], [], {}, period, new Date(), {}).totals });
    } finally {
      setLoading(false);
    }
  }, [selectedClanId, period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount / clan / period change
    fetchData();
  }, [fetchData]);

  const sortedRows = useMemo(() => (result ? sortRows(result.rows, sortKey) : []), [result, sortKey]);

  const COLS: { key: SortKey; label: string; render: (r: ContributionRow) => string }[] = [
    { key: 'babiesMade', label: 'Babies', render: r => String(r.babiesMade) },
    { key: 'conversion', label: 'Conv.', render: r => fmtPct(r.conversion) },
    { key: 'avgOnboardingDays', label: 'Avg time', render: r => fmtDays(r.avgOnboardingDays) },
    { key: 'engagementAttempts', label: 'Engage', render: r => String(r.engagementAttempts) },
    { key: 'recruitReplies', label: 'Replies', render: r => String(r.recruitReplies) },
    { key: 'discordInvites', label: 'Disc. inv', render: r => String(r.discordInvites) },
    { key: 'discordJoins', label: 'Disc. join', render: r => String(r.discordJoins) },
    { key: 'linkedChecked', label: 'Linked', render: r => String(r.linkedChecked) },
  ];

  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--color-muted)', fontWeight: 700, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

  return (
    <div className="card">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <Award size={18} className="text-cta" />
            <h3 style={{ fontSize: '1rem', margin: 0 }}>Leadership Contributions</h3>
          </div>
          <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>Recognising culture-building work — not a ranking.</p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Sort control */}
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="input"
            style={{ padding: '4px 8px', fontSize: '0.72rem', width: 'auto' }}
            aria-label="Sort leaders by"
          >
            {SORTS.map(s => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
          </select>
          {/* Period toggle */}
          <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-md)', padding: '2px' }}>
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                style={{
                  padding: '4px 12px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer',
                  border: 'none', borderRadius: 'calc(var(--radius-md) - 2px)',
                  background: period === p.key ? 'rgba(34,197,94,0.15)' : 'transparent',
                  color: period === p.key ? 'var(--color-cta)' : 'var(--color-muted)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160 }}>
          <Activity className="animate-spin text-muted" size={20} />
        </div>
      ) : !result || result.rows.length === 0 ? (
        <p className="text-muted" style={{ padding: 'var(--space-xl)', textAlign: 'center', fontSize: '0.85rem' }}>
          No contribution data yet for this clan / period.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th style={{ ...th, textAlign: 'left' }}>Leader</th>
                {COLS.map(c => (
                  <th
                    key={c.key}
                    style={{ ...th, cursor: 'pointer', color: sortKey === c.key ? 'var(--color-cta)' : 'var(--color-muted)' }}
                    onClick={() => setSortKey(c.key)}
                    title="Sort by this metric"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Family totals row */}
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{result.totals.name}</td>
                {COLS.map(c => (
                  <td key={c.key} style={{ ...td, fontWeight: 700 }}>{c.render(result.totals)}</td>
                ))}
              </tr>
              {sortedRows.map(r => (
                <tr key={r.tag} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</td>
                  {COLS.map(c => (
                    <td key={c.key} style={{ ...td, color: sortKey === c.key ? 'var(--color-text)' : 'var(--color-muted)' }}>{c.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
