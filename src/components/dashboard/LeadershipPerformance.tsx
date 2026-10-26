'use client';

import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, ChevronLeft, Activity } from 'lucide-react';
import LineChart, { ChartSeries } from '@/components/charts/LineChart';

type Granularity = 'weekly' | 'monthly';
type Action = { logged_by: string | null; logged_at: string | null };

type LeaderAgg = {
  tag: string;
  name: string;
  color: string;
  total: number;
  counts: number[];
};

const OVERALL_COLOR = '#22C55E';
// Distinct, on-theme palette for individual leaders (excludes the overall green).
const LEADER_COLORS = ['#38BDF8', '#F59E0B', '#A78BFA', '#F472B6', '#34D399', '#FB7185', '#FBBF24', '#60A5FA'];

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

function buildBuckets(granularity: Granularity) {
  const buckets: { key: string; label: string }[] = [];
  const now = new Date();
  if (granularity === 'weekly') {
    const start = startOfWeek(now);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(start);
      d.setDate(d.getDate() - i * 7);
      buckets.push({
        key: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      });
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString(undefined, { month: 'short' }),
      });
    }
  }
  return buckets;
}

function bucketKeyFor(date: Date, granularity: Granularity) {
  if (granularity === 'weekly') return startOfWeek(date).toISOString().slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function LeadershipPerformance({ selectedClanId }: { selectedClanId: string }) {
  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState<{ actions: Action[]; names: Record<string, string> }>({ actions: [], names: {} });
  const [selected, setSelected] = useState<string | null>(null);

  // The fetch depends on the clan only; bucketing is derived below, so the 12W / 6M toggle re-buckets
  // what is already loaded instead of downloading it again.
  useEffect(() => {
    let current = true;
    (async () => {
      setLoading(true);
      try {
        // Each leadership "action" = a warning logged, attributed to the actor's player_tag (logged_by)
        // and timestamped (logged_at). The route also names every actor.
        const res = await fetch(`/api/views/leadership?clanId=${encodeURIComponent(selectedClanId)}`);
        if (!res.ok) throw new Error(`Leadership activity load failed (${res.status})`);
        const data = await res.json();
        if (current) setRaw({ actions: (data.actions as Action[]) || [], names: data.names || {} });
      } catch (err) {
        console.error('Leadership performance error:', err);
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [selectedClanId]);

  const { buckets, overall, leaders } = useMemo(() => {
    const bkts = buildBuckets(granularity);
    const idxByKey = new Map(bkts.map((b, i) => [b.key, i]));
    const overallCounts = new Array(bkts.length).fill(0);
    const byTag = new Map<string, number[]>();

    for (const r of raw.actions) {
      const tag = r.logged_by;
      if (!tag || !r.logged_at) continue;
      const idx = idxByKey.get(bucketKeyFor(new Date(r.logged_at), granularity));
      if (idx === undefined) continue;
      overallCounts[idx]++;
      if (!byTag.has(tag)) byTag.set(tag, new Array(bkts.length).fill(0));
      byTag.get(tag)![idx]++;
    }

    const aggs: LeaderAgg[] = Array.from(byTag.keys())
      .map(tag => {
        const counts = byTag.get(tag)!;
        return { tag, name: raw.names[tag] || tag, color: '', total: counts.reduce((a, b) => a + b, 0), counts };
      })
      .sort((a, b) => b.total - a.total)
      .map((l, i) => ({ ...l, color: LEADER_COLORS[i % LEADER_COLORS.length] }));

    return { buckets: bkts, overall: overallCounts, leaders: aggs };
  }, [raw, granularity]);

  const selectedLeader = leaders.find(l => l.tag === selected) || null;

  const series: ChartSeries[] = useMemo(() => {
    const toPoints = (counts: number[]) => counts.map((c, i) => ({ x: buckets[i]?.label ?? '', y: c }));
    if (selectedLeader) {
      return [
        { label: 'All leaders', color: 'rgba(148,163,184,0.9)', points: toPoints(overall), dashed: true },
        { label: selectedLeader.name, color: selectedLeader.color, points: toPoints(selectedLeader.counts), fill: true },
      ];
    }
    return [{ label: 'All leadership', color: OVERALL_COLOR, points: toPoints(overall), fill: true }];
  }, [buckets, overall, selectedLeader]);

  const totalActions = overall.reduce((a, b) => a + b, 0);
  const activeLeaders = leaders.filter(l => l.total > 0).length;
  const perPeriod = buckets.length ? (totalActions / buckets.length).toFixed(1) : '0';
  const periodWord = granularity === 'weekly' ? 'wk' : 'mo';
  const maxTotal = Math.max(1, ...leaders.map(l => l.total));

  return (
    <div className="card">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <TrendingUp size={18} className="text-cta" />
            <h3 style={{ fontSize: '1rem', margin: 0 }}>Leadership Performance</h3>
          </div>
          {selectedLeader ? (
            <button
              onClick={() => setSelected(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.75rem', marginTop: '4px', padding: 0 }}
            >
              <ChevronLeft size={13} /> All leaders <span style={{ color: 'var(--color-text)' }}>›&nbsp;{selectedLeader.name}</span>
            </button>
          ) : (
            <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>Warnings logged over time. Click a leader to drill in.</p>
          )}
        </div>

        {/* Granularity toggle */}
        <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-md)', padding: '2px' }}>
          {(['weekly', 'monthly'] as Granularity[]).map(g => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              style={{
                padding: '4px 12px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer',
                border: 'none', borderRadius: 'calc(var(--radius-md) - 2px)',
                background: granularity === g ? 'rgba(34,197,94,0.15)' : 'transparent',
                color: granularity === g ? 'var(--color-cta)' : 'var(--color-muted)',
              }}
            >
              {g === 'weekly' ? '12W' : '6M'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 'var(--space-xl)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{loading ? '—' : totalActions}</div>
          <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', marginTop: '2px' }}>Total actions</div>
        </div>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{loading ? '—' : activeLeaders}</div>
          <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', marginTop: '2px' }}>Active leaders</div>
        </div>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{loading ? '—' : `${perPeriod}/${periodWord}`}</div>
          <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', marginTop: '2px' }}>Avg cadence</div>
        </div>
      </div>

      {/* Chart */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 280 }}>
          <Activity className="animate-spin text-muted" size={20} />
        </div>
      ) : (
        <LineChart
          series={series}
          granularityLabel={granularity === 'weekly' ? 'Weekly' : 'Monthly'}
          ariaSummary={
            selectedLeader
              ? `${selectedLeader.name} recorded ${selectedLeader.total} leadership actions over the period.`
              : `Leadership recorded ${totalActions} actions across ${activeLeaders} leaders over the period.`
          }
        />
      )}

      {/* Leader breakdown — clickable to drill down */}
      {!loading && leaders.length > 0 && (
        <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
          {leaders.map(l => {
            const active = l.tag === selected;
            return (
              <button
                key={l.tag}
                onClick={() => setSelected(active ? null : l.tag)}
                style={{
                  display: 'grid', gridTemplateColumns: '12px 1fr 90px 36px', alignItems: 'center', gap: 'var(--space-md)',
                  background: active ? 'rgba(255,255,255,0.04)' : 'transparent', border: 'none', cursor: 'pointer',
                  padding: '6px 8px', borderRadius: 'var(--radius-md)', textAlign: 'left', width: '100%',
                }}
                aria-pressed={active}
              >
                <span style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                <span style={{ fontSize: '0.85rem', fontWeight: active ? 700 : 500, color: active ? 'var(--color-text)' : 'var(--color-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                <span style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${(l.total / maxTotal) * 100}%`, background: l.color, borderRadius: 3 }} />
                </span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.total}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
