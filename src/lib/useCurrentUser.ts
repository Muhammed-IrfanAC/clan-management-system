'use client';

import { useEffect, useState } from 'react';
import { PlayerAccount, AccessRole } from '@/types/database';

/**
 * Client hook for the logged-in leader. Reads /api/auth/me (which resolves the LIVE access_role of
 * the linked person, so a grant/revoke is reflected without a re-login) and exposes the current role
 * for UI gating. UI gating is cosmetic — the API routes are the real authorization boundary.
 */
export function useCurrentUser() {
  const [user, setUser] = useState<PlayerAccount | null>(null);
  const [role, setRole] = useState<AccessRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (active) {
            setUser(data.user);
            setRole((data.role as AccessRole | null) ?? null);
          }
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

  return { user, role, loading };
}
