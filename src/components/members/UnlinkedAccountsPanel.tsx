'use client';

import { UserPlus } from 'lucide-react';
import type { AccountWithClan } from '@/lib/stores/membersStore';

// Roster-review queue: active in-game accounts that aren't tied to a person yet. Each opens
// the link modal (owned by the page). Hidden entirely when the queue is empty.
export default function UnlinkedAccountsPanel({
  accounts,
  onLink,
}: {
  accounts: AccountWithClan[];
  onLink: (account: AccountWithClan) => void;
}) {
  if (accounts.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 'var(--space-2xl)', border: '1px solid rgba(34, 197, 94, 0.2)', background: 'rgba(34, 197, 94, 0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <div style={{ padding: '8px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: 'var(--radius-md)' }}>
          <UserPlus className="text-cta" size={20} />
        </div>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Roster Review Required</h3>
        <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--color-cta)', color: '#000', borderRadius: '10px', fontWeight: '800' }}>{accounts.length} NEW</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-md)' }}>
        {accounts.map((acc) => (
          <div key={acc.player_tag} style={{ padding: 'var(--space-md)', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span style={{ fontWeight: '700' }}>{acc.in_game_name}</span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', color: 'var(--color-muted)' }}>{acc.clan.display_name}</span>
              </div>
              <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>{acc.player_tag} • TH{acc.th_level}</p>
            </div>
            <button onClick={() => onLink(acc)} className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.75rem' }}>
              LINK
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
