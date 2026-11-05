# Attack model — fitting and evaluation

Fits the constants in `src/lib/cwl/attackModel.ts` (the chance that one war attack triples) and
checks them on weeks the fit never saw. Nothing here runs in the app; it is the offline half that
produces the numbers the app's pure module uses.

All data stays in `/data/` (git-ignored): it is prod player data and must never be committed.

## Inputs

| File | From |
|---|---|
| `attacks.csv` | `export_attacks.sql` against a **restored** prod dump (never against prod itself) |
| `misses.csv` | `export_misses.sql`, the same way: every missed attack, for the reliability part |
| `players.json`, `warlogs.json` | `fetch.mjs` — the CoC API's league history (~5 weeks), current profiles, war logs |
| `th_by_league.json` | ClashSpot's players-per-league chart per TH (already in `data/clashspot/`) |

Since migration 048 the attacker's league and the war's battle modifier are stored with each attack,
so the API's 5-week league history only matters for attacks older than that.

## Steps

```bash
# 1. restore a prod dump into a scratch database in the local Supabase container
docker exec supabase_db_clan-management psql -U postgres -c "CREATE DATABASE prod_snapshot"
docker exec -i supabase_db_clan-management pg_restore -U postgres -d prod_snapshot --no-owner --no-privileges < data/prod-dumps/<dump>.dump

# 2. export the attacks and fetch what the database does not keep
mkdir -p data/calibration
docker exec -i supabase_db_clan-management psql -U postgres -d prod_snapshot -At < scripts/attack-model/export_attacks.sql > data/calibration/attacks.csv
docker exec -i supabase_db_clan-management psql -U postgres -d prod_snapshot -At < scripts/attack-model/export_misses.sql > data/calibration/misses.csv
node scripts/attack-model/fetch.mjs .env.local data/calibration/attacks.csv data/calibration

# 3. fit + evaluate (a venv outside the repo, e.g. in /tmp)
python3 -m venv /tmp/attack-model-venv && /tmp/attack-model-venv/bin/pip install -r scripts/attack-model/requirements.txt
/tmp/attack-model-venv/bin/python -I scripts/attack-model/model.py data/calibration data/clashspot/th_by_league.json --export
```

Run `fetch.mjs` soon after taking the dump: it fetches attackers active in the last six weeks, and
league history is only kept for about five.

## Reading the output

Two periods, both strictly later than what was fitted:

- **dev** (two weeks) — the base is fitted on everything before it and the rating settings are tuned
  on it.
- **test** (the last two ended Ranked weeks plus the current one) — the base is refitted on
  everything before it, the dev settings are frozen, and it is scored once.

A random split would leak, because one war's attacks would land on both sides. Lower log loss and
Brier are better, higher AUC (ranking) is better, and ECE is the calibration error. The old strength
table and the same table re-fitted are printed as the baselines.

`--export` refits on **all** attacks and prints the constants block for `attackModel.ts`, plus the
parity fixtures for `attackModel.test.ts`. Paste both, then run
`npx vitest run src/lib/cwl/attackModel.test.ts`.

## What the app adds at runtime

- The app rates accounts over the last 60 days of attacks only (`RATING_WINDOW_DAYS` in
  `ratingLoad.ts`). That was neutral against all history on held-out weeks, and it lets a rating keep
  up with a player who improved. `model.py` replays exactly that, rebuilding each day's ratings from
  the window before it (`run_windowed`).
- The few-wars discount has two parts, both tuned on that replay with the same tie rule: among grid
  settings within 0.0005 of the best dev score, the slowest fade wins.
  - The attack part (`RATING.newcomerPenalty` / `newcomerFadeAttacks`) is tuned on attacks made.
  - The reliability part (`RELIABILITY`) is tuned on war slots (attacks made plus `misses.csv`).
- The league feature is the percentile weighted by the TH's league spread (`SPREAD` / `LEAGUE_SPREAD`),
  with TH18's own fitted correction, carried as the best weekly standing of the last 8 weeks.
  `model.py` builds those weeks from `players.json`'s league history, with each week booked to the TH
  held for most of that week's attacks. The app reads them from `ranked_league_weeks` (migration 050), which a sync step keeps
  from the same API.
- Ranked attacks are being collected in `ranked_attacks` (migration 049) for a future fit. Nothing
  here uses them yet.

## Caveats

- Five weeks of league history means most older attacks get an *imputed* league, which the model
  flags. This improves as the stored league (migration 048) accumulates.
- With one test period of about 30 wars, the rating's edge over base + league is consistent but not
  yet statistically confirmed. Re-run it as data grows.
- The ClashSpot counts are a snapshot (Nov 2026). A new TH release or a league rework shifts the
  percentiles, so refresh them along with the fit.
