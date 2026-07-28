'use client';

import { useMemo, useState } from 'react';
import { Swords, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import type { Clan, CWLConstraints, CWLConstraintRule } from '@/types/database';
import { CWL_LEAGUE_MAJORS } from '@/lib/cwl/leagues';
import { useCWLStore } from '@/lib/stores/cwlStore';

interface RuleDraft {
  th: string; // '' = no minimum
  tier: string; // '' = no league gate; otherwise the tier ordinal as a string
  bench: string; // '' = inherit engine default (5 for the season default row)
}

const EMPTY_RULE: RuleDraft = { th: '', tier: '', bench: '' };

function toRule(d: RuleDraft): CWLConstraintRule {
  return {
    minThLevel: d.th.trim() ? parseInt(d.th, 10) : null,
    minLeagueTier: d.tier === '' ? null : parseInt(d.tier, 10),
    maxBench: d.bench.trim() ? Math.max(0, parseInt(d.bench, 10)) : null,
  };
}

function defaultLabel(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * A minimum-league picker at SUB-DIVISION granularity. Each major tier is an <optgroup> holding its
 * three in-game divisions, so "Dragon" is a heading and "Dragon 29" is the thing you actually pick —
 * which is how the game presents it and how leaders talk about it.
 */
function LeagueFloorSelect({
  value,
  onChange,
  anyLabel,
  width = 190,
}: {
  value: string;
  onChange: (value: string) => void;
  anyLabel: string;
  width?: number;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width }}>
      <option value="">{anyLabel}</option>
      {CWL_LEAGUE_MAJORS.map((group) => (
        <optgroup key={group.key} label={group.label}>
          {group.tiers.map((tier) => (
            <option key={tier.ordinal} value={String(tier.ordinal)}>{tier.label}+</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default function CreateSeasonForm({
  clans,
  onCreated,
  onCancel,
}: {
  clans: Clan[];
  onCreated: (seasonId: string) => void;
  onCancel: () => void;
}) {
  const createSeason = useCWLStore((s) => s.createSeason);
  const activeClans = useMemo(() => clans.filter((c) => c.active), [clans]);

  const [label, setLabel] = useState(defaultLabel());
  // `order` is the season's clan pool AS AN ORDERED LIST — position is the fill priority, so
  // selecting a clan appends it and the arrows rearrange who gets filled first.
  const [order, setOrder] = useState<string[]>([]);
  const [warSize, setWarSize] = useState<Record<string, number>>({});
  const [def, setDef] = useState<RuleDraft>(EMPTY_RULE);
  const [overrides, setOverrides] = useState<Record<string, RuleDraft>>({});
  const [showOverrides, setShowOverrides] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const clanName = (id: string) => activeClans.find((c) => c.id === id)?.display_name ?? 'Unknown clan';

  const toggleClan = (id: string) => {
    setOrder((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setWarSize((w) => (w[id] ? w : { ...w, [id]: 15 }));
  };

  const movePriority = (index: number, delta: number) => {
    setOrder((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const submit = async () => {
    if (!label.trim() || order.length === 0) return;
    setSubmitting(true);
    try {
      const perClan: CWLConstraints['perClan'] = {};
      for (const id of order) {
        const o = overrides[id];
        if (o && (o.th.trim() || o.tier || o.bench.trim())) perClan[id] = toRule(o);
      }
      const seasonId = await createSeason({
        label: label.trim(),
        // Index IS the priority — the list above is ordered by the leader for exactly this.
        clans: order.map((id, priority) => ({ clanId: id, warSize: warSize[id] || 15, priority })),
        constraints: { default: toRule(def), perClan },
      });
      if (seasonId) onCreated(seasonId);
    } finally {
      setSubmitting(false);
    }
  };

  const labelStyle = { fontSize: '0.7rem', textTransform: 'uppercase' as const, color: 'var(--color-muted)', marginBottom: '4px', display: 'block' };

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <Swords size={18} className="text-cta" />
        <h3 style={{ fontSize: '1rem', margin: 0 }}>New CWL Season</h3>
      </div>

      {/* Label */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        <label style={labelStyle}>Season label</label>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2026-07" style={{ maxWidth: 220 }} />
      </div>

      {/* Clan pool */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        <label style={labelStyle}>Participating clans</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
          {activeClans.map((c) => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '6px 8px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: order.includes(c.id) ? 'rgba(34,197,94,0.06)' : 'transparent' }}>
              <input type="checkbox" checked={order.includes(c.id)} onChange={() => toggleClan(c.id)} />
              <span style={{ fontSize: '0.9rem', fontWeight: order.includes(c.id) ? 700 : 400 }}>{c.display_name}</span>
              <span className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>{c.clan_type}</span>
            </label>
          ))}
          {activeClans.length === 0 && <p className="text-muted" style={{ fontSize: '0.85rem' }}>No active clans registered.</p>}
        </div>
      </div>

      {/* Fill order — the priority the allocation engine waterfalls down. */}
      {order.length > 0 && (
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <label style={labelStyle}>Fill order</label>
          <p className="text-muted" style={{ fontSize: '0.7rem', margin: '0 0 var(--space-sm)' }}>
            The first clan is filled first and takes the strongest accounts — lineup and bench — and
            only what it can&apos;t hold spills to the next. Keep a clan&apos;s bench small if it should
            not hold reserves the clans below it need.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            {order.map((id, i) => (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: '6px 8px', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}>
                <span className="text-muted" style={{ fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums', width: 20 }}>#{i + 1}</span>
                <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: i === 0 ? 700 : 400 }}>{clanName(id)}</span>
                <select className="input" aria-label={`War size for ${clanName(id)}`} style={{ width: 'auto', padding: '4px 8px', fontSize: '0.78rem' }} value={warSize[id] || 15} onChange={(e) => setWarSize((w) => ({ ...w, [id]: parseInt(e.target.value, 10) }))}>
                  <option value={15}>15v15</option>
                  <option value={30}>30v30</option>
                </select>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button type="button" aria-label={`Move ${clanName(id)} up`} disabled={i === 0} onClick={() => movePriority(i, -1)} style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1, display: 'flex', padding: 3 }}>
                    <ArrowUp size={15} />
                  </button>
                  <button type="button" aria-label={`Move ${clanName(id)} down`} disabled={i === order.length - 1} onClick={() => movePriority(i, 1)} style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: i === order.length - 1 ? 'default' : 'pointer', opacity: i === order.length - 1 ? 0.3 : 1, display: 'flex', padding: 3 }}>
                    <ArrowDown size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Default constraints */}
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <label style={labelStyle}>Eligibility (default)</label>
        <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>Min Town Hall</span>
            <input className="input" type="number" min={1} max={20} value={def.th} placeholder="Any" onChange={(e) => setDef((d) => ({ ...d, th: e.target.value }))} style={{ width: 110 }} />
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>Min league</span>
            <LeagueFloorSelect value={def.tier} anyLabel="Any league" onChange={(tier) => setDef((d) => ({ ...d, tier }))} />
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>Max bench / clan</span>
            <input className="input" type="number" min={0} max={30} value={def.bench} placeholder="5" onChange={(e) => setDef((d) => ({ ...d, bench: e.target.value }))} style={{ width: 130 }} />
          </div>
        </div>
        <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
          A clan holds at most its war size + this many accounts; surplus spill down the fill order, then fall out as unassigned. Blank = 5.
        </p>
      </div>

      {/* Per-clan overrides */}
      {order.length > 0 && (
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <button onClick={() => setShowOverrides((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}>
            {showOverrides ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Per-clan overrides (optional)
          </button>
          {showOverrides && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
              {order.map((id) => {
                const o = overrides[id] || EMPTY_RULE;
                const set = (patch: Partial<RuleDraft>) => setOverrides((prev) => ({ ...prev, [id]: { ...o, ...patch } }));
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', minWidth: 120 }}>{clanName(id)}</span>
                    <input className="input" type="number" min={1} max={20} value={o.th} placeholder="Min TH (inherit)" onChange={(e) => set({ th: e.target.value })} style={{ width: 150 }} />
                    <LeagueFloorSelect value={o.tier} anyLabel="League (inherit)" onChange={(tier) => set({ tier })} />
                    <input className="input" type="number" min={0} max={30} value={o.bench} placeholder="Bench (inherit)" onChange={(e) => set({ bench: e.target.value })} style={{ width: 150 }} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
        <button className="btn btn-outline" style={{ border: 'none' }} onClick={onCancel} disabled={submitting}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={submitting || !label.trim() || order.length === 0}>
          {submitting ? 'Generating…' : 'Create & Allocate'}
        </button>
      </div>
    </div>
  );
}
