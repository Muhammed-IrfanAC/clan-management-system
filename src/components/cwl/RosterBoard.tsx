'use client';

import { useState } from 'react';
import { MoreVertical, ArrowRightLeft, Users } from 'lucide-react';
import { useClan } from '@/lib/ClanContext';
import { useCWLStore } from '@/lib/stores/cwlStore';
import { tierLabel, tierOrder } from '@/lib/cwl/leagues';
import { useClanName } from './useClanName';
import type { RosterPlayer, MoveAction } from './types';

// Strongest-first, matching the engine's ordering, so the board reads consistently after edits.
function byStrength(a: RosterPlayer, b: RosterPlayer): number {
  if (b.thLevel !== a.thLevel) return b.thLevel - a.thLevel;
  const l = tierOrder(b.leagueTier) - tierOrder(a.leagueTier);
  if (l !== 0) return l;
  return a.name.localeCompare(b.name);
}

function PlayerRow({
  player,
  currentClanId,
}: {
  player: RosterPlayer;
  currentClanId: string | null; // the clan column this row sits in (null = unassigned)
}) {
  const [open, setOpen] = useState(false);
  const { clans } = useClan();
  const seasonClans = useCWLStore((s) => s.seasonClans);
  const moveAllocation = useCWLStore((s) => s.moveAllocation);
  const busy = useCWLStore((s) => s.movingAllocationId === player.allocationId);

  const poolClans = clans.filter((c) => seasonClans.some((sc) => sc.clanId === c.id));
  const otherClans = poolClans.filter((c) => c.id !== currentClanId);

  const act = (action: MoveAction, clanId?: string) => {
    setOpen(false);
    moveAllocation(player.allocationId, action, clanId);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '5px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.02)', opacity: busy ? 0.5 : 1 }}>
      <span
        style={{ flex: 1, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={player.isAlt ? `${player.name} — one of ${player.personName}'s accounts` : player.name}
      >
        {player.name}
        {/* CWL is per account, so one person can hold several rows. The marker names the human. */}
        {player.isAlt && (
          <span className="text-muted" style={{ fontSize: '0.65rem' }}> · {player.personName}</span>
        )}
      </span>
      <span className="text-muted" style={{ fontSize: '0.65rem', fontVariantNumeric: 'tabular-nums' }}>TH{player.thLevel}</span>
      <span className="text-muted" title={tierLabel(player.leagueTier)} style={{ fontSize: '0.6rem', width: 86, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tierLabel(player.leagueTier)}</span>
      {player.status === 'transfer_required' && (
        <ArrowRightLeft size={12} className="text-warning" aria-label="Transfer required" />
      )}
      <div style={{ position: 'relative' }}>
        <button aria-label="Move account" disabled={busy} onClick={() => setOpen((v) => !v)} style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: busy ? 'default' : 'pointer', display: 'flex', padding: 2 }}>
          <MoreVertical size={15} />
        </button>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--color-secondary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', width: 190, zIndex: 60, overflow: 'hidden', padding: '4px 0' }}>
              {otherClans.map((c) => (
                <MenuItem key={c.id} label={`Move to ${c.display_name}`} onClick={() => act('assign', c.id)} />
              ))}
              {currentClanId && (player.isBench
                ? <MenuItem label="Move to fighting" onClick={() => act('unbench')} />
                : <MenuItem label="Send to bench" onClick={() => act('bench')} />)}
              {currentClanId && <MenuItem label="Remove from season" danger onClick={() => act('remove')} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: '0.8rem', background: 'transparent', border: 'none', cursor: 'pointer', color: danger ? 'var(--color-danger)' : 'var(--color-text)' }}
    >
      {label}
    </button>
  );
}

function ClanColumn({
  title,
  subtitle,
  priorityLabel,
  overCapacity,
  shortLineup,
  fighting,
  bench,
  currentClanId,
}: {
  title: string;
  subtitle: string;
  priorityLabel?: string;
  overCapacity: boolean;
  shortLineup?: boolean;
  fighting: RosterPlayer[];
  bench: RosterPlayer[];
  currentClanId: string | null;
}) {
  return (
    <div className="card" style={{ padding: 'var(--space-md)', minWidth: 260, flex: '1 1 260px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-sm)' }}>
        <h4 style={{ fontSize: '0.9rem', margin: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
          {priorityLabel && (
            <span className="text-muted" style={{ fontSize: '0.62rem', fontVariantNumeric: 'tabular-nums' }} title="Fill priority — lower is filled first">{priorityLabel}</span>
          )}
          {title}
        </h4>
        <span
          title={shortLineup ? 'Short of a full lineup — the clans above absorbed the eligible accounts' : undefined}
          style={{
            fontSize: '0.7rem',
            fontVariantNumeric: 'tabular-nums',
            color: overCapacity ? 'var(--color-danger)' : shortLineup ? 'var(--color-warning)' : 'var(--color-muted)',
            fontWeight: overCapacity || shortLineup ? 700 : 400,
          }}
        >
          {subtitle}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {fighting.map((p) => <PlayerRow key={p.allocationId} player={p} currentClanId={currentClanId} />)}
        {fighting.length === 0 && <p className="text-muted" style={{ fontSize: '0.75rem', margin: '2px 0' }}>No accounts.</p>}
      </div>
      {bench.length > 0 && (
        <>
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: 'var(--color-muted)', margin: '10px 0 4px', letterSpacing: '0.05em' }}>Bench ({bench.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.75 }}>
            {bench.map((p) => <PlayerRow key={p.allocationId} player={p} currentClanId={currentClanId} />)}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The whole-family roster, one column per clan IN FILL-PRIORITY ORDER so the board reads the same
 * way the engine filled it: leftmost clan is the one that took the strongest accounts, and each
 * column to its right absorbed the spill.
 */
export default function RosterBoard() {
  const players = useCWLStore((s) => s.players);
  const seasonClans = useCWLStore((s) => s.seasonClans);
  const clanName = useClanName();

  const unassigned = players.filter((p) => !p.recommendedClanId).sort(byStrength);

  return (
    <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {seasonClans.map((sc, i) => {
        const members = players.filter((p) => p.recommendedClanId === sc.clanId).sort(byStrength);
        const fighting = members.filter((p) => !p.isBench);
        const bench = members.filter((p) => p.isBench);
        return (
          <ClanColumn
            key={sc.clanId}
            title={clanName(sc.clanId)}
            priorityLabel={`#${i + 1}`}
            subtitle={`${fighting.length}/${sc.warSize}`}
            overCapacity={fighting.length > sc.warSize}
            // The visible cost of the priority waterfall: a clan low in the order can be left short
            // because the clans above it filled their benches first. Flag it rather than hide it.
            shortLineup={fighting.length < sc.warSize}
            fighting={fighting}
            bench={bench}
            currentClanId={sc.clanId}
          />
        );
      })}

      {unassigned.length > 0 && (
        <ClanColumn
          title="Unassigned"
          subtitle={`${unassigned.length}`}
          overCapacity={false}
          fighting={unassigned}
          bench={[]}
          currentClanId={null}
        />
      )}

      {seasonClans.length === 0 && (
        <div className="card" style={{ padding: 'var(--space-lg)', textAlign: 'center', flex: 1 }}>
          <Users size={22} className="text-muted" style={{ marginBottom: 'var(--space-sm)' }} />
          <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>No clans in this season&apos;s pool.</p>
        </div>
      )}
    </div>
  );
}
