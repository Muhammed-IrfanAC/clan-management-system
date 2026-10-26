'use client';

/**
 * One shared read of /api/auth/me for the client. The dashboard layout, `useCurrentUser` and the
 * per-page stores each need the acting identity on mount, and each used to fetch it themselves — two
 * or three identical requests per page, every one re-checking the live role in the database. Calls
 * made within a few seconds of each other now share one request. The window is short on purpose:
 * the response carries the LIVE role and capabilities, so a grant or revoke should still show up on
 * the next navigation rather than being pinned until a reload.
 */

const SHARE_WINDOW_MS = 5_000;

/** The /api/auth/me fields the callers read. */
export interface CurrentUserBody {
  user?: { player_tag?: string; person_id?: string | null; in_game_name?: string | null } | null;
  role?: string | null;
  capabilities?: string[];
}

let pending: { at: number; promise: Promise<unknown | null> } | null = null;

/** The parsed /api/auth/me body, or null when the request fails or is refused. */
export function fetchCurrentUser<T = CurrentUserBody>(): Promise<T | null> {
  const now = Date.now();
  if (!pending || now - pending.at > SHARE_WINDOW_MS) {
    pending = {
      at: now,
      promise: fetch('/api/auth/me')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    };
  }
  return pending.promise as Promise<T | null>;
}
