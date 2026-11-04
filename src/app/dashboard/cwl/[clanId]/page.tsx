'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarRange, Activity } from 'lucide-react';
import { useCwlPlannerStore } from '@/lib/stores/cwlPlannerStore';
import { useClanName } from '@/components/cwl/useClanName';
import { useSeasonLabel } from '@/components/cwl/useSeasonLabel';
import Toast from '@/components/ui/Toast';
import PlanSummary from '@/components/cwl/planner/PlanSummary';
import NextWarPanel from '@/components/cwl/planner/NextWarPanel';
import WeekGrid from '@/components/cwl/planner/WeekGrid';
import SwapsPanel from '@/components/cwl/planner/SwapsPanel';

/**
 * The per-clan CWL war planner: who plays which war this week. Everyone to 8★ first, then the most
 * clan stars. A thin orchestrator over cwlPlannerStore — the panels read the store and derive the
 * plan themselves (see planner/usePlan.ts).
 *
 * The season comes from `?season=`; without one the newest season is used.
 */
export default function CwlClanPlannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { clanId } = use(params);
  const { season: seasonParam } = use(searchParams);
  const router = useRouter();
  const clanName = useClanName();
  const seasonLabel = useSeasonLabel();

  const seasons = useCwlPlannerStore((s) => s.seasons);
  const loadSeasons = useCwlPlannerStore((s) => s.loadSeasons);
  const load = useCwlPlannerStore((s) => s.load);
  const loading = useCwlPlannerStore((s) => s.loading);
  const loadedSeason = useCwlPlannerStore((s) => s.seasonId);
  const toast = useCwlPlannerStore((s) => s.toast);
  const setToast = useCwlPlannerStore((s) => s.setToast);

  useEffect(() => {
    loadSeasons();
  }, [loadSeasons]);

  // Only seasons this clan is in — a season belongs to its clans, and the others cannot be planned
  // from here. Newest first (the list is ordered by creation).
  const inSeason = (s: (typeof seasons)[number], clan: string) => (s.season_clans ?? []).some((c) => c.clan_id === clan);
  const clanSeasons = seasons.filter((s) => inSeason(s, clanId));
  const seasonId = seasonParam ?? clanSeasons[0]?.id ?? null;
  const season = seasons.find((s) => s.id === seasonId) ?? null;

  // Every clan that has a season, so the switcher can reach a clan running its own season.
  const clanOptions = [...new Set(seasons.flatMap((s) => (s.season_clans ?? []).map((c) => c.clan_id)))];

  useEffect(() => {
    if (seasonId) load(seasonId, clanId);
  }, [load, seasonId, clanId]);

  const go = (nextClan: string, nextSeason: string | null) =>
    router.replace(`/dashboard/cwl/${nextClan}${nextSeason ? `?season=${nextSeason}` : ''}`);
  // Switching clan keeps the current season when that clan is in it, else takes its newest one.
  const switchClan = (nextClan: string) =>
    go(nextClan, season && inSeason(season, nextClan) ? season.id : seasons.find((s) => inSeason(s, nextClan))?.id ?? null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
        <div>
          <Link href="/dashboard/cwl" className="text-muted" style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <ArrowLeft size={14} /> Clan War League
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginTop: 4 }}>
            <CalendarRange size={22} className="text-cta" />
            <h1 style={{ fontSize: '2rem', margin: 0 }}>{clanName(clanId)} · War Planner</h1>
          </div>
          <p className="text-muted" style={{ margin: '4px 0 0' }}>
            Everyone to 8★ first, then the most clan stars. Mirror hits; strength is TH against Ranked league.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          {clanOptions.length > 1 && (
            <select className="input" style={{ width: 'auto', padding: '8px 12px' }} value={clanId} onChange={(e) => switchClan(e.target.value)}>
              {clanOptions.map((id) => <option key={id} value={id}>{clanName(id)}</option>)}
            </select>
          )}
          {clanSeasons.length > 0 && (
            <select className="input" style={{ width: 'auto', padding: '8px 12px' }} value={seasonId ?? ''} onChange={(e) => go(clanId, e.target.value)}>
              {clanSeasons.map((s) => <option key={s.id} value={s.id}>{seasonLabel(s)}</option>)}
            </select>
          )}
        </div>
      </div>

      {!seasonId ? (
        <div className="card text-muted" style={{ padding: 'var(--space-lg)' }}>{clanName(clanId)} is not in any CWL season yet — create one on the Clan War League page.</div>
      ) : loading || loadedSeason !== seasonId ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
          <Activity className="animate-spin text-muted" size={22} />
        </div>
      ) : season && !inSeason(season, clanId) ? (
        <div className="card text-muted" style={{ padding: 'var(--space-lg)' }}>{clanName(clanId)} is not part of CWL {season.label}.</div>
      ) : (
        <>
          <PlanSummary />
          <NextWarPanel />
          <SwapsPanel />
          <WeekGrid />
        </>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
