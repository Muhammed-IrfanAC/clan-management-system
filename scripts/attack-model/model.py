#!/usr/bin/env python3
"""Attack model — fit, time-split evaluation and export for src/lib/cwl/attackModel.ts.

Usage (see README.md for producing the inputs):
    python -I scripts/attack-model/model.py <dataDir> <clashspot th_by_league.json> [--export]

P(3★) per attack = logistic(base + rating).
  base    hit-up level, attacker TH, war type, cleanup, second attack, and the Ranked league as a
          TH-relative percentile. Fitted jointly with a static intercept per account, so the hit-up
          effects are not flattered by the best players being the ones who take hit-ups.
  rating  an online Bayesian logistic filter per account (mean + variance), predicting every attack
          BEFORE its result is seen — exactly what the app does.

Evaluation is strictly by time: the dev period (two weeks) tunes the rating settings with the base
fitted on everything before it; the test period (the last two ended weeks plus the current one) is
scored once, with the base fitted on everything before it. A random split would leak, since attacks
of one war would land on both sides. --export then refits on ALL attacks and prints the constants
for attackModel.ts plus the parity fixtures for attackModel.test.ts.
"""
import itertools
import json
import math
import sys

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.metrics import roc_auc_score

DIR, CLASHSPOT = sys.argv[1], sys.argv[2]
EXPORT = '--export' in sys.argv[3:]
BASE_ID, WEEK, ANCHOR = 105000000, 7 * 24 * 3600, 1792386000  # Ranked weeks start Monday 05:00 UTC
sig = lambda z: 1 / (1 + np.exp(-z))

# The strength × hit-up table the planner used before this model, for comparison.
BANDS = {18: (34, 33), 17: (32, 31), 16: (31, 30), 15: (30, 29)}  # (strongFrom, mediumFrom)
TRIPLE = {'strong': [1, .95, .9, .75, .25], 'medium': [.95, .8, .6, .3, 0], 'weak': [.75, .5, .1, 0, 0]}


def strength(th, tier):
    b = BANDS.get(th)
    if not b or np.isnan(tier):
        return 'medium'
    return 'strong' if tier >= b[0] else 'medium' if tier >= b[1] else 'weak'


# ------------------------------------------------------------------ inputs
att = pd.read_csv(f'{DIR}/attacks.csv')
att['t'] = pd.to_datetime(att.first_seen_at, utc=True).map(lambda x: x.timestamp())
att['end'] = pd.to_datetime(att.end_time, utc=True).map(lambda x: x.timestamp())
players = {p['tag']: p for p in json.load(open(f'{DIR}/players.json'))}
logs = {w['tag']: [(pd.to_datetime(i['endTime'], format='%Y%m%dT%H%M%S.%fZ', utc=True).timestamp(), i.get('battleModifier') or 'none')
                   for i in (w['items'] or [])] for w in json.load(open(f'{DIR}/warlogs.json'))}
history_weeks = sorted({h['leagueSeasonId'] for p in players.values() for h in (p['history'] or [])})
WINDOW_START = history_weeks[0]
CURRENT_WEEK = history_weeks[-1] + WEEK
TEST_START = CURRENT_WEEK - 2 * WEEK
DEV_START = TEST_START - 2 * WEEK
day = lambda s: pd.Timestamp(s, unit='s').strftime('%Y-%m-%d')


def modifier(r):
    """Battle modifier: stored since migration 048, else matched from the clan's war log by end time."""
    if r.kind == 'cwl':
        return 'cwl'
    if isinstance(r.battle_modifier, str) and r.battle_modifier:
        return r.battle_modifier
    for end, mod in logs.get(r.clan_tag, []):
        if abs(end - r.end) <= 300:
            return mod
    return 'unknown'


def tier_at(r):
    """(tier ordinal, imputed): stored with the attack since migration 048, else the league history."""
    if not np.isnan(r.attacker_league_tier_id):
        return (r.attacker_league_tier_id - BASE_ID, False)
    p = players.get(r.attacker_tag)
    if not p:
        return (np.nan, True)
    hist = sorted(p['history'] or [], key=lambda h: h['leagueSeasonId'])
    cur = p['currentTierId'] - BASE_ID if p['currentTierId'] else np.nan
    if r.t < WINDOW_START:  # older than the history reaches: the earliest known week stands in
        return ((hist[0]['leagueTierId'] - BASE_ID) if hist else cur, True)
    week = ANCHOR + math.floor((r.t - ANCHOR) / WEEK) * WEEK
    if week >= CURRENT_WEEK:
        return (cur, False)
    for h in hist:
        if h['leagueSeasonId'] == week:
            return (h['leagueTierId'] - BASE_ID, False)
    later = [h for h in hist if h['leagueSeasonId'] > week]  # a skipped week keeps its tier
    return ((later[0]['leagueTierId'] - BASE_ID) if later else cur, False)


