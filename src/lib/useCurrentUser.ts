'use client';

import { useEffect, useState } from 'react';
import { PlayerAccount, AccessRole } from '@/types/database';
import type { Capability } from '@/lib/permissions';
import { fetchCurrentUser } from '@/lib/currentUser';

/**
 * Client hook for the logged-in leader. Reads /api/auth/me (which resolves the LIVE access_role of
 * the linked person AND the role's EFFECTIVE capabilities — coded defaults plus runtime overrides —
 * so a grant/revoke or a permissions-config change is reflected without a re-login). Exposes both
 * the role and the capability list for UI gating. UI gating is cosmetic — the API routes are the
 * real authorization boundary.
 */
export function useCurrentUser() {
  const [user, setUser] = useState<PlayerAccount | null>(null);
  const [role, setRole] = useState<AccessRole | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetchCurrentUser<{ user: PlayerAccount; role?: AccessRole | null; capabilities?: Capability[] }>();
        if (data && active) {
          setUser(data.user);
          setRole(data.role ?? null);
          setCapabilities(data.capabilities ?? []);
        }
      } catch {
        // Non-fatal: fall back to no-capabilities (buttons hidden) until reload.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { user, role, capabilities, loading };
}
