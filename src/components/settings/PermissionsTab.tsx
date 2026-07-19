'use client';

import { useEffect } from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import { useSettingsStore } from '@/lib/stores/settingsStore';
import { CONFIGURABLE_CO_LEADER_CAPS, CAPABILITY_META } from '@/lib/permissions';

// Co-leader permissions editor (super_admin only). Each configurable capability is a toggle whose
// effective state (coded default + saved override) comes from /api/permissions. Leader and
// super_admin stay coded; role.assign_any is deliberately not listed, keeping the single-owner model.
export default function PermissionsTab() {
  const coLeaderCaps = useSettingsStore((s) => s.coLeaderCaps);
  const permsLoading = useSettingsStore((s) => s.permsLoading);
  const savingCap = useSettingsStore((s) => s.savingCap);
  const fetchPermissions = useSettingsStore((s) => s.fetchPermissions);
  const toggleCapability = useSettingsStore((s) => s.toggleCapability);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xs)' }}>
        <ShieldCheck size={20} className="text-cta" />
        <h3 style={{ margin: 0 }}>Co-Leader Permissions</h3>
      </div>
      <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: 'var(--space-lg)' }}>
        Choose what co-leaders can do. Leaders and the super admin keep their fixed access; these
        toggles take effect immediately, no re-login needed.
      </p>

      <div style={{ display: 'flex', gap: 'var(--space-md)', padding: '12px', background: 'rgba(245, 158, 11, 0.05)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-xl)', border: '1px solid rgba(245, 158, 11, 0.1)' }}>
        <AlertCircle size={18} className="text-warning" />
        <p style={{ fontSize: '0.75rem', margin: 0 }}>
          Sensitive powers (managing leadership, assigning roles) let co-leaders change who can access
          the dashboard. Grant them only to trusted co-leaders.
        </p>
      </div>

      {permsLoading ? (
        <p className="text-muted">Loading permissions...</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {CONFIGURABLE_CO_LEADER_CAPS.map((cap) => {
            const meta = CAPABILITY_META[cap];
            const enabled = !!coLeaderCaps[cap];
            const saving = savingCap === cap;
            return (
              <div key={cap} className="setting-row">
                <div style={{ maxWidth: '70%' }}>
                  <p style={{ fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {meta.label}
                    {meta.sensitive && (
                      <span style={{ fontSize: '0.6rem', padding: '1px 6px', background: 'rgba(245, 158, 11, 0.15)', color: 'var(--color-warning)', borderRadius: '10px', fontWeight: '800', textTransform: 'uppercase' }}>Sensitive</span>
                    )}
                  </p>
                  <p className="text-muted" style={{ fontSize: '0.8rem', margin: '2px 0 0' }}>{meta.description}</p>
                </div>
                <button
                  onClick={() => toggleCapability(cap, !enabled)}
                  disabled={saving}
                  className={`btn ${enabled ? 'btn-primary' : 'btn-outline'}`}
                  style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-md)', minWidth: '104px' }}
                >
                  {saving ? 'Saving...' : enabled ? 'ALLOWED' : 'BLOCKED'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
