'use client';

import { useMemo, useState } from 'react';
import { Swords, ChevronDown, ChevronRight } from 'lucide-react';
import type { Clan, CWLConstraints, CWLLeague } from '@/types/database';
import { CWL_LEAGUES } from '@/lib/cwl/leagues';

// League floors a leader can pick, lowest → highest (plus "Any" to disable the gate).
const LEAGUE_OPTIONS: { value: '' | CWLLeague; label: string }[] = [
  { value: '', label: 'Any league' },
  ...CWL_LEAGUES.map((l) => ({ value: l.key, label: `${l.label}+` })),
];

interface RuleDraft {
  th: string;     // '' = no minimum
  league: '' | CWLLeague;
  bench: string;  // '' = inherit engine default (5 for the season default row)
}

function toRule(d: RuleDraft) {
  return {
    minThLevel: d.th.trim() ? parseInt(d.th, 10) : null,
    minLeague: d.league || null,
    maxBench: d.bench.trim() ? Math.max(0, parseInt(d.bench, 10)) : null,
  };
}

function defaultLabel(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function CreateSeasonForm({
  clans,
  onCreated,
  onCancel,
  onToast,
}: {
  clans: Clan[];
  onCreated: (seasonId: string) => void;
  onCancel: () => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}) {
  const activeClans = useMemo(() => clans.filter((c) => c.active), [clans]);

  const [label, setLabel] = useState(defaultLabel());
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [warSize, setWarSize] = useState<Record<string, number>>({});
  const [def, setDef] = useState<RuleDraft>({ th: '', league: '', bench: '' });
  const [overrides, setOverrides] = useState<Record<string, RuleDraft>>({});
  const [showOverrides, setShowOverrides] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedIds = activeClans.filter((c) => selected[c.id]).map((c) => c.id);

  const toggleClan = (id: string) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
    setWarSize((w) => (w[id] ? w : { ...w, [id]: 15 }));
  };

  const submit = async () => {
    if (!label.trim() || selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      const perClan: CWLConstraints['perClan'] = {};
      for (const id of selectedIds) {
        const o = overrides[id];
        if (o && (o.th.trim() || o.league || o.bench.trim())) perClan[id] = toRule(o);
      }
      const constraints: CWLConstraints = { default: toRule(def), perClan };
      const res = await fetch('/api/cwl/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          clans: selectedIds.map((id) => ({ clanId: id, warSize: warSize[id] || 15 })),
          constraints,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create season');
      onToast('CWL season created', 'success');
      onCreated(data.seasonId);
    } catch (err: any) {
      onToast(err.message || 'Failed to create season', 'error');
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

      {/* Clan pool + war size */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        <label style={labelStyle}>Participating clans</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
          {activeClans.map((c) => {
            const on = !!selected[c.id];
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: '6px 8px', borderRadius: 'var(--radius-md)', background: on ? 'rgba(34,197,94,0.06)' : 'transparent' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer', flex: 1 }}>
                  <input type="checkbox" checked={on} onChange={() => toggleClan(c.id)} />
                  <span style={{ fontSize: '0.9rem', fontWeight: on ? 700 : 400 }}>{c.display_name}</span>
                  <span className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>{c.clan_type}</span>
                </label>
                {on && (
                  <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value={warSize[c.id] || 15} onChange={(e) => setWarSize((w) => ({ ...w, [c.id]: parseInt(e.target.value, 10) }))}>
                    <option value={15}>15v15</option>
                    <option value={30}>30v30</option>
                  </select>
                )}
              </div>
            );
          })}
          {activeClans.length === 0 && <p className="text-muted" style={{ fontSize: '0.85rem' }}>No active clans registered.</p>}
        </div>
      </div>

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
            <select className="input" value={def.league} onChange={(e) => setDef((d) => ({ ...d, league: e.target.value as RuleDraft['league'] }))} style={{ width: 170 }}>
              {LEAGUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>Max bench / clan</span>
            <input className="input" type="number" min={0} max={30} value={def.bench} placeholder="5" onChange={(e) => setDef((d) => ({ ...d, bench: e.target.value }))} style={{ width: 130 }} />
          </div>
        </div>
        <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
          A clan holds at most its war size + this many players; surplus spill to clans with room, then fall out as unassigned. Blank = 5.
        </p>
      </div>

      {/* Per-clan overrides */}
      {selectedIds.length > 0 && (
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <button onClick={() => setShowOverrides((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}>
            {showOverrides ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Per-clan overrides (optional)
          </button>
          {showOverrides && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
              {selectedIds.map((id) => {
                const clan = activeClans.find((c) => c.id === id)!;
                const o = overrides[id] || { th: '', league: '' as RuleDraft['league'], bench: '' };
                const set = (patch: Partial<RuleDraft>) => setOverrides((prev) => ({ ...prev, [id]: { ...o, ...patch } }));
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', minWidth: 120 }}>{clan.display_name}</span>
                    <input className="input" type="number" min={1} max={20} value={o.th} placeholder="Min TH (inherit)" onChange={(e) => set({ th: e.target.value })} style={{ width: 150 }} />
                    <select className="input" value={o.league} onChange={(e) => set({ league: e.target.value as RuleDraft['league'] })} style={{ width: 170 }}>
                      <option value="">League (inherit)</option>
                      {LEAGUE_OPTIONS.filter((r) => r.value).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
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
        <button className="btn btn-primary" onClick={submit} disabled={submitting || !label.trim() || selectedIds.length === 0}>
          {submitting ? 'Generating…' : 'Create & Allocate'}
        </button>
      </div>
    </div>
  );
}
