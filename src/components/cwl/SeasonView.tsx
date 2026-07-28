'use client';

import { useEffect, useState } from 'react';
import { Trash2, Activity, Megaphone } from 'lucide-react';
import type { CWLSeason, CWLSeasonStatus } from '@/types/database';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useCWLStore } from '@/lib/stores/cwlStore';
import { readRule } from '@/lib/cwl/constraints';
import { tierFloorLabel } from '@/lib/cwl/leagues';
import RosterBoard from './RosterBoard';
import ClanPriorityPanel from './ClanPriorityPanel';
import TransfersPanel from './TransfersPanel';
import LiveRoundsPanel from './LiveRoundsPanel';
import RotationPanel from './RotationPanel';
import PerformancePanel from './PerformancePanel';
import RosterPostModal from './RosterPostModal';
import { useClanName } from './useClanName';

const STATUS_FLOW: CWLSeasonStatus[] = ['planning', 'transfers_pending', 'signed_up', 'in_progress', 'completed'];
const STATUS_LABEL: Record<CWLSeasonStatus, string> = {
  planning: 'Planning', transfers_pending: 'Transfers Pending', signed_up: 'Signed Up', in_progress: 'In Progress', completed: 'Completed',
};

/**
 * One season's whole workspace. A thin orchestrator: it mounts the season into the store and lays
 * out the panels, each of which reads the store itself rather than taking data through props.
 */
export default function SeasonView({ season }: { season: CWLSeason }) {
  const loadSeason = useCWLStore((s) => s.loadSeason);
  const loading = useCWLStore((s) => s.loadingSeason);
  const savingSeason = useCWLStore((s) => s.savingSeason);
  const setSeasonStatus = useCWLStore((s) => s.setSeasonStatus);
  const deleteSeason = useCWLStore((s) => s.deleteSeason);
  const clanName = useClanName();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    loadSeason(season.id);
  }, [loadSeason, season.id]);

  // A frozen snapshot may predate sub-division rules, so read it through the compat layer.
  const defaultRule = readRule(season.constraints.default);
  const overrideEntries = Object.entries(season.constraints.perClan || {});

  const ruleSummary = (rule: ReturnType<typeof readRule>) =>
    `min TH ${rule.minThLevel ?? 'any'} · ${tierFloorLabel(rule.minLeagueTier)} · max bench ${rule.maxBench ?? 5}`;

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
          {/* Advancing the status to Transfers Pending / Signed Up posts to Discord on its own; this
              button is the manual path — preview it first, or refresh it after a late roster change. */}
          <button className="btn btn-outline" onClick={() => setPosting(true)}>
            <Megaphone size={15} /> Post to Discord
          </button>
          <select className="input" style={{ width: 'auto', padding: '6px 10px' }} value={season.status} disabled={savingSeason} onChange={(e) => setSeasonStatus(e.target.value as CWLSeasonStatus)}>
            {STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <button className="btn btn-outline" style={{ border: 'none', color: 'var(--color-danger)', padding: '8px' }} aria-label="Delete season" disabled={savingSeason} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Constraints summary (frozen for this season) */}
      <div className="card" style={{ padding: 'var(--space-md)' }}>
        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: 4 }}>Eligibility (frozen)</div>
        <div style={{ fontSize: '0.85rem' }}>Default: {ruleSummary(defaultRule)}</div>
        {overrideEntries.map(([cid, rule]) => (
          <div key={cid} style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: 2 }}>
            {clanName(cid)}: {ruleSummary(readRule(rule))}
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
          <Activity className="animate-spin text-muted" size={22} />
        </div>
      ) : (
        <>
          <ClanPriorityPanel />
          <TransfersPanel />
          <div>
            <h3 style={{ fontSize: '1rem', margin: '0 0 var(--space-sm)' }}>Roster Allocation</h3>
            <p className="text-muted" style={{ fontSize: '0.75rem', margin: '0 0 var(--space-sm)' }}>
              One row per account — a player&apos;s alts are signed up independently and can sit in different clans.
            </p>
            <RosterBoard />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', margin: '0 0 var(--space-sm)' }}>Bench Rotation</h3>
            <p className="text-muted" style={{ fontSize: '0.75rem', margin: '0 0 var(--space-sm)' }}>Who to bench in the upcoming round, chosen to spread war days evenly. Refreshes as rounds sync.</p>
            <RotationPanel />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', margin: '0 0 var(--space-sm)' }}>Live Rounds</h3>
            <LiveRoundsPanel />
          </div>
          <PerformancePanel />
        </>
      )}

      {posting && <RosterPostModal onClose={() => setPosting(false)} />}

      <ConfirmationModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const ok = await deleteSeason();
          if (ok) setConfirmDelete(false);
        }}
        title="Delete this CWL season?"
        message="This permanently removes the season, its allocations and transfer records. This cannot be undone."
        confirmText="Delete season"
        variant="danger"
        isLoading={savingSeason}
      />
    </div>
  );
}
