'use client';

import { History } from 'lucide-react';
import { useMemberDossierStore } from '@/lib/stores/memberDossierStore';

// Read-only list of leadership activity logs tied to this person.
export default function ActivityHistory() {
  const logs = useMemberDossierStore((s) => s.person?.activity_logs ?? []);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <History size={20} color="var(--color-cta)" />
        <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Leadership Activity</h2>
      </div>
      {logs.length === 0 ? (
        <p className="text-muted" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>No related activity logs.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {logs.map((log) => (
            <div key={log.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                <span style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.7rem', color: 'var(--color-cta)' }}>{log.category}</span>
                <span style={{ fontSize: '0.7rem' }} className="text-muted">{new Date(log.logged_at).toLocaleDateString()}</span>
              </div>
              <p style={{ fontSize: '0.85rem', margin: '4px 0' }}>{log.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