att['mod'] = att.apply(modifier, axis=1)
tiers = [tier_at(r) for r in att.itertuples()]
att['tier'], att['imputed'] = [x[0] for x in tiers], [x[1] for x in tiers]

# A stand-in tier is read as a percentile at the TH it was OBSERVED at, then carried back to the
# older attack: an account that has since upgraded would otherwise have today's tier read at its old,
# lower TH, where the same tier is a far higher percentile (Electro 33 is the top 0.03% of TH16s),
# and every older miss would look like underperformance. The pre-window stand-in is the earliest
# history week, observed at the account's TH in its first attack from then on (the app's stand-in is
# today's tier at today's TH — the same rule).
first_in_window = att[att.t >= WINDOW_START].groupby('attacker_tag').attacker_th.first()
att['league_th'] = [first_in_window.get(r.attacker_tag, players.get(r.attacker_tag, {}).get('currentTh') or r.attacker_th)
                    if r.imputed and np.isnan(r.attacker_league_tier_id) else r.attacker_th for r in att.itertuples()]

cs = {int(k): np.array(v, dtype=float) for k, v in json.load(open(CLASHSPOT)).items()}


def league_pct(th, tier):
    """−log10 of the share of players at this TH in this tier or above (0 = all, 1 = top 10%, 2 = top 1%)."""
    c = cs.get(int(min(max(th, 7), 18)))
    if c is None or np.isnan(tier) or tier < 1:
        return np.nan
    return min(3.5, -math.log10(max(c[int(min(tier, 36)) - 1:].sum() / c.sum(), 1e-6)))


def _tier_sd(th):
    p = cs[th] / cs[th].sum()
    t = np.arange(1, 37)
    mean = (t * p).sum()
    return math.sqrt(((t - mean) ** 2 * p).sum())


# How spread out each TH's leagues are, relative to TH18. At TH9 nearly everyone sits in a few leagues
# (SD 1.15 tiers), so a few steps up is already the top 1%; at TH15–18 players spread over ~10 leagues.
# The percentile is weighted by this, so "top 1%" counts for less where it is cheap. On held-out weeks
# this beat the plain percentile, a standard score and "steps above the median" (2026-11-04 data).
SPREAD = {th: _tier_sd(th) / _tier_sd(18) for th in cs}


def league_strength(th, tier):
    """The league feature: the percentile, weighted by the TH's league spread (mirrors leagueStrength in attackModel.ts)."""
    return league_pct(th, tier) * SPREAD[int(min(max(th, 7), 18))]


att['lp'] = [league_strength(r.league_th, r.tier) for r in att.itertuples()]

# Heroes relative to the best of our accounts at the same TH — current profiles only, so used only
# when the attack was made at the account's current TH. (Tested; adds nothing. Kept for re-checks.)
hero_sum = {t: sum(h['level'] for h in p.get('heroes') or []) for t, p in players.items() if p.get('currentTh')}
best = {}
for t, s in hero_sum.items():
    best[players[t]['currentTh']] = max(best.get(players[t]['currentTh'], 0), s)
att['hero'] = [hero_sum[r.attacker_tag] / best[r.attacker_th]
               if r.attacker_tag in hero_sum and players[r.attacker_tag]['currentTh'] == r.attacker_th and best.get(r.attacker_th) else np.nan
               for r in att.itertuples()]

att = att.sort_values(['round_id', 'attack_order'])
att['nth'] = att.groupby(['round_id', 'attacker_tag']).cumcount()  # 1 = the account's second attack
att = att.sort_values('t', kind='stable').reset_index(drop=True)

