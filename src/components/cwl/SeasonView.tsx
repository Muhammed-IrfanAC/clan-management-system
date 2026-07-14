'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Clan, CWLSeason, CWLSeasonStatus, CWLLeague, CWLRound, CWLWarMember } from '@/types/database';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { leagueLabel, normalizeLeague } from '@/lib/cwl/leagues';
import RosterBoard from './RosterBoard';
import TransfersPanel from './TransfersPanel';
import LiveRoundsPanel from './LiveRoundsPanel';
import RotationPanel from './RotationPanel';
import PerformancePanel from './PerformancePanel';
import type { RosterPlayer, TransferItem, MoveAction } from './types';

const STATUS_FLOW: CWLSeasonStatus[] = ['planning', 'transfers_pending', 'signed_up', 'in_progress', 'completed'];
const STATUS_LABEL: Record<CWLSeasonStatus, string> = {
  planning: 'Planning', transfers_pending: 'Transfers Pending', signed_up: 'Signed Up', in_progress: 'In Progress', completed: 'Completed',
};
const leagueFloor = (l: CWLLeague | null) => (l ? `${leagueLabel(l)}+` : 'any league');

type AllocationRow = {
  id: string; person_id: string; recommended_clan_id: string | null; actual_clan_id: string | null;
  status: RosterPlayer['status']; is_bench: boolean; person: { display_name: string } | null;
};
type TransferRow = {
  id: string; status: TransferItem['status']; from_clan_id: string | null; to_clan_id: string | null;
  allocation: { person: { display_name: string } | null } | null;
};
type StatRow = { person_id: string; th_level: number | null; league: string | null; is_main_account: boolean };

