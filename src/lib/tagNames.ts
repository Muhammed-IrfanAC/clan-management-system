import { supabase } from './supabase';

/**
 * Resolve player tags (loggers, note authors, approvers — columns with no FK to accounts) to a
 * display name and the person each belongs to. The name prefers the linked person's display name,
 * then the in-game name, then the tag itself; `authorPersons` is what lets an author's alts inherit
 * their edit/delete controls. Shared by the read routes behind the strikes and dossier
 * screens and the leadership chart, which each used to run this lookup from the browser.
 */
export async function resolveTagNames(tags: Iterable<string | null | undefined>): Promise<{
  loggerNames: Record<string, string>;
  authorPersons: Record<string, string | null>;
}> {
  const unique = Array.from(new Set(Array.from(tags).filter((t): t is string => !!t)));
  const loggerNames: Record<string, string> = {};
  const authorPersons: Record<string, string | null> = {};
  if (!unique.length) return { loggerNames, authorPersons };

  const { data, error } = await supabase
    .from('player_accounts')
    .select('player_tag, person_id, in_game_name, person:persons (display_name)')
    .in('player_tag', unique);
  // Best-effort, as it always was: unresolved tags render as the raw tag rather than blanking a page.
  if (error) console.error('Tag name lookup failed:', error);

  type Row = { player_tag: string; person_id: string | null; in_game_name: string | null; person: { display_name: string } | null };
  for (const l of (data as unknown as Row[]) || []) {
    loggerNames[l.player_tag] = l.person?.display_name || l.in_game_name || l.player_tag;
    authorPersons[l.player_tag] = l.person_id ?? null;
  }
  return { loggerNames, authorPersons };
}
