'use client';

import { useCallback } from 'react';
import { useClan } from '@/lib/ClanContext';

/**
 * Resolve a clan id to its display name. Every CWL panel needs this and each used to receive its own
 * `clanName` prop threaded down from the page; they now read the same ClanContext the rest of the
 * dashboard names clans from, which is what lets the panels take their data straight from the store
 * instead of via props.
 */
export function useClanName(): (clanId: string | null | undefined) => string {
  const { clans } = useClan();
  return useCallback(
    (clanId) => (clanId ? clans.find((c) => c.id === clanId)?.display_name ?? 'Unknown clan' : '—'),
    [clans],
  );
}
