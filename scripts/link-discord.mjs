/**
 * Backfill persons.discord_user_id from a Discord-export CSV.
 *
 * The CSV must have a header row with at least `tag` (CoC player tag) and `discord_id` columns;
 * extra columns (discord_username, coc_name) are ignored but handy for the report. Each tag is
 * resolved GLOBALLY against player_accounts.player_tag -> person_id (the same identity key sync
 * uses), then persons.discord_user_id is set on that person. Alts of one Discord user share a
 * person, so several tags collapsing onto one person is normal, not a conflict.
 *
 * DRY RUN by default — it only prints what it would do. Pass --apply to write. Reads Supabase creds
 * from the environment, so run it through dotenv-cli to pick the right project:
 *
 *   npx dotenv -e .env.testing -- node scripts/link-discord.mjs --file ~/Downloads/discord-links.csv
 *   npx dotenv -e .env.local   -- node scripts/link-discord.mjs --file ~/Downloads/discord-links.csv --apply
 *
 * It never clears an existing link and skips rows whose person already has the same id. Rows whose
 * tag isn't in the roster, or whose account has no linked person, are reported and left untouched.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fileArg = args[args.indexOf('--file') + 1];
if (!args.includes('--file') || !fileArg) {
  console.error('Usage: node scripts/link-discord.mjs --file <csv> [--apply]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — run via dotenv-cli.');
  process.exit(1);
}
const supabase = createClient(url, key);

/** Minimal RFC-4180-ish CSV parser (handles quoted fields, embedded commas/newlines). */
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const normTag = (t) => {
  const s = (t || '').trim().toUpperCase();
  if (!s) return '';
  return s.startsWith('#') ? s : '#' + s;
};

const raw = parseCsv(readFileSync(fileArg, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
const header = raw[0].map((h) => h.trim().toLowerCase());
const iTag = header.indexOf('tag');
const iId = header.indexOf('discord_id');
const iName = header.indexOf('coc_name');
if (iTag < 0 || iId < 0) {
  console.error('CSV needs `tag` and `discord_id` header columns. Found:', header.join(', '));
  process.exit(1);
}
const inputRows = raw.slice(1)
  .map((r) => ({ tag: normTag(r[iTag]), discordId: (r[iId] || '').trim(), name: iName >= 0 ? (r[iName] || '').trim() : '' }))
  .filter((r) => r.tag && r.discordId);

console.log(`Loaded ${inputRows.length} tag+discord rows from ${fileArg}`);
console.log(`Target: ${url}   Mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

// Pull every account once and resolve by tag (paginate past the 1000-row PostgREST cap).
const accounts = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('player_accounts')
    .select('player_tag, person_id, in_game_name, status')
    .range(from, from + 999);
  if (error) { console.error('Failed to read player_accounts:', error.message); process.exit(1); }
  accounts.push(...(data || []));
  if (!data || data.length < 1000) break;
}
const byTag = new Map(accounts.map((a) => [a.player_tag.toUpperCase(), a]));

// Current discord ids per person, to skip no-op writes and flag re-assignments.
const persons = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from('persons').select('id, display_name, discord_user_id').range(from, from + 999);
  if (error) { console.error('Failed to read persons:', error.message); process.exit(1); }
  persons.push(...(data || []));
  if (!data || data.length < 1000) break;
}
const personById = new Map(persons.map((p) => [p.id, p]));

const unmatchedTag = [];   // tag not in roster at all
const noPerson = [];       // account exists but not linked to a person
const alreadySet = [];     // person already has this exact discord id
const conflicts = [];      // person already linked to a DIFFERENT discord id
const toApply = new Map(); // personId -> { discordId, tags: [], name }

for (const row of inputRows) {
  const acct = byTag.get(row.tag);
  if (!acct) { unmatchedTag.push(row); continue; }
  if (!acct.person_id) { noPerson.push({ ...row, account: acct.in_game_name }); continue; }
  const person = personById.get(acct.person_id);
  const current = person?.discord_user_id?.trim() || '';
  if (current === row.discordId) { alreadySet.push({ ...row, person: person?.display_name }); continue; }
  if (current && current !== row.discordId) {
    conflicts.push({ ...row, person: person?.display_name, existing: current });
    continue;
  }
  const planned = toApply.get(acct.person_id);
  if (planned && planned.discordId !== row.discordId) {
    // Two different Discord ids want the same person — alts that AREN'T actually the same human.
    conflicts.push({ ...row, person: person?.display_name, existing: `${planned.discordId} (from ${planned.tags.join(',')})` });
    continue;
  }
  if (planned) planned.tags.push(row.tag);
  else toApply.set(acct.person_id, { discordId: row.discordId, tags: [row.tag], name: row.name || person?.display_name });
}

console.log(`Will link ${toApply.size} person(s):`);
for (const [pid, v] of toApply) console.log(`  + ${v.name || pid}  ->  ${v.discordId}   [${v.tags.join(', ')}]`);
console.log(`\nAlready linked (skip):      ${alreadySet.length}`);
console.log(`Account not linked to person: ${noPerson.length}`);
console.log(`Tag not found in roster:    ${unmatchedTag.length}`);
console.log(`Conflicts (needs a human):  ${conflicts.length}`);

const dump = (label, rows, fmt) => {
  if (!rows.length) return;
  console.log(`\n--- ${label} ---`);
  for (const r of rows) console.log('  ' + fmt(r));
};
dump('CONFLICTS — person already/also linked to a different discord id', conflicts,
  (r) => `${r.tag} (${r.name}) person="${r.person}" wants ${r.discordId} but has ${r.existing}`);
dump('TAG NOT FOUND in roster', unmatchedTag, (r) => `${r.tag} (${r.name}) discord=${r.discordId}`);
dump('ACCOUNT NOT LINKED to a person', noPerson, (r) => `${r.tag} (${r.account}) discord=${r.discordId}`);

if (!apply) {
  console.log('\nDRY RUN complete — no writes. Re-run with --apply to persist.');
  process.exit(0);
}

console.log('\nApplying...');
let ok = 0, fail = 0;
for (const [pid, v] of toApply) {
  const { error } = await supabase.from('persons').update({ discord_user_id: v.discordId }).eq('id', pid);
  if (error) { fail++; console.error(`  FAIL ${v.name || pid}: ${error.message}`); }
  else ok++;
}
console.log(`\nDone. Updated ${ok} person(s)${fail ? `, ${fail} failed` : ''}.`);
