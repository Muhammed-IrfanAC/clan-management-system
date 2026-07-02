'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  ListChecks, Activity, ChevronRight, CheckCircle2,
  UserX, MessageCirclePlus, Clock, ClipboardCheck, Send,
} from 'lucide-react';
import { OnboardingEvent } from '@/types/database';
import { buildQueues, PersonOnboarding, QueueBucket, QueueKey, QueueTone } from '@/lib/queues';

// lucide names from queues.ts → components (keeps the lib React-free).
const QUEUE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  UserX, MessageCirclePlus, Clock, ClipboardCheck, Send,
};

// Tone → colour, matching the dashboard's danger/warning/info language.
const TONE: Record<QueueTone, { color: string; bg: string }> = {
  danger: { color: 'var(--color-danger)', bg: 'rgba(239, 68, 68, 0.12)' },
  warning: { color: 'var(--color-warning)', bg: 'rgba(245, 158, 11, 0.12)' },
  info: { color: 'var(--color-cta)', bg: 'rgba(34, 197, 94, 0.12)' },
};

const dayLabel = (d: number) => (d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`);

export default function OnboardingQueues({ selectedClanId }: { selectedClanId: string }) {
  const [loading, setLoading] = useState(true);
  const [buckets, setBuckets] = useState<QueueBucket[]>([]);
  const [active, setActive] = useState<QueueKey | 'all'>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // In-flight cohort = members still on trial (is_baby). Promotion flips is_baby off, so this
      // is exactly the set with a live onboarding journey. Clan scope via their accounts in JS.
      const { data } = await supabase
        .from('persons')
        .select(`
          id, display_name, created_at,
          player_accounts ( clan_id ),
          onboarding_events ( * )
        `)
        .eq('is_baby', true);

      type Row = PersonOnboarding & { player_accounts: { clan_id: string }[] };
      let rows = (data as unknown as Row[]) || [];
      if (selectedClanId !== 'all') {
        rows = rows.filter((r) => (r.player_accounts || []).some((a) => a.clan_id === selectedClanId));
      }

      const persons: PersonOnboarding[] = rows.map((r) => ({
        id: r.id,
        display_name: r.display_name,
        created_at: r.created_at,
        onboarding_events: (r.onboarding_events as OnboardingEvent[]) || [],
      }));

      setBuckets(buildQueues(persons, new Date()));
    } catch (err) {
      console.error('Onboarding queues error:', err);
      setBuckets([]);
    } finally {
      setLoading(false);
    }
  }, [selectedClanId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount / clan change
    fetchData();
  }, [fetchData]);

  const totalWaiting = useMemo(() => buckets.reduce((n, b) => n + b.members.length, 0), [buckets]);
  const nonEmpty = buckets.filter((b) => b.members.length > 0);
  const shown = active === 'all' ? nonEmpty : buckets.filter((b) => b.def.key === active);

  return (
    <div className="card">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <ListChecks size={18} className="text-cta" />
            <h3 style={{ fontSize: '1rem', margin: 0 }}>Onboarding Queues</h3>
          </div>
          <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>
            {loading ? 'Loading…' : totalWaiting === 0 ? 'Everyone is on track.' : `${totalWaiting} member${totalWaiting === 1 ? '' : 's'} waiting on a leadership action.`}
          </p>
        </div>

        {/* Queue filter chips */}
        {!loading && totalWaiting > 0 && (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <FilterChip label="All" count={totalWaiting} activeChip={active === 'all'} onClick={() => setActive('all')} />
            {buckets.filter((b) => b.members.length > 0).map((b) => (
              <FilterChip
                key={b.def.key}
                label={b.def.label}
                count={b.members.length}
                tone={b.def.tone}
                activeChip={active === b.def.key}
                onClick={() => setActive(b.def.key)}
              />
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140 }}>
          <Activity className="animate-spin text-muted" size={20} />
        </div>
      ) : totalWaiting === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-xl)', textAlign: 'center' }}>
          <CheckCircle2 size={28} className="text-cta" />
          <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>No members are waiting — onboarding is all caught up.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          {shown.map((b) => {
            const Icon = QUEUE_ICONS[b.def.icon] ?? ListChecks;
            const tone = TONE[b.def.tone];
            return (
              <div key={b.def.key}>
                {/* Queue heading */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                  <span style={{ display: 'inline-flex', padding: '5px', borderRadius: 'var(--radius-md)', background: tone.bg }}>
                    <Icon size={15} />
                  </span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{b.def.label}</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: tone.color, fontVariantNumeric: 'tabular-nums' }}>{b.members.length}</span>
                  <span className="text-muted" style={{ fontSize: '0.72rem' }}>· {b.def.description}</span>
                </div>

                {/* Members, stalest first */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {b.members.map((m) => (
                    <Link
                      key={m.personId}
                      href={`/dashboard/members/${m.personId}`}
                      style={{
                        display: 'grid', gridTemplateColumns: '1fr auto 16px', alignItems: 'center', gap: 'var(--space-md)',
                        padding: '8px 10px', borderRadius: 'var(--radius-md)', textDecoration: 'none',
                        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.name}
                        {m.queue === 'awaiting_reply' && (
                          <span className="text-muted" style={{ fontSize: '0.72rem', fontWeight: 400, marginLeft: 6 }}>· attempt {m.attemptsUsed}/3</span>
                        )}
                      </span>
                      <span
                        style={{ fontSize: '0.72rem', fontWeight: 600, color: m.daysInStage >= 3 ? tone.color : 'var(--color-muted)', whiteSpace: 'nowrap' }}
                        title={`Waiting ${dayLabel(m.daysInStage)}`}
                      >
                        {dayLabel(m.daysInStage)}
                      </span>
                      <ChevronRight size={15} className="text-muted" />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label, count, tone, activeChip, onClick,
}: { label: string; count: number; tone?: QueueTone; activeChip: boolean; onClick: () => void }) {
  const accent = tone ? TONE[tone].color : 'var(--color-cta)';
  return (
    <button
      onClick={onClick}
      aria-pressed={activeChip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', cursor: 'pointer',
        fontSize: '0.7rem', fontWeight: 700, borderRadius: '999px',
        border: `1px solid ${activeChip ? accent : 'rgba(255,255,255,0.1)'}`,
        background: activeChip ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: activeChip ? 'var(--color-text)' : 'var(--color-muted)',
      }}
    >
      {label}
      <span style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  );
}