keep = (att.label != 'dead') & att['mod'].isin(['none', 'cwl']) & ~att.tier.isna() & (att.tier > 0)
df = att[keep].copy().reset_index(drop=True)
df['y'] = (df.stars == 3).astype(float)
df['up'] = df.defender_th - df.attacker_th
y = df.y.values
print(f'attacks {len(att)} → usable {len(df)}  (dropped: dead {int((att.label == "dead").sum())}, '
      f'battle modifier/unknown {int((~att["mod"].isin(["none", "cwl"])).sum())}, no league or unranked)')
print(f'periods: fit before {day(DEV_START)} ({int((df.t < DEV_START).sum())}), dev {day(DEV_START)}–{day(TEST_START)} '
      f'({int(((df.t >= DEV_START) & (df.t < TEST_START)).sum())}), test from {day(TEST_START)} ({int((df.t >= TEST_START).sum())}); '
      f'league imputed on {int(df.imputed.sum())}')


# ------------------------------------------------------------------ model
def design(d, league=True, heroes=False):
    up, th = d.up.values, d.attacker_th.values
    cols = {
        'intercept': np.ones(len(d)),
        'up_down': up < 0, 'up_1': up == 1, 'up_2': up == 2, 'up_3': up == 3, 'up_4p': up >= 4,
        **{f'th_{k}': np.minimum(np.maximum(th, 11), 18) == k for k in [11, 12, 13, 14, 15, 16, 18]},
        'low_th_up2p': (th <= 14) & (up >= 2),
        'cwl': d.kind.values == 'cwl', 'cleanup': d.label.values == 'cleanup', 'second': d.nth.values >= 1,
    }
    if league:
        lp = d.lp.values
        # TH18's own league correction: its leagues are squeezed between a high floor (defences carry a
        # TH18 up) and the Legend I ceiling, so the spread weight undersells them; the fit nearly doubles
        # the TH18 weight (0.47 -> 0.88), held-out neutral (2026-11-04 data).
        th18 = np.minimum(d.league_th.values, 18) >= 18
        cols.update({'league': lp, 'league_x_up': lp * (up > 0), 'league_x_imputed': lp * d.imputed.values, 'imputed': d.imputed.values,
                     'league_x_th18': lp * th18})
    if heroes:
        h = d.hero.values
        cols.update({'hero': np.nan_to_num(h - 0.9, nan=0.0), 'hero_missing': np.isnan(h)})
    names = list(cols)
    return np.column_stack([np.asarray(cols[k], dtype=float) for k in names]), names


def fit(X, yy, groups, l2=1.0, v0=0.3):
    """MAP logistic fit, jointly with a random intercept per account (prior variance v0)."""
    k, P = X.shape[1], groups.max() + 1

    def f(w):
        beta, b = w[:k], w[k:]
        p = sig(X @ beta + b[groups])
        nll = -np.sum(yy * np.log(p + 1e-12) + (1 - yy) * np.log(1 - p + 1e-12))
        r = p - yy
        g = X.T @ r
        g[1:] += l2 * beta[1:]
        return nll + 0.5 * l2 * np.sum(beta[1:] ** 2) + 0.5 * np.sum(b ** 2) / v0, np.concatenate([g, np.bincount(groups, weights=r, minlength=P) + b / v0])

    return minimize(f, np.zeros(k + P), jac=True, method='L-BFGS-B', options={'maxiter': 2000}).x[:k]


# ------------------------------------------------------------------ league standing carried across weeks (and TH upgrades)
# A league tier carries over a TH upgrade but is far less rare at the higher TH (Legend III: top 0.08%
# of TH17s, top 11.5% of TH18s), and a league moves week to week. So the league feature of an attack is
# the BEST weekly standing of the CARRY_WEEKS weeks before it — each week read at the TH held that week
# — or the attack's own week if better (mirrors carriedStanding in attackModel.ts). Comparing weeks at
# different THs needs each TH's league weight, taken from a first fit without the carry. Held out on
# the 2026-11-04 data: dev 0.3462 -> 0.3431, test neutral.
CARRY_WEEKS = 8
ANCHOR_WEEK = lambda t: ANCHOR + math.floor((t - ANCHOR) / WEEK) * WEEK
_X0, _n0 = design(df, league=True)
_b0 = dict(zip(_n0, fit(_X0, y, pd.factorize(df.attacker_tag)[0])))
league_weight = lambda th: _b0['league'] + (_b0['league_x_th18'] if th >= 18 else 0)
# Each week is booked to the TH held for most of it (the most common TH of its attacks, ties to the
# lower one): an upgrade late in a week would otherwise move a league earned at the old TH to the new.
_th_week = df.assign(week=df.t.map(ANCHOR_WEEK)).groupby(['attacker_tag', 'week']).attacker_th.agg(
    lambda ths: min(ths.value_counts().pipe(lambda c: c[c == c.max()]).index))
