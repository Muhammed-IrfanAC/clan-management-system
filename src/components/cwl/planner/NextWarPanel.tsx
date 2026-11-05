'use client';

import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { usePlan } from './usePlan';
import LineupPostModal from './LineupPostModal';
import { useCwlPlannerStore } from '@/lib/stores/cwlPlannerStore';
import { BENCH_REASON, pct, SLOT_REASON, TIER_COLOR, UNAVAILABLE_REASON } from './labels';

const th: React.CSSProperties = { textAlign: 'left', padding: '5px 8px', fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--color-muted)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '5px 8px', fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/**
 * The next war that can still be changed: the suggested lineup in mirror order against the enemy
 * base each account would hit, with the planner's reason for every slot and every bench.
 */
export default function NextWarPanel() {
  const plan = usePlan();
  const rounds = useCwlPlannerStore((s) => s.rounds);
  const [posting, setPosting] = useState(false);
  const next = plan.rounds[0];

  if (!next) {
    return <div className="card text-muted" style={{ padding: 'var(--space-md)', fontSize: '0.85rem' }}>Every war has started — nothing left to plan.</div>;
  }
  const stored = rounds.find((r) => r.round_number === next.roundNumber);

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>
          War {next.roundNumber}
          <span className="text-muted" style={{ fontWeight: 400 }}>
            {' '}vs {next.enemyKnown ? stored?.opponent_name || 'opponent' : 'not drawn yet'}
          </span>
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
            {next.expectedClanStars.toFixed(1)} expected stars
            {!next.enemyKnown && ' · scored against the clans still to face'}
          </span>
          <button className="btn btn-outline" onClick={() => setPosting(true)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            <Megaphone size={14} /> Post to Discord
          </button>
        </div>
      </div>
      {posting && <LineupPostModal onClose={() => setPosting(false)} />}

      {(next.shortBy > 0 || next.overForced) && (
        <div style={{ fontSize: '0.78rem', color: 'var(--color-warning)', marginBottom: 'var(--space-sm)' }}>
          {next.shortBy > 0 && `Lineup is ${next.shortBy} short — not enough accounts available. `}
          {next.overForced && 'More accounts are forced in than the war has slots; the weakest of them were dropped.'}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>#</th>
              <th style={th}>Account</th>
              <th style={th}>TH</th>
              <th style={th}>Rating</th>
              <th style={th}>Hits</th>
              <th style={{ ...th, textAlign: 'right' }} title="Chance to triple the base at this slot">3★</th>
              <th style={{ ...th, textAlign: 'right' }}>Exp. ★</th>
              <th style={th}>Why</th>
            </tr>
          </thead>
          <tbody>
            {next.lineup.map((s) => (
              <tr key={s.playerTag} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ ...td, color: 'var(--color-muted)' }}>{s.mapPosition}</td>
                <td style={td}>{s.name}</td>
                <td style={td}>{s.thLevel}</td>
                <td style={{ ...td, color: TIER_COLOR[s.tier], fontWeight: s.tier === 'goat' ? 700 : undefined }}>{s.tier}</td>
                <td style={td}>
                  {s.enemyTh != null ? (
                    <span style={{ color: s.enemyTh > s.thLevel ? 'var(--color-warning)' : undefined }}>
                      TH{s.enemyTh}
                      {s.enemyTh > s.thLevel && ` (+${s.enemyTh - s.thLevel})`}
                    </span>
                  ) : (
                    <span className="text-muted">mirror</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{pct(s.tripleChance)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{s.expectedStars.toFixed(2)}</td>
                <td style={{ ...td, color: s.reason === 'forced_in' ? 'var(--color-cta)' : 'var(--color-muted)', fontSize: '0.75rem' }}>{SLOT_REASON[s.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(next.bench.length > 0 || next.unavailable.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
          {next.bench.length > 0 && (
            <SideList title="Bench" items={next.bench.map((b) => ({ key: b.playerTag, name: b.name, reason: BENCH_REASON[b.reason] }))} />
          )}
          {next.unavailable.length > 0 && (
            <SideList title="Not available" items={next.unavailable.map((u) => ({ key: u.playerTag, name: u.name, reason: UNAVAILABLE_REASON[u.reason] }))} />
          )}
        </div>
      )}
    </div>
  );
}

function SideList({ title, items }: { title: string; items: { key: string; name: string; reason: string }[] }) {
  // Group by reason so each reason is printed once with its names.
  const groups = new Map<string, string[]>();
  for (const i of items) groups.set(i.reason, [...(groups.get(i.reason) ?? []), i.name]);
  return (
    <div>
      <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: 4 }}>
        {title} ({items.length})
      </div>
      {[...groups].map(([reason, names]) => (
        <div key={reason} style={{ fontSize: '0.78rem', marginBottom: 4 }}>
          <span className="text-muted">{reason}:</span> {names.join(', ')}
        </div>
      ))}
    </div>
  );
}
