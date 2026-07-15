'use client';

import { useState } from 'react';
import { MoreVertical, ArrowRightLeft } from 'lucide-react';
import type { Clan } from '@/types/database';
import { leagueLabel, leagueOrder } from '@/lib/cwl/leagues';
import type { RosterPlayer, MoveAction } from './types';

// Strongest-first, matching the engine's ordering, so the board reads consistently after edits.
function byStrength(a: RosterPlayer, b: RosterPlayer): number {
  if (b.thLevel !== a.thLevel) return b.thLevel - a.thLevel;
  const l = leagueOrder(b.league) - leagueOrder(a.league);
  if (l !== 0) return l;
  return a.name.localeCompare(b.name);
}

function PlayerRow({
  player,
  clans,
  currentClanId,
  onAction,
  busy,
}: {
  player: RosterPlayer;
  clans: Clan[];
  currentClanId: string | null; // the clan column this row sits in (null = unassigned)
  onAction: (allocationId: string, action: MoveAction, clanId?: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const otherClans = clans.filter((c) => c.id !== currentClanId);

  const act = (action: MoveAction, clanId?: string) => {
    setOpen(false);
    onAction(player.allocationId, action, clanId);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '5px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.02)' }}>
      <span style={{ flex: 1, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
      <span className="text-muted" style={{ fontSize: '0.65rem', fontVariantNumeric: 'tabular-nums' }}>TH{player.thLevel}</span>
      <span className="text-muted" title={leagueLabel(player.league)} style={{ fontSize: '0.6rem', width: 78, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leagueLabel(player.league)}</span>
      {player.status === 'transfer_required' && (
        <ArrowRightLeft size={12} className="text-warning" aria-label="Transfer required" />
      )}
      <div style={{ position: 'relative' }}>
        <button aria-label="Move player" disabled={busy} onClick={() => setOpen((v) => !v)} style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: busy ? 'default' : 'pointer', display: 'flex', padding: 2 }}>
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
  overCapacity,
  fighting,
  bench,
  clans,
  currentClanId,
  onAction,
  busy,
}: {
  title: string;
  subtitle: string;
  overCapacity: boolean;
  fighting: RosterPlayer[];
  bench: RosterPlayer[];
  clans: Clan[];
  currentClanId: string | null;
  onAction: (allocationId: string, action: MoveAction, clanId?: string) => void;
  busy: boolean;
}) {
  return (
    <div className="card" style={{ padding: 'var(--space-md)', minWidth: 260, flex: '1 1 260px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-sm)' }}>
        <h4 style={{ fontSize: '0.9rem', margin: 0 }}>{title}</h4>
        <span style={{ fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums', color: overCapacity ? 'var(--color-danger)' : 'var(--color-muted)', fontWeight: overCapacity ? 700 : 400 }}>{subtitle}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {fighting.map((p) => <PlayerRow key={p.allocationId} player={p} clans={clans} currentClanId={currentClanId} onAction={onAction} busy={busy} />)}
        {fighting.length === 0 && <p className="text-muted" style={{ fontSize: '0.75rem', margin: '2px 0' }}>No players.</p>}
      </div>
      {bench.length > 0 && (
        <>
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: 'var(--color-muted)', margin: '10px 0 4px', letterSpacing: '0.05em' }}>Bench ({bench.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.75 }}>
            {bench.map((p) => <PlayerRow key={p.allocationId} player={p} clans={clans} currentClanId={currentClanId} onAction={onAction} busy={busy} />)}
          </div>
        </>
      )}
    </div>
  );
}

export default function RosterBoard({
  players,
  seasonClans,
  clans,
  onAction,
  busy,
}: {
  players: RosterPlayer[];
  seasonClans: { clanId: string; warSize: number }[];
  clans: Clan[];
  onAction: (allocationId: string, action: MoveAction, clanId?: string) => void;
  busy: boolean;
}) {
  const clanName = (id: string) => clans.find((c) => c.id === id)?.display_name ?? 'Unknown clan';
  const poolClans = clans.filter((c) => seasonClans.some((sc) => sc.clanId === c.id));

  const unassigned = players.filter((p) => !p.recommendedClanId).sort(byStrength);

  return (
    <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {seasonClans.map((sc) => {
        const members = players.filter((p) => p.recommendedClanId === sc.clanId).sort(byStrength);
        const fighting = members.filter((p) => !p.isBench);
        const bench = members.filter((p) => p.isBench);
        const over = fighting.length > sc.warSize;
        return (
          <ClanColumn
            key={sc.clanId}
            title={clanName(sc.clanId)}
            subtitle={`${fighting.length}/${sc.warSize}`}
            overCapacity={over}
            fighting={fighting}
            bench={bench}
            clans={poolClans}
            currentClanId={sc.clanId}
            onAction={onAction}
            busy={busy}
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
          clans={poolClans}
          currentClanId={null}
          onAction={onAction}
          busy={busy}
        />
      )}
    </div>
  );
}
