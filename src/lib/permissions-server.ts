import { supabase } from './supabase';
import { AccessRole } from '@/types/database';
import { Capability, CapabilityOverrides } from './permissions';

/**
 * Server-only loader for the capability OVERRIDES stored in the role_capabilities table.
 *
 * Authorization defaults live in code (permissions.ts). This layer reads the small set of explicit
 * per-(role, capability) flags that a super_admin has configured and hands them to `can()` as the
 * `overrides` argument. An empty table => empty map => the coded defaults apply unchanged.
 *
 * Because a capability check runs on nearly every mutating request, the map is cached in-process for
 * a short TTL rather than re-queried each time. Config changes are rare and the editor invalidates
 * the cache on write; the TTL only bounds staleness across separate serverless instances.
 */

let cache: { data: CapabilityOverrides; at: number } | null = null;
const TTL_MS = 15_000;

export async function loadCapabilityOverrides(): Promise<CapabilityOverrides> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;

  const { data } = await supabase.from('role_capabilities').select('role, capability, enabled');
  const overrides: CapabilityOverrides = {};
  for (const row of (data || []) as { role: string; capability: string; enabled: boolean }[]) {
    const role = row.role as AccessRole;
    (overrides[role] ??= {})[row.capability as Capability] = row.enabled;
  }

  cache = { data: overrides, at: now };
  return overrides;
}

/** Drop the cached overrides so the next check re-reads the table. Called after a config write. */
export function invalidateCapabilityCache(): void {
  cache = null;
}
