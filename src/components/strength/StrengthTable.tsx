'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useClan } from '@/lib/ClanContext';
import { tierLabel } from '@/lib/cwl/leagues';
import type { FamilyStrengthAccount } from '@/lib/cwl/familyStrength';
import { useStrengthStore, type StrengthSortKey } from '@/lib/stores/strengthStore';
import { pct, TIER_COLOR, topShare } from './tiers';

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 8px', fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--color-muted)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 8px', fontSize: '0.84rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

const rate = (n: number, d: number) => (d ? n / d : -1);

/** The value a column sorts on; unranked accounts always sort last, whatever the column. */
function sortValue(a: FamilyStrengthAccount, key: StrengthSortKey): number | string {
  switch (key) {
    case 'rank': return a.rank ?? Infinity;
    case 'name': return a.name.toLowerCase();
    case 'clan': return (a.clanName ?? '').toLowerCase();
    case 'th': return a.thLevel;
    case 'mirror': return a.mirrorChance ?? -1;
    case 'triples': return a.record ? rate(a.record.triples, a.record.attacks) : -1;
    case 'cwlTriples': return a.record ? rate(a.record.cwlTriples, a.record.cwlAttacks) : -1;
    case 'form': return a.rating?.mean ?? -Infinity;
  }
}

/**
 * The family ranking as a table. Ranks are FAMILY ranks — a clan view (the header's switcher) is a
 * filter, so "#3" still means the third-best account in the whole family.
 */
export default function StrengthTable() {
  const accounts = useStrengthStore((s) => s.accounts);
  const search = useStrengthStore((s) => s.search);
  const sort = useStrengthStore((s) => s.sort);
  const sortBy = useStrengthStore((s) => s.sortBy);
  const { selectedClanId } = useClan();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = accounts
      .filter((a) => selectedClanId === 'all' || a.clanId === selectedClanId)
      .filter((a) => !q || [a.name, a.playerTag, a.personName ?? ''].some((s) => s.toLowerCase().includes(q)));
    return shown.sort((x, y) => {
      if ((x.rank == null) !== (y.rank == null)) return x.rank == null ? 1 : -1;
      const vx = sortValue(x, sort.key);
      const vy = sortValue(y, sort.key);
      const c = vx < vy ? -1 : vx > vy ? 1 : 0;
      return (sort.desc ? -c : c) || (x.rank ?? Infinity) - (y.rank ?? Infinity);
    });
  }, [accounts, search, sort, selectedClanId]);

  const head = (key: StrengthSortKey, label: string, align: 'left' | 'right' = 'left') => (
    <th style={{ ...th, textAlign: align }}>
      <button
        onClick={() => sortBy(key)}
        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, color: sort.key === key ? 'var(--color-text)' : undefined }}
      >
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );

  if (rows.length === 0) {
    return <div className="card text-muted" style={{ padding: 'var(--space-md)', fontSize: '0.85rem' }}>No accounts match.</div>;
  }

  return (
    <div className="card" style={{ padding: 'var(--space-sm) var(--space-md)', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {head('rank', '#')}
            {head('name', 'Account')}
            {head('clan', 'Clan')}
            {head('th', 'TH')}
            <th style={th}>League</th>
            <th style={th}>Strength</th>
            {head('mirror', 'Mirror 3★', 'right')}
            {head('cwlTriples', 'CWL 3★', 'right')}
            {head('triples', 'All wars 3★', 'right')}
            {head('form', 'War record', 'right')}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.playerTag} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', opacity: a.rank == null ? 0.6 : 1 }}>
              <td style={{ ...td, color: 'var(--color-muted)' }}>{a.rank ?? '—'}</td>
              <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.personId ? (
                  <Link href={`/dashboard/members/${a.personId}`} style={{ color: 'inherit', textDecoration: 'none' }}>{a.name}</Link>
                ) : (
                  a.name
                )}
                <div className="text-muted" style={{ fontSize: '0.68rem' }}>
                  {a.personName && a.personName !== a.name ? `${a.personName} · ` : ''}
                  {a.personId ? a.playerTag : `${a.playerTag} · unlinked`}
                </div>
              </td>
              <td style={{ ...td, fontSize: '0.78rem' }}>
                {a.inFamily ? (
                  a.clanName ?? '—'
                ) : (
                  <span>
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--color-warning)', border: '1px solid var(--color-warning)', borderRadius: 999, padding: '0 5px', marginRight: 6 }}>AWAY</span>
                    <span className="text-muted">{a.clanName ? `last in ${a.clanName}` : ''}</span>
                  </span>
                )}
              </td>
              <td style={td}>{a.thLevel}</td>
              <td style={{ ...td, fontSize: '0.78rem' }}>
                {tierLabel(a.leagueTier)}
                {a.leagueShare != null && <div className="text-muted" style={{ fontSize: '0.68rem' }}>{topShare(a.leagueShare)} of TH{a.thLevel}</div>}
              </td>
              <td style={{ ...td, fontWeight: a.tier === 'goat' ? 700 : 600, color: a.tier ? TIER_COLOR[a.tier] : 'var(--color-muted)' }}>
                {a.tier ?? 'unranked'}
              </td>
              <td style={{ ...td, textAlign: 'right' }}>{a.mirrorChance != null ? pct(a.mirrorChance) : '—'}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                <Record n={a.record?.cwlTriples ?? 0} of={a.record?.cwlAttacks ?? 0} />
              </td>
              <td style={{ ...td, textAlign: 'right' }}>
                <Record n={a.record?.triples ?? 0} of={a.record?.attacks ?? 0} />
              </td>
              <td style={{ ...td, textAlign: 'right' }}>
                <Form rating={a.rating} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Record({ n, of }: { n: number; of: number }) {
  if (!of) return <span className="text-muted">—</span>;
  return (
    <span>
      {pct(n / of)}
      <span className="text-muted" style={{ fontSize: '0.7rem' }}> {n}/{of}</span>
    </span>
  );
}

function Form({ rating }: { rating: FamilyStrengthAccount['rating'] }) {
  if (!rating) return <span className="text-muted">new</span>;
  const m = rating.mean;
  const color = m >= 0.15 ? 'var(--color-cta)' : m <= -0.15 ? 'var(--color-warning)' : 'var(--color-muted)';
  const word = m >= 0.15 ? 'above league' : m <= -0.15 ? 'below league' : 'as league';
  return (
    <span style={{ color }}>
      {word}
      <span className="text-muted" style={{ fontSize: '0.7rem' }}> {m >= 0 ? '+' : ''}{m.toFixed(2)}</span>
    </span>
  );
}
