'use client';

import { Plus } from 'lucide-react';
import { useSettingsStore } from '@/lib/stores/settingsStore';
import type { AccessRole } from '@/types/database';
import type { Confirm } from './types';

const ROLE_LABELS: Record<AccessRole, string> = {
  super_admin: 'Super Admin',
  leader: 'Leader',
  co_leader: 'Co-Leader',
};

// Authorized leadership tab: grant dashboard access to a member or revoke it. Access is a
// person-level grant, so revoking blocks every account linked to them. The super_admin can't be
// revoked here — that stays a direct-DB action to keep the single-owner model intact.
export default function LeadersTab({ onAdd, confirm }: { onAdd: () => void; confirm: Confirm }) {
  const leaders = useSettingsStore((s) => s.leaders);
  const revokeLeader = useSettingsStore((s) => s.revokeLeader);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
        <h3>Authorized Leadership</h3>
        <button onClick={onAdd} className="btn btn-primary" style={{ fontSize: '0.75rem' }}><Plus size={16} /> Add Leader</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {leaders.map((l) => (
          <div key={l.person_id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-cta)' }}></div>
              <div>
                <p style={{ fontWeight: '700', margin: 0 }}>{l.display_name}</p>
                <p className="text-muted" style={{ fontSize: '0.7rem', margin: 0 }}>{ROLE_LABELS[l.access_role].toUpperCase()} • all linked accounts</p>
              </div>
            </div>
            {l.access_role !== 'super_admin' && (
              <button
                onClick={() =>
                  confirm({
                    title: 'Revoke Access',
                    message: `Instantly block ${l.display_name} from the dashboard? Access is revoked for every account linked to them. They remain in the registry as a regular member.`,
                    variant: 'warning',
                    action: () => revokeLeader(l.player_tag),
                  })
                }
                className="btn btn-outline"
                style={{ border: 'none', color: 'var(--color-danger)', fontSize: '0.7rem' }}
              >
                REVOKE ACCESS
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
