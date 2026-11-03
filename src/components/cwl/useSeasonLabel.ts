'use client';

import { useCallback } from 'react';
import type { CWLSeason } from '@/types/database';
import { useClanName } from './useClanName';

/**
 * Name a season for a dropdown: its label plus the clans in it. The label defaults to the month, and
 * clans often run their own season for the same month, so "CWL 2026-11" alone cannot tell them apart.
 * Expects the season list to embed `season_clans:cwl_season_clans(clan_id)`.
 */
export function useSeasonLabel(): (season: CWLSeason) => string {
  const clanName = useClanName();
  return useCallback(
    (season) => {
      const clans = (season.season_clans ?? []).map((c) => clanName(c.clan_id));
      return clans.length ? `CWL ${season.label} · ${clans.join(', ')}` : `CWL ${season.label}`;
    },
    [clanName],
  );
}
