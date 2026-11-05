// Fetch what the attack model needs from the CoC API that the database does not keep:
//   - each recent attacker's Ranked league history (~5 weeks) and current profile (tier, TH, heroes)
//   - each clan's war log, for the battle modifier of wars ingested before migration 048
// Usage: node scripts/attack-model/fetch.mjs <envFile> <attacks.csv> <outDir>
// Reads COC_API_TOKEN (and optional COC_API_PROXY_URL) from the env file; never prints them.
import { readFileSync, writeFileSync } from 'node:fs';

const [envFile, csvPath, outDir] = process.argv.slice(2);
if (!outDir) throw new Error('usage: node fetch.mjs <envFile> <attacks.csv> <outDir>');
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8').split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
if (!env.COC_API_TOKEN) throw new Error('COC_API_TOKEN missing');
const BASE = (env.COC_API_PROXY_URL || 'https://api.clashofclans.com/v1').replace(/\/$/, '');

// The league history only reaches back ~5 weeks, so only attackers active in the last 6 are fetched.
const SINCE = Date.now() - 42 * 86_400_000;
const [header, ...lines] = readFileSync(csvPath, 'utf8').trim().split('\n');
const cols = header.split(',');
const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
const tags = [...new Set(rows.filter((r) => Date.parse(r.first_seen_at.replace(' ', 'T').replace(/\+00$/, 'Z')) >= SINCE).map((r) => r.attacker_tag))];
const clanTags = [...new Set(rows.map((r) => r.clan_tag))];
console.log(`attackers active in the last 6 weeks: ${tags.length}, clans: ${clanTags.length}`);

async function get(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${env.COC_API_TOKEN}` } });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (!res.ok) return { status: res.status };
    return { status: 200, body: await res.json() };
  }
  return { status: 429 };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const home = (list) => (list ?? []).filter((x) => x.village === 'home').map((x) => ({ name: x.name, level: x.level }));
const players = await pool(tags, 4, async (tag) => {
  const enc = encodeURIComponent(tag);
  const hist = await get(`/players/${enc}/leaguehistory`);
  const prof = await get(`/players/${enc}`);
  return {
    tag,
    history: hist.body?.items ?? null,
    currentTierId: prof.body?.leagueTier?.id ?? null,
    currentTh: prof.body?.townHallLevel ?? null,
    heroes: home(prof.body?.heroes),
    status: [hist.status, prof.status],
  };
});
const warlogs = await pool(clanTags, 2, async (tag) => {
  const r = await get(`/clans/${encodeURIComponent(tag)}/warlog?limit=200`);
  return { tag, status: r.status, items: r.body?.items ?? null };
});

writeFileSync(`${outDir}/players.json`, JSON.stringify(players));
writeFileSync(`${outDir}/warlogs.json`, JSON.stringify(warlogs));
const failed = players.filter((p) => p.status.some((s) => s !== 200));
console.log(`players: ${players.length} (failed reads ${failed.length}, empty history ${players.filter((p) => p.history?.length === 0).length})`);
console.log('war logs:', warlogs.map((w) => `${w.tag} ${w.status} ${w.items?.length ?? 0}`).join(' | '));