_weeks_by_tag = {}
for (tag, w), th in _th_week.items():
    _weeks_by_tag.setdefault(tag, []).append((w, th))
STANDINGS = {}  # tag -> [(week start, league part)]
for tag, p in players.items():
    known = sorted(_weeks_by_tag.get(tag, []))
    for h in sorted(p['history'] or [], key=lambda h: h['leagueSeasonId']):
        w, tier = h['leagueSeasonId'], h['leagueTierId'] - BASE_ID
        own = [th for ww, th in known if ww == w]  # the week's own TH, else the last one before it
        before = own or [th for ww, th in known if ww < w]
        th = before[-1] if before else (p.get('currentTh') or 0)
        if th and tier > 0:
            STANDINGS.setdefault(tag, []).append((w, league_weight(th) * league_strength(th, tier)))


def carry_lp(frame):
    """The carried league feature for each row, as a value at the TH its league is read at (league_th)."""
    out = []
    for r in frame.itertuples():
        own = league_weight(r.league_th) * r.lp
        wk = ANCHOR_WEEK(r.t)
        best = max([part for w, part in STANDINGS.get(r.attacker_tag, []) if wk - CARRY_WEEKS * WEEK <= w < wk] + [own])
        out.append(best / league_weight(r.league_th))
    return np.array(out)


df['lp'] = carry_lp(df)


def newcomer_offset(n, newcomer):
    """The newcomer penalty after n attacks: -size * exp(-n / fade) (mirrors newcomerOffset in attackModel.ts)."""
    size, fade = newcomer
    return -size * math.exp(-n / fade) if size else 0.0


def filter_step(state, i, d_cols, base_z, hp, newcomer):
    """One attack through the rating filter (mirrors stepRating in attackModel.ts)."""
    v0, q30, bump, w_reg = hp
    tag, t, th, kind, yy = (c[i] for c in d_cols)
    m, v, n, lt, lth = state.get(tag, (0.0, v0, 0, None, None))
    if lt is not None:
        v = min(v0, v + q30 * (t - lt) / (30 * 86400))
        if th != lth:
            v = min(v0, v + bump)
    z = base_z[i] + m + newcomer_offset(n, newcomer)
    pred = sig(z / math.sqrt(1 + math.pi * v / 8))
    p0 = sig(z)
    w = 1.0 if kind == 'cwl' else w_reg
    v_new = 1 / (1 / v + w * p0 * (1 - p0))
    state[tag] = (m + v_new * w * (yy - p0), v_new, n + 1, t, th)
    return pred


def run_filter(d, base_z, v0, q30, bump, w_reg, newcomer=(0.0, 1.0)):
    """Online rating per account over the whole history. Returns predictions made before each
    attack's result, and the final mean/variance per account."""
    cols = (d.attacker_tag.values, d.t.values, d.attacker_th.values, d.kind.values, d.y.values)
    state, preds = {}, np.empty(len(d))
    for i in range(len(d)):
        preds[i] = filter_step(state, i, cols, base_z, (v0, q30, bump, w_reg), newcomer)
    return preds, {a: s[0] for a, s in state.items()}, {a: s[1] for a, s in state.items()}


