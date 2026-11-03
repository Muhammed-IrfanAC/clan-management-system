'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trash2, Activity, Megaphone, CalendarRange } from 'lucide-react';
import type { CWLSeason, CWLSeasonStatus } from '@/types/database';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useCWLStore } from '@/lib/stores/cwlStore';
import { readRule } from '@/lib/cwl/constraints';
import { tierFloorLabel } from '@/lib/cwl/leagues';
import RosterBoard from './RosterBoard';
import ClanPriorityPanel from './ClanPriorityPanel';
import TransfersPanel from './TransfersPanel';
import LiveRoundsPanel from './LiveRoundsPanel';
import PerformancePanel from './PerformancePanel';
import RosterPostModal from './RosterPostModal';
import CollapsibleSection from './CollapsibleSection';
import { useClanName } from './useClanName';
import { useCwlScope } from './useCwlScope';
import { useSeasonLabel } from './useSeasonLabel';

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
  const players = useCWLStore((s) => s.players);
  const transfers = useCWLStore((s) => s.transfers);
  const seasonClans = useCWLStore((s) => s.seasonClans);
  const clanName = useClanName();
  const scope = useCwlScope();
  const seasonLabel = useSeasonLabel();

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

  // From sign-up onward the roster is no longer being formed — it is being lived with. The panels
  // that plan it collapse, and from `signed_up` the sync also rewrites them from the in-game signup
  // list (see cwl/signupReconcile.ts), so what they show is a record rather than a draft.
  const planningDone = season.status === 'signed_up' || season.status === 'in_progress' || season.status === 'completed';

  // The collapsed summary lines have to agree with what opening the section shows, so they are
  // scoped the same way the panels are (see useCwlScope).
  const scopedTransfers = transfers.filter((t) => scope.includes(t.fromClanId) || scope.includes(t.toClanId));
  const allocated = players.filter((p) => p.status !== 'removed' && scope.includes(p.recommendedClanId));
  const benched = allocated.filter((p) => p.isBench).length;
  const openTransfers = scopedTransfers.filter((t) => t.status === 'pending').length;
  const optedOut = players.filter((p) => p.optedOut).length;

  const planning = (
    <>
      {/* Fill order is inherently family-wide — a clan's priority only means anything relative to
          the others — so this panel always shows the whole pool regardless of the clan scope. */}
      <CollapsibleSection
        title="Clan Fill Order"
        summary={`${seasonClans.length} clan${seasonClans.length === 1 ? '' : 's'}`}
        defaultOpen={!planningDone}
      >
        <ClanPriorityPanel />
      </CollapsibleSection>
      <CollapsibleSection
        title="Required Transfers"
        summary={
          scopedTransfers.length === 0
            ? 'none required'
            : openTransfers > 0
              ? `${openTransfers} of ${scopedTransfers.length} outstanding`
              : `${scopedTransfers.length} settled`
        }
        defaultOpen={!planningDone}
      >
        <TransfersPanel />
      </CollapsibleSection>
      <CollapsibleSection
        title="Roster Allocation"
        summary={`${allocated.length} account${allocated.length === 1 ? '' : 's'} · ${benched} benched${optedOut > 0 ? ` · ${optedOut} not playing` : ''}`}
        defaultOpen={!planningDone}
      >
        <p className="text-muted" style={{ fontSize: '0.75rem', margin: '0 0 var(--space-sm)' }}>
          One row per account — a player&apos;s alts are signed up independently and can sit in different clans.
          {planningDone && ' Rewritten from the in-game signup list on every sync.'}
        </p>
        <RosterBoard />
      </CollapsibleSection>
    </>
  );

  const live = (
    <>
      <div>
        <h3 style={{ fontSize: '1rem', margin: '0 0 var(--space-sm)' }}>Live Rounds</h3>
        <LiveRoundsPanel />
      </div>
      <PerformancePanel />
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>{seasonLabel(season)}</h2>
          <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>
            {season.last_polled_at ? `Live data as of ${new Date(season.last_polled_at).toLocaleString()}` : 'Planning — not yet polled against live CWL'}
          </p>
          {/* The season spans the family but the panels below read one clan. Say which, next to the
              title, so no number on this page is ambiguous about what it counts. */}
          <p style={{ fontSize: '0.75rem', margin: '2px 0 0' }}>
            {scope.isFamily ? (
              <span className="text-muted">Showing all clans — use the clan switcher above to focus one.</span>
            ) : (
              <span>
                Showing <strong>{clanName(scope.clanId)}</strong>
                <span className="text-muted"> — switch to All Clans for the family view.</span>
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          {/* Lineup planning is one clan's business, so it lives on a page per clan. Linked from the
              header so it is reachable whatever stage the season is at. */}
          {seasonClans.filter((sc) => scope.includes(sc.clanId)).map((sc) => (
            <Link key={sc.clanId} href={`/dashboard/cwl/${sc.clanId}?season=${season.id}`} className="btn btn-primary" style={{ textDecoration: 'none' }} title="Plan who plays each war — everyone to 8★ first, then the most clan stars">
              <CalendarRange size={15} /> {scope.isFamily ? `Plan ${clanName(sc.clanId)}` : 'War Planner'}
            </Link>
          ))}
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
          {/* Once the season is signed up the planning work is done and the live data is what a
              leader opens this page for, so the two halves swap places and the planning panels fold
              down to a summary line. */}
          {planningDone ? (
            <>
              {live}
              {planning}
            </>
          ) : (
            <>
              {planning}
              {live}
            </>
          )}
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
