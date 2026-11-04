'use client';

import { useMemo, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { useCwlPlannerStore } from '@/lib/stores/cwlPlannerStore';
import { isSettled, livePendingStars, optedOutInGame, SEASON_ROUNDS, warMapSlots } from '@/lib/cwl/plannerInput';
import { tierLabel } from '@/lib/cwl/leagues';
import type { AccountOutlook } from '@/lib/cwl/planner';
import { usePlan } from './usePlan';
import { STATUS_LABEL, UNAVAILABLE_REASON, BENCH_REASON, SLOT_REASON, statusColor, TIER_COLOR, pct } from './labels';

const th: React.CSSProperties = { padding: '6px 6px', fontSize: '0.64rem', textTransform: 'uppercase', color: 'var(--color-muted)', whiteSpace: 'nowrap', textAlign: 'center' };
const td: React.CSSProperties = { padding: '4px 6px', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/** The override a click moves to: plan decides → force in → force out → plan decides. */
function nextMode(current: 'in' | 'out' | undefined): 'in' | 'out' | null {
  if (!current) return 'in';
  return current === 'in' ? 'out' : null;
}

/**
 * The whole week for the clan: one row per account, one column per war.
 *
 * Wars that have started show what happened (stars, a miss, or sat out). Wars still open show the
 * plan, and clicking a cell cycles a PER-WAR override for that account — forced in, forced out, or
 * back to the planner's choice. An override only ever applies to that one war.
 */
export default function WeekGrid() {
  const plan = usePlan();
  const rounds = useCwlPlannerStore((s) => s.rounds);
  const members = useCwlPlannerStore((s) => s.members);
  const overrides = useCwlPlannerStore((s) => s.overrides);
  const flags = useCwlPlannerStore((s) => s.flags);
  const optedOut = useCwlPlannerStore((s) => s.optedOut);
  const setOverride = useCwlPlannerStore((s) => s.setOverride);
  const savingKey = useCwlPlannerStore((s) => s.savingOverrideKey);
  const roster = useCwlPlannerStore((s) => s.roster);
  // Same freshness rule as the planner, so the chip never claims an opt-out the plan is ignoring.
  const inGameOut = new Set(roster.filter((a) => optedOutInGame(a)).map((a) => a.playerTag));
  const leftFamily = new Set(roster.filter((a) => a.leftFamily).map((a) => a.playerTag));
  // In our database but linked to no member — usually a candidate for a CWL ban.
  const unlinked = new Set(roster.filter((a) => !a.untracked && !a.personName).map((a) => a.playerTag));

  // How fresh the in-game war preferences are: sync re-reads them every ~10 minutes during CWL.
  const checkedTimes = roster
    .map((a) => (a.warPreferenceCheckedAt ? new Date(a.warPreferenceCheckedAt).getTime() : null))
    .filter((t): t is number => t != null);
  const oldestCheck = checkedTimes.length ? Math.min(...checkedTimes) : null;
  // eslint-disable-next-line react-hooks/purity -- a "minutes ago" label is meant to read the clock
  const checkedAgoMin = oldestCheck != null ? Math.max(0, Math.round((Date.now() - oldestCheck) / 60_000)) : null;

  // Expected stars from the war still being fought — the attacks not made yet, each against its
  // mirror base. The planner already counts these; the grid shows them so a leader planning the next
  // war a few hours early can see what the current day is still expected to bring.
  const pending = useMemo(() => livePendingStars({ roster, rounds, members }), [roster, rounds, members]);
  const slots = useMemo(() => warMapSlots(members), [members]);

  const roundByNumber = new Map(rounds.map((r) => [r.round_number, r] as const));
  const planByNumber = new Map(plan.rounds.map((r) => [r.roundNumber, r] as const));
  const memberKey = new Map(members.map((m) => [`${m.round_id}:${m.player_tag}`, m] as const));
  const overrideKey = new Map<string, 'in' | 'out'>(overrides.map((o) => [`${o.round_number}:${o.player_account_tag}`, o.mode]));
  const flagSet = new Set(flags.map((f) => `${f.player_account_tag}:${f.flag}`));

  const header = (n: number) => {
    const stored = roundByNumber.get(n);
    if (stored && isSettled(stored.state)) {
      if (stored.state === 'warEnded') return { top: `War ${n}`, sub: 'ended' };
      let toCome = 0;
      for (const [key, e] of pending) if (key.startsWith(`${stored.id}:`)) toCome += e;
      return { top: `War ${n}`, sub: toCome > 0 ? `battle day · ~${toCome.toFixed(0)}★ to come` : 'battle day' };
    }
    const p = planByNumber.get(n);
    return { top: `War ${n}`, sub: p?.enemyKnown ? 'prep day' : 'provisional' };
  };

  const renderCell = (account: AccountOutlook, n: number): React.ReactNode => {
    const stored = roundByNumber.get(n);
    if (stored && isSettled(stored.state)) {
      const m = memberKey.get(`${stored.id}:${account.playerTag}`);
      if (!m) return <span className="text-muted" title="Did not play">·</span>;
      if (m.attacks_used > 0) return <span title={`${m.stars}★ scored`} style={{ fontWeight: 600 }}>{m.stars}★</span>;
      if (stored.state === 'warEnded') {
        return <span title="Missed attack" style={{ color: 'var(--color-danger)', fontWeight: 600 }}>✗</span>;
      }
      const e = pending.get(`${stored.id}:${account.playerTag}`);
      const slot = slots.get(`${stored.id}:${account.playerTag}`);
      return (
        <span
          className="text-muted"
          title={`Has not attacked yet${e != null ? ` — expected ~${e.toFixed(2)}★ against their mirror base${slot ? ` #${slot}` : ''}` : ''}`}
          style={{ fontStyle: 'italic' }}
        >
          {e != null ? `~${e.toFixed(1)}` : '…'}
        </span>
      );
    }

    const p = planByNumber.get(n);
    if (!p) return null;
    const key = `${n}:${account.playerTag}`;
    const mode = overrideKey.get(key);
    const slot = p.lineup.find((s) => s.playerTag === account.playerTag);
    const bench = p.bench.find((b) => b.playerTag === account.playerTag);
    const out = p.unavailable.find((u) => u.playerTag === account.playerTag);

    let content: React.ReactNode = <span className="text-muted">·</span>;
    let title = '';
    let style: React.CSSProperties = {};
    if (slot) {
      content = slot.expectedStars.toFixed(1);
      title = `Plays at #${slot.mapPosition}: ${pct(slot.tripleChance)} triple chance, ~${slot.expectedStars.toFixed(2)}★ — ${SLOT_REASON[slot.reason]}`;
      style = { background: 'rgba(34,197,94,0.14)', color: 'var(--color-text)' };
    } else if (out) {
      content = out.reason === 'forced_out' ? 'OUT' : out.reason === 'war_preference' ? 'OPT' : '—';
      title = UNAVAILABLE_REASON[out.reason];
      style =
        out.reason === 'forced_out'
          ? { background: 'rgba(239,68,68,0.14)', color: 'var(--color-danger)' }
          : out.reason === 'war_preference'
            ? { background: 'rgba(245,158,11,0.14)', color: 'var(--color-warning)' }
            : { color: 'var(--color-muted)' };
    } else if (bench) {
      title = `Bench — ${BENCH_REASON[bench.reason]}`;
    }
    if (mode === 'in') style = { ...style, boxShadow: 'inset 0 0 0 1px var(--color-cta)' };

    const next = nextMode(mode);
    const hint = next === 'in' ? 'Click: force in' : next === 'out' ? 'Click: force out' : 'Click: back to the plan';
    return (
      <button
        onClick={() => setOverride(n, account.playerTag, next)}
        disabled={savingKey === key}
        title={`${title}${mode ? ` (forced ${mode})` : ''}\n${hint}`}
        style={{ width: '100%', minWidth: 38, padding: '3px 4px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', background: 'transparent', color: 'inherit', opacity: savingKey === key ? 0.4 : 1, ...style }}
      >
        {content}
      </button>
    );
  };

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>The week</h3>
        <span className="text-muted" style={{ fontSize: '0.72rem' }}>
          Numbers are expected stars: ~italic for an attack still to come in the current war, plain in a planned war. OPT = opted out in game (next war only). Click an open war to force in → force out → back to the plan.
          {checkedAgoMin != null && <> War preferences checked {checkedAgoMin === 0 ? 'just now' : `${checkedAgoMin} min ago`}.</>}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Account</th>
              <th style={th}>TH</th>
              <th style={{ ...th, textAlign: 'left' }}>Rating</th>
              {Array.from({ length: SEASON_ROUNDS }, (_, i) => i + 1).map((n) => {
                const h = header(n);
                return (
                  <th key={n} style={th}>
                    {h.top}
                    <div style={{ fontSize: '0.58rem', textTransform: 'none', fontWeight: 400 }}>{h.sub}</div>
                  </th>
                );
              })}
              <th style={th}>★ so far</th>
              <th style={th}>Projected</th>
              <th style={{ ...th, textAlign: 'left' }}>Status</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {plan.accounts.map((a) => {
              const isRb = flagSet.has(`${a.playerTag}:rule_breaker`);
              const isBanned = flagSet.has(`${a.playerTag}:banned`);
              return (
                <tr key={a.playerTag} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', opacity: a.status === 'excluded' ? 0.6 : 1 }}>
                  <td style={{ ...td, whiteSpace: 'normal', minWidth: 140, maxWidth: 260 }}>
                    {/* Chips wrap onto the next line (the row grows) instead of being cut off. */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 6px' }}>
                      <span style={{ overflowWrap: 'anywhere' }}>{a.name}</span>
                      {isBanned && <Chip color="var(--color-danger)">BANNED</Chip>}
                      {isRb && <Chip color="var(--color-warning)">RULE BREAKER</Chip>}
                      {optedOut.has(a.playerTag) && <Chip color="var(--color-muted)">NOT PLAYING</Chip>}
                      {inGameOut.has(a.playerTag) && (
                        <Chip color="var(--color-warning)" title="War preference set to OUT in game — kept out of the next war only. Force them in to field them anyway.">
                          OPTED OUT (IN GAME)
                        </Chip>
                      )}
                      {a.excludedReason === 'unranked' && <Chip color="var(--color-warning)">UNRANKED</Chip>}
                      {leftFamily.has(a.playerTag) && (
                        <Chip color="var(--color-warning)" title="Signed up for CWL but no longer in any family clan. Still planned on what we know — force them out if they cannot play.">
                          LEFT FAMILY
                        </Chip>
                      )}
                      {a.untracked && (
                        <Chip color="var(--color-muted)" title="Signed up, but not in our database — probably left the clan after sign-up. League unknown, so rated as a typical family account minus the newcomer discount. Force them out if they are gone.">
                          NOT SYNCED
                        </Chip>
                      )}
                      {unlinked.has(a.playerTag) && (
                        <Chip color="var(--color-warning)" title="Not linked to any member — consider banning from CWL.">
                          UNLINKED
                        </Chip>
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>{a.thLevel}</td>
                  <td style={{ ...td, color: a.tier ? TIER_COLOR[a.tier] : 'var(--color-muted)', fontWeight: a.tier === 'goat' ? 700 : undefined, fontSize: '0.74rem' }}>
                    {a.tier ?? '—'}
                    {a.mirrorChance != null && <span style={{ color: 'var(--color-text)' }}> {pct(a.mirrorChance)}</span>}
                    <span className="text-muted" style={{ fontSize: '0.64rem' }}> · {tierLabel(a.leagueTier)}</span>
                  </td>
                  {Array.from({ length: SEASON_ROUNDS }, (_, i) => i + 1).map((n) => (
                    <td key={n} style={{ ...td, textAlign: 'center', padding: '2px 2px' }}>
                      {renderCell(a, n)}
                    </td>
                  ))}
                  <td style={{ ...td, textAlign: 'center' }}>
                    {a.starsSoFar}
                    {a.committed - a.starsSoFar > 0.005 && (
                      <span className="text-muted" style={{ fontStyle: 'italic', fontSize: '0.7rem' }} title="Expected from the war still being fought">
                        {' '}+~{(a.committed - a.starsSoFar).toFixed(1)}
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>{a.projected.toFixed(1)}</td>
                  <td style={{ ...td, color: statusColor(a.status), fontSize: '0.74rem' }}>{STATUS_LABEL[a.status]}</td>
                  <td style={td}>
                    <FlagMenu playerTag={a.playerTag} isBanned={isBanned} isRb={isRb} suggestBan={a.excludedReason === 'unranked' && !isBanned} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chip({ color, title, children }: { color: string; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} style={{ fontSize: '0.56rem', fontWeight: 700, letterSpacing: '0.04em', color, border: `1px solid ${color}`, borderRadius: 999, padding: '0 5px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function FlagMenu({ playerTag, isBanned, isRb, suggestBan }: { playerTag: string; isBanned: boolean; isRb: boolean; suggestBan: boolean }) {
  const [open, setOpen] = useState(false);
  const setFlag = useCwlPlannerStore((s) => s.setFlag);
  const busy = useCwlPlannerStore((s) => s.savingFlagTag === playerTag);
  const act = (flag: 'banned' | 'rule_breaker', on: boolean) => {
    setOpen(false);
    setFlag(playerTag, flag, on);
  };

  if (suggestBan) {
    return (
      <button className="btn btn-outline" disabled={busy} onClick={() => act('banned', true)} style={{ padding: '2px 8px', fontSize: '0.7rem' }}>
        Ban
      </button>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <button aria-label="CWL flags" disabled={busy} onClick={() => setOpen((v) => !v)} style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}>
        <MoreVertical size={15} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--color-secondary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', width: 190, zIndex: 60, padding: '4px 0' }}>
            <MenuItem label={isRb ? 'Clear rule breaker' : 'Mark as rule breaker'} onClick={() => act('rule_breaker', !isRb)} />
            <MenuItem label={isBanned ? 'Lift CWL ban' : 'Ban from CWL'} danger={!isBanned} onClick={() => act('banned', !isBanned)} />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', background: 'transparent', border: 'none', fontSize: '0.8rem', color: danger ? 'var(--color-danger)' : 'var(--color-text)', cursor: 'pointer' }}>
      {label}
    </button>
  );
}
