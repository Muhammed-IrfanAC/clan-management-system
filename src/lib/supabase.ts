import { createClient } from '@supabase/supabase-js';

/**
 * The one Supabase client, SERVER-SIDE ONLY. It authenticates with the project's secret
 * (service-role) key, which bypasses RLS — authorization is enforced in code by every API route
 * (`auth-server.ts`), and the database itself grants the public anon role nothing. Browser code
 * reads and writes through the API routes; ESLint forbids importing this module from client code,
 * and the guard below refuses to build a client in a browser should an import slip through.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` takes either key format (`sb_secret_…` or the legacy service_role
 * JWT). It is required: since migration 042 the anon role holds no privileges, so the anon-key
 * fallback below only lets the module load (build, tests) — every query through it is refused.
 */

if (typeof window !== 'undefined') {
  throw new Error('@/lib/supabase is server-only — call an API route from the browser instead.');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon key, which has no database access (migration 042).');
}

export const supabase = createClient(supabaseUrl, serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