export default function SeasonView({
  season,
  clans,
  onChanged,
  onDeleted,
  onToast,
}: {
  season: CWLSeason;
  clans: Clan[];
  onChanged: () => void;
  onDeleted: () => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}) {
  const [seasonClans, setSeasonClans] = useState<{ clanId: string; warSize: number }[]>([]);
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [rounds, setRounds] = useState<CWLRound[]>([]);
  const [warMembers, setWarMembers] = useState<CWLWarMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const clanName = useCallback((id: string | null) => (id ? clans.find((c) => c.id === id)?.display_name ?? 'Unknown' : '—'), [clans]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: scRows }, { data: allocRows }, { data: transferRows }, { data: roundRows }] = await Promise.all([
        supabase.from('cwl_season_clans').select('clan_id, war_size').eq('season_id', season.id),
        supabase.from('cwl_allocations').select('id, person_id, recommended_clan_id, actual_clan_id, status, is_bench, person:persons(display_name)').eq('season_id', season.id),
        supabase.from('cwl_transfers').select('id, status, from_clan_id, to_clan_id, allocation:cwl_allocations!inner(season_id, person:persons(display_name))').eq('allocation.season_id', season.id),
        supabase.from('cwl_rounds').select('*').eq('season_id', season.id),
      ]);

      const allocations = (allocRows as unknown as AllocationRow[]) || [];

      // Live TH / rank per person (main account, else highest TH) for display + strength ordering.
      const personIds = allocations.map((a) => a.person_id);
      const statByPerson = new Map<string, { thLevel: number; league: CWLLeague | null }>();
      if (personIds.length) {
        const { data: statRows } = await supabase
          .from('player_accounts')
          .select('person_id, th_level, league, is_main_account')
          .in('person_id', personIds)
          .eq('status', 'active');
        for (const row of (statRows as unknown as StatRow[]) || []) {
          const prev = statByPerson.get(row.person_id);
          const score = (row.is_main_account ? 1000 : 0) + (row.th_level ?? 0);
          const prevScore = prev ? (prev.thLevel) : -1;
          if (!prev || score > prevScore) statByPerson.set(row.person_id, { thLevel: row.th_level ?? 0, league: normalizeLeague(row.league) });
        }
      }

      // Live CWL rounds + their war-member lineups (populated by sync). Prefer the family person's
      // display name over the raw in-game name for linked accounts.
      const liveRounds = (roundRows as CWLRound[]) || [];
      let liveMembers: CWLWarMember[] = [];
      if (liveRounds.length) {
        const { data: memberRows } = await supabase
          .from('cwl_war_members')
          .select('*')
          .in('round_id', liveRounds.map((r) => r.id));
        liveMembers = (memberRows as CWLWarMember[]) || [];

        const personIds = Array.from(new Set(liveMembers.map((m) => m.person_id).filter((x): x is string => !!x)));
        if (personIds.length) {
          const { data: personRows } = await supabase.from('persons').select('id, display_name').in('id', personIds);
          const nameById = new Map((personRows as { id: string; display_name: string }[] | null || []).map((p) => [p.id, p.display_name]));
          liveMembers = liveMembers.map((m) => ({ ...m, name: (m.person_id && nameById.get(m.person_id)) || m.name }));
        }
      }
      setRounds(liveRounds);
      setWarMembers(liveMembers);

      setSeasonClans(((scRows as { clan_id: string; war_size: number }[]) || []).map((r) => ({ clanId: r.clan_id, warSize: r.war_size })));
      setPlayers(allocations.map((a) => {
        const stat = statByPerson.get(a.person_id);
        return {
          allocationId: a.id,
          personId: a.person_id,
          name: a.person?.display_name || 'Unknown',
          thLevel: stat?.thLevel ?? 0,
          league: stat?.league ?? null,
          recommendedClanId: a.recommended_clan_id,
          actualClanId: a.actual_clan_id,
          status: a.status,
          isBench: a.is_bench,
        };
      }));
      setTransfers(((transferRows as unknown as TransferRow[]) || []).map((t) => ({
        id: t.id,
        personName: t.allocation?.person?.display_name || 'Unknown',
        fromClanName: clanName(t.from_clan_id),
        toClanName: clanName(t.to_clan_id),
        status: t.status,
      })));
    } catch (err) {
      console.error('CWL season load error:', err);
      onToast('Failed to load season data', 'error');
    } finally {
      setLoading(false);
    }
  }, [season.id, clanName, onToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on season change
    load();
  }, [load]);

  const handleAction = async (allocationId: string, action: MoveAction, clanId?: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/cwl/allocations/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocationId, action, clanId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Move failed');
      await load();
    } catch (err: any) {
      onToast(err.message || 'Move failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleTransfer = async (transferId: string, done: boolean) => {
    setBusy(true);
    try {
      const res = await fetch('/api/cwl/transfers/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId, done }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      await load();
    } catch (err: any) {
      onToast(err.message || 'Update failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (status: CWLSeasonStatus) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cwl/seasons/${season.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      onToast('Season status updated', 'success');
      onChanged();
    } catch (err: any) {
      onToast(err.message || 'Update failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cwl/seasons/${season.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      onToast('Season deleted', 'success');
      setConfirmDelete(false);
      onDeleted();
    } catch (err: any) {
      onToast(err.message || 'Delete failed', 'error');
      setBusy(false);
    }
  };

  const { constraints } = season;
  const overrideEntries = Object.entries(constraints.perClan || {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>CWL {season.label}</h2>
          <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>
            {season.last_polled_at ? `Live data as of ${new Date(season.last_polled_at).toLocaleString()}` : 'Planning — not yet polled against live CWL'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <select className="input" style={{ width: 'auto', padding: '6px 10px' }} value={season.status} disabled={busy} onChange={(e) => handleStatus(e.target.value as CWLSeasonStatus)}>
            {STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <button className="btn btn-outline" style={{ border: 'none', color: 'var(--color-danger)', padding: '8px' }} aria-label="Delete season" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Constraints summary (frozen for this season) */}
      <div className="card" style={{ padding: 'var(--space-md)' }}>
        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: 4 }}>Eligibility (frozen)</div>
        <div style={{ fontSize: '0.85rem' }}>
          Default: min TH {constraints.default.minThLevel ?? 'any'} · {leagueFloor(constraints.default.minLeague)} · max bench {constraints.default.maxBench ?? 5}
        </div>
        {overrideEntries.map(([cid, rule]) => (
          <div key={cid} style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: 2 }}>
            {clanName(cid)}: min TH {rule.minThLevel ?? 'any'} · {leagueFloor(rule.minLeague)} · max bench {rule.maxBench ?? 5}
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
          <Activity className="animate-spin text-muted" size={22} />
        </div>
      ) : (
        <>
          <TransfersPanel transfers={transfers} onToggle={handleToggleTransfer} busy={busy} />
          <div>
            <h3 style={{ fontSize: '1rem', margin: '0 0 var(--space-sm)' }}>Roster Allocation</h3>
            <RosterBoard players={players} seasonClans={seasonClans} clans={clans} onAction={handleAction} busy={busy} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', margin: '0 0 var(--space-sm)' }}>Bench Rotation</h3>
            <p className="text-muted" style={{ fontSize: '0.75rem', margin: '0 0 var(--space-sm)' }}>Who to bench in the upcoming round, chosen to spread war days evenly. Refreshes as rounds sync.</p>
            <RotationPanel players={players} seasonClans={seasonClans} clans={clans} rounds={rounds} members={warMembers} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', margin: '0 0 var(--space-sm)' }}>Live Rounds</h3>
            <LiveRoundsPanel rounds={rounds} members={warMembers} clanName={clanName} />
          </div>
          <PerformancePanel rounds={rounds} members={warMembers} />
        </>
      )}

      <ConfirmationModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete this CWL season?"
        message="This permanently removes the season, its allocations and transfer records. This cannot be undone."
        confirmText="Delete season"
        variant="danger"
        isLoading={busy}
      />
    </div>
  );
}
