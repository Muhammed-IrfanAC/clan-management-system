/**
 * Discord role ids the alerts ping. Kept in a dependency-free module so the PURE renderers (and
 * their tests) can import it without pulling in the Discord transport and its Supabase client.
 */

/** The family's Leadership role — pinged by the leadership alerts (kick list, unlinked joins). */
export const LEADERSHIP_ROLE_ID = '1116744374924087458';