def run_windowed(base_z, start, end, hp, newcomer, window_days):
    """Predictions for [start, end) as the APP makes them: each day the rating is rebuilt from the
    attacks of the window before it (ratingLoad.ts recomputes on every load), then keeps learning
    through the day."""
    cols = (df.attacker_tag.values, df.t.values, df.attacker_th.values, df.kind.values, y)
    T = df.t.values
    preds = np.full(len(df), np.nan)
    for day0 in sorted({start + int((t - start) // 86400) * 86400 for t in T[(T >= start) & (T < end)]}):
        state = {}
        for i in np.where((T >= day0 - window_days * 86400) & (T < day0))[0]:
            filter_step(state, i, cols, base_z, hp, newcomer)
        for i in np.where((T >= day0) & (T < min(day0 + 86400, end)))[0]:
            preds[i] = filter_step(state, i, cols, base_z, hp, newcomer)
    return preds


def metrics(p, mask):
    yy, p = y[mask], np.clip(p[mask], 0.005, 0.995)
    bins = np.minimum((p * 10).astype(int), 9)
    ece = sum(abs(p[bins == b].mean() - yy[bins == b].mean()) * (bins == b).sum() for b in range(10) if (bins == b).any()) / len(yy)
    return {'logloss': -np.mean(yy * np.log(p) + (1 - yy) * np.log(1 - p)), 'brier': np.mean((p - yy) ** 2),
            'auc': roc_auc_score(yy, p) if 0 < yy.mean() < 1 else np.nan, 'ece': ece, 'n': int(mask.sum())}


def tables(train):
    """The old table, and the same strength × hit-up table re-fitted (shrunk toward the hit-up's rate)."""
    key = lambda r: (strength(r.attacker_th, r.tier), -1 if r.up < 0 else min(int(r.up), 4))
    keys = [key(r) for r in df.itertuples()]
    old = np.array([1.0 if u < 0 else TRIPLE[s][u] for s, u in keys])
    tk = [k for k, m in zip(keys, train) if m]
    ty = y[train]
    cell, hit = {}, {}
    for (s, u), v in zip(tk, ty):
        cell.setdefault((s, u), []).append(v)
        hit.setdefault(u, []).append(v)
    overall = ty.mean()
    def rate(s, u, prior=10):
        hu = hit.get(u, [])
        base = (sum(hu) + prior * overall) / (len(hu) + prior)
        c = cell.get((s, u), [])
        return (sum(c) + prior * base) / (len(c) + prior)
    return old, np.array([rate(s, u) for s, u in keys])


GRID = list(itertools.product([0.1, 0.2, 0.35, 0.6], [0.0, 0.05, 0.15], [0.0, 0.3, 0.6, 1.0], [0.15, 0.25, 0.5, 1.0]))
VARIANTS = {'base': (False, False), 'base + league': (True, False), 'base + league + heroes': (True, True)}


def period(start, end, settings=None):
    """Score every model on [start, end) with the base fitted on everything before `start`.
    Without `settings`, the rating settings are tuned on this period (dev); with them, applied (test)."""
    train = df.t.values < start
    mask = (df.t.values >= start) & (df.t.values < end)
    old, refit = tables(train)
    out = {'old strength table': (old, None), 'strength table re-fitted': (refit, None)}
    groups = pd.factorize(df.attacker_tag[train])[0]
    for name, (league, heroes) in VARIANTS.items():
        X, _ = design(df, league, heroes)
        z = X @ fit(X[train], y[train], groups)
        out[name] = (sig(z), None)
        if settings is None:
            best = min(((metrics(run_filter(df, z, *hp)[0], mask)['logloss'], hp) for hp in GRID), key=lambda x: x[0])[1]
        else:
            best = settings[name]
        out[f'{name} + rating'] = (run_filter(df, z, *best)[0], best)
    return out, mask


def report(title, out, mask):
    print(f'\n== {title}')
    print(f'{"model":<34} {"logloss":>8} {"brier":>7} {"AUC":>6} {"ECE":>6}   CWL only: {"logloss":>8} {"AUC":>6} {"n":>4}   rating settings')
    cwl = mask & (df.kind.values == 'cwl')
    for name, (p, hp) in out.items():
        m, c = metrics(p, mask), metrics(p, cwl)
        print(f'{name:<34} {m["logloss"]:8.4f} {m["brier"]:7.4f} {m["auc"]:6.3f} {m["ece"]:6.3f}   {c["logloss"]:18.4f} {c["auc"]:6.3f} {c["n"]:4d}   {hp or ""}')


dev, dev_mask = period(DEV_START, TEST_START)
report(f'DEV {day(DEV_START)} – {day(TEST_START)} (rating settings tuned here)', dev, dev_mask)
chosen = {name: dev[f'{name} + rating'][1] for name in VARIANTS}
test, test_mask = period(TEST_START, float('inf'), chosen)
report(f'TEST from {day(TEST_START)} (settings frozen from dev, scored once)', test, test_mask)
print('rating settings = (prior variance, drift per 30 days, TH-upgrade variance, regular-war weight)')

# ------------------------------------------------------------------ the app's rating: 60-day window + newcomer penalty
# The app rebuilds each rating from the last RATING_WINDOW_DAYS of attacks on every load, and an
# account new to our wars underperforms its TH + league in its first attacks (77% vs 83% predicted
# over the first five, z = -2.9 on the 2026-11-04 data). The penalty, -size * exp(-n / fade) on the
# logit after n attacks in the window, is tuned on dev: among settings within NEWCOMER_TOLERANCE of
# the best dev score, the SLOWEST fade wins (then the best score) — the surface is flat there, and a
# slower fade also covers the smaller lag that continues past the first few attacks.
RATING_WINDOW_DAYS = 60
NEWCOMER_GRID = list(itertools.product([0.2, 0.4, 0.6, 0.8, 1.0], [1.5, 2, 3, 4, 6, 10]))
NEWCOMER_TOLERANCE = 0.0005
HP_APP = chosen['base + league']
Xw, _ = design(df, league=True)
z_dev = Xw @ fit(Xw[df.t.values < DEV_START], y[df.t.values < DEV_START], pd.factorize(df.attacker_tag[df.t.values < DEV_START])[0])
z_test = Xw @ fit(Xw[df.t.values < TEST_START], y[df.t.values < TEST_START], pd.factorize(df.attacker_tag[df.t.values < TEST_START])[0])
dev_scores = {nc: metrics(run_windowed(z_dev, DEV_START, TEST_START, HP_APP, nc, RATING_WINDOW_DAYS), dev_mask)['logloss'] for nc in [(0.0, 1.0)] + NEWCOMER_GRID}
best_dev = min(dev_scores.values())
NEWCOMER = max((nc for nc in NEWCOMER_GRID if dev_scores[nc] <= best_dev + NEWCOMER_TOLERANCE), key=lambda nc: (nc[1], -dev_scores[nc]))
p_none = run_windowed(z_test, TEST_START, float('inf'), HP_APP, (0.0, 1.0), RATING_WINDOW_DAYS)
p_new = run_windowed(z_test, TEST_START, float('inf'), HP_APP, NEWCOMER, RATING_WINDOW_DAYS)
print(f'\n== the app\'s rating ({RATING_WINDOW_DAYS}-day window), newcomer penalty size {NEWCOMER[0]} fading over {NEWCOMER[1]} attacks')
print(f'  dev  log loss: no penalty {dev_scores[(0.0, 1.0)]:.4f}, with {dev_scores[NEWCOMER]:.4f} (best on the grid {best_dev:.4f})')
print(f'  test log loss: no penalty {metrics(p_none, test_mask)["logloss"]:.4f}, with {metrics(p_new, test_mask)["logloss"]:.4f}')
print('  penalty by attacks so far: ' + ', '.join(f'{n}: {newcomer_offset(n, NEWCOMER):+.2f}' for n in [0, 3, 5, 10, 20]))

# ------------------------------------------------------------------ reliability: will the attack be made at all?
# Everything above scores attacks that were MADE. A planned slot can also be missed, and an account with
# few attacks with us misses more (a newcomer's first war: 22.6% of attacks missed vs ~11%). So a second,
# slower discount is tuned on WAR SLOTS — every attack made plus every missed attack (misses.csv, from
# export_misses.sql) scored as no triple. The rating still learns from attacks made only, with the
# attack part above; the reliability part only enters what a slot is expected to yield (the planner, the
# Strength score). Same tie rule: the slowest fade within NEWCOMER_TOLERANCE of the best dev score.
RELIABILITY = (0.0, 1.0)
try:
    ms = pd.read_csv(f'{DIR}/misses.csv')
except FileNotFoundError:
    ms = None
    print('\n(no misses.csv — reliability part not tuned; see README)')
if ms is not None:
    excluded_wars = set(att[~att['mod'].isin(['none', 'cwl'])].round_id)
    ms = ms[~ms.round_id.isin(excluded_wars) & ms.player_tag.isin(set(df.attacker_tag))].copy()
    ms['t'] = pd.to_datetime(ms.end_time, utc=True).map(lambda x: x.timestamp())
    miss_rows = []
    for r in ms.itertuples():
        tier, imputed = tier_at(pd.Series({'attacker_league_tier_id': np.nan, 'attacker_tag': r.player_tag, 't': r.t}))
        if np.isnan(tier) or tier <= 0:
            continue
        lth = first_in_window.get(r.player_tag, r.th_level) if imputed else r.th_level
        miss_rows += [{'attacker_tag': r.player_tag, 't': r.t, 'attacker_th': r.th_level, 'kind': r.kind, 'up': 0, 'label': 'fresh', 'nth': 0,
                       'tier': tier, 'imputed': imputed, 'league_th': lth, 'lp': league_strength(lth, tier), 'hero': np.nan, 'y': 0.0, 'miss': True}] * int(r.missed)
    slots = pd.concat([df.assign(miss=False), pd.DataFrame(miss_rows)], ignore_index=True).sort_values('t', kind='stable').reset_index(drop=True)
    slots.loc[slots.miss, 'lp'] = carry_lp(slots[slots.miss])
    sY, sT, sTAG, sTH, sKIND, sMISS = (slots[c].values for c in ['y', 't', 'attacker_tag', 'attacker_th', 'kind', 'miss'])
    v0_, _, bump_, w_reg_ = HP_APP

    def slot_run(z, start, end, rel):
        preds = np.full(len(slots), np.nan)
        def step(state, i, learn):
            a = sTAG[i]
            m, v, n, lth = state.get(a, (0.0, v0_, 0, None))
            if lth is not None and sTH[i] != lth:
                v = min(v0_, v + bump_)
            za = z[i] + m + newcomer_offset(n, NEWCOMER)
            pred = sig((za + newcomer_offset(n, rel)) / math.sqrt(1 + math.pi * v / 8))
            if learn:
                p0 = sig(za)
                w = 1.0 if sKIND[i] == 'cwl' else w_reg_
                vn = 1 / (1 / v + w * p0 * (1 - p0))
                state[a] = (m + vn * w * (sY[i] - p0), vn, n + 1, sTH[i])
            return pred
        for day0 in sorted({start + int((t - start) // 86400) * 86400 for t in sT[(sT >= start) & (sT < end)]}):
            state = {}
            for i in np.where((sT >= day0 - RATING_WINDOW_DAYS * 86400) & (sT < day0) & ~sMISS)[0]:
                step(state, i, True)
            for i in np.where((sT >= day0) & (sT < min(day0 + 86400, end)))[0]:
                preds[i] = step(state, i, not sMISS[i])
        return preds

    def slot_ll(p, m):
        q = np.clip(p[m], 0.005, 0.995)
        return -np.mean(sY[m] * np.log(q) + (1 - sY[m]) * np.log(1 - q))

    Xs, _ = design(slots, league=True)
    zs = {k: Xs @ fit(Xs[(sT < k) & ~sMISS], sY[(sT < k) & ~sMISS], pd.factorize(slots.attacker_tag[(sT < k) & ~sMISS])[0]) for k in (DEV_START, TEST_START)}
    s_dev, s_test = (sT >= DEV_START) & (sT < TEST_START), sT >= TEST_START
    RELIABILITY_GRID = list(itertools.product([0.2, 0.4, 0.6, 0.8, 1.0], [10, 20, 30, 45, 60, 90]))
    rel_scores = {nc: slot_ll(slot_run(zs[DEV_START], DEV_START, TEST_START, nc), s_dev) for nc in [(0.0, 1.0)] + RELIABILITY_GRID}
    rel_best = min(rel_scores.values())
    RELIABILITY = max((nc for nc in RELIABILITY_GRID if rel_scores[nc] <= rel_best + NEWCOMER_TOLERANCE), key=lambda nc: (nc[1], -rel_scores[nc]))
    t_none = slot_ll(slot_run(zs[TEST_START], TEST_START, float('inf'), (0.0, 1.0)), s_test)
    t_rel = slot_ll(slot_run(zs[TEST_START], TEST_START, float('inf'), RELIABILITY), s_test)
    print(f'\n== reliability part (war slots: {(~sMISS).sum()} attacks + {sMISS.sum()} misses): size {RELIABILITY[0]} fading over {RELIABILITY[1]} attacks')
    print(f'  dev  slot log loss: attack part only {rel_scores[(0.0, 1.0)]:.4f}, + reliability {rel_scores[RELIABILITY]:.4f}')
    print(f'  test slot log loss: attack part only {t_none:.4f}, + reliability {t_rel:.4f}')
    print('  combined discount by attacks in the window: ' + ', '.join(f'{n}: {newcomer_offset(n, NEWCOMER) + newcomer_offset(n, RELIABILITY):+.2f}' for n in [0, 3, 6, 10, 20, 30, 45, 60]))

if EXPORT:
    HP = chosen['base + league']
    X, names = design(df, league=True)
    beta = fit(X, y, pd.factorize(df.attacker_tag)[0])
    fails = df[df.stars < 3]
    fail = lambda m: round(float(fails.stars[m].mean()), 3)
    c = dict(zip(names, (round(float(b), 4) for b in beta)))

    # The unknown-league stand-in: a typical ACCOUNT active in the last six weeks, not a typical attack.
    last = df.groupby('attacker_tag').agg(lp=('lp', 'last'), t=('t', 'last'))
    unknown = round(float(last[last.t >= df.t.max() - 42 * 86400].lp.median()), 3)

    def fixture(ath, dth, tier, cwl, cleanup=False, second=False, imputed=False):
        d = pd.DataFrame([{'up': dth - ath, 'attacker_th': ath, 'kind': 'cwl' if cwl else 'regular', 'label': 'cleanup' if cleanup else 'fresh',
                           'nth': int(second), 'lp': league_strength(ath, tier), 'imputed': imputed, 'league_th': ath}])
        return round(float((design(d)[0] @ beta)[0]), 4)

    print(f'\n== export: fitted on {len(df)} attacks, {day(df.t.min())} – {day(df.t.max())}; paste into src/lib/cwl/attackModel.ts')
    print(f"""export const COEFFICIENTS = {{
  intercept: {c['intercept']},
  upDown: {c['up_down']},
  up1: {c['up_1']},
  up2: {c['up_2']},
  up3: {c['up_3']},
  up4Plus: {c['up_4p']},
  th: {{ 11: {c['th_11']}, 12: {c['th_12']}, 13: {c['th_13']}, 14: {c['th_14']}, 15: {c['th_15']}, 16: {c['th_16']}, 17: 0, 18: {c['th_18']} }} as Record<number, number>,
  lowThUp2Plus: {c['low_th_up2p']},
  cwl: {c['cwl']},
  cleanup: {c['cleanup']},
  secondAttack: {c['second']},
  league: {c['league']},
  leagueTh18: {c['league_x_th18']},
  leagueOnHitUp: {c['league_x_up']},
  leagueImputed: {c['league_x_imputed']},
  imputed: {c['imputed']},
}} as const;
RATING = {{ priorVariance: {HP[0]}, driftPer30Days: {HP[1]}, thUpgradeVariance: {HP[2]}, regularWarWeight: {HP[3]}, newcomerPenalty: {NEWCOMER[0]}, newcomerFadeAttacks: {NEWCOMER[1]} }}
RELIABILITY = {{ penalty: {RELIABILITY[0]}, fadeAttacks: {RELIABILITY[1]} }}
FAIL_STARS = {{ upToTwo: {fail(fails.up <= 2)}, threeOrMore: {fail(fails.up >= 3)} }}
UNKNOWN_LEAGUE_STRENGTH = {unknown}""")
    print('\nparity fixtures for attackModel.test.ts (baseLogit):')
    for args in [(17, 17, 32, True), (15, 17, 29, True), (18, 17, 34, True), (12, 15, 20, False, True, True), (16, 17, 31, False, False, False, True), (10, 14, 12, True)]:
        print(f'  {args} → {fixture(*args)}')

    # the rating filter on a fixed synthetic history (base logits given), for stepRating parity
    hist = pd.DataFrame({'attacker_tag': ['#X'] * 5, 't': [0.0, 86400.0, 5 * 86400.0, 6 * 86400.0, 40 * 86400.0],
                         'attacker_th': [16, 16, 16, 17, 17], 'kind': ['regular', 'regular', 'cwl', 'cwl', 'cwl'], 'y': [1.0, 0.0, 1.0, 1.0, 0.0]})
    preds, mu, var = run_filter(hist, np.array([1.2, 0.4, 1.8, 0.9, 1.5]), *HP, newcomer=NEWCOMER)
    print(f'parity fixture (stepRating): predicted {[float(p) for p in preds]}, mean {mu["#X"]}, variance {var["#X"]}')
