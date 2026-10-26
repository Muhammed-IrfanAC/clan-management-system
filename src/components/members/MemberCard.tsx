'use client';

import { memo } from 'react';
import Link from 'next/link';
import { User, ChevronRight } from 'lucide-react';
import type { PersonWithAccounts } from '@/lib/stores/membersStore';

// One registry row: identity avatar, name, linked-account chips, and a
// link into the dossier. Purely presentational — all state lives in the store/page. Memoised so a
// search keystroke re-renders only the cards that changed, not the whole registry.
export default memo(function MemberCard({ member }: { member: PersonWithAccounts }) {
  return (
    <div className="card" style={{ cursor: 'default' }}>
      <div className="member-card-content">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: 'var(--radius-md)', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <User size={24} color="var(--color-muted)" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>{member.display_name}</h3>
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
});
