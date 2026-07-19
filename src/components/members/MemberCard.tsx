'use client';

import Link from 'next/link';
import { User, ChevronRight, Baby, Clock } from 'lucide-react';
import { babyDaysLeft } from '@/lib/babies';
import type { PersonWithAccounts } from '@/lib/stores/membersStore';

// One registry row: identity avatar, name + baby countdown, linked-account chips, and a
// link into the dossier. Purely presentational — all state lives in the store/page.
export default function MemberCard({ member, babyTrialDays }: { member: PersonWithAccounts; babyTrialDays: number }) {
  const daysLeft = member.is_baby ? babyDaysLeft(member.baby_started_at, babyTrialDays) : 0;

  return (
    <div className="card" style={{ cursor: 'default', borderLeft: member.is_baby ? '3px solid var(--color-warning)' : undefined }}>
      <div className="member-card-content">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: 'var(--radius-md)', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {member.is_baby ? <Baby size={24} color="var(--color-warning)" /> : <User size={24} color="var(--color-muted)" />}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>{member.display_name}</h3>
              {member.is_baby && (
                <span className="baby-badge">
                  <Baby size={12} /> BABY
                  <span className="baby-badge-count">
                    <Clock size={11} /> {daysLeft > 0 ? `${daysLeft}d left` : 'trial ended'}
                  </span>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              {member.player_accounts.map((acc) => (
                <span key={acc.player_tag} style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: acc.status === 'active' ? 'var(--color-cta)' : 'var(--color-muted)' }}></span>
                  {acc.in_game_name}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="member-card-actions">
          <Link href={`/dashboard/members/${member.id}`} className="btn btn-outline" style={{ padding: '0.6rem 1rem', fontSize: '0.8rem' }}>
            Open Dossier <ChevronRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
