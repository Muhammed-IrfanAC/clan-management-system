'use client';

import { useSettingsStore } from '@/lib/stores/settingsStore';

// System defaults tab. Renders whatever settings rows exist in the DB generically — booleans as a
// toggle, everything else as a number input — so pruning or seeding a key in a migration is all it
// takes to change what shows here.
export default function GeneralTab() {
  const appSettings = useSettingsStore((s) => s.appSettings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  return (
    <div>
      <h3>System Settings</h3>
      <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: 'var(--space-xl)' }}>
        Configure automated behaviors and system defaults.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
        {appSettings.map((s) => (
          <div key={s.key} className="setting-row">
            <div>
              <p style={{ fontWeight: '700', margin: 0 }}>{s.key.replace(/_/g, ' ').toUpperCase()}</p>
              <p className="text-muted" style={{ fontSize: '0.8rem', margin: 0 }}>{s.description}</p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
              {typeof s.value === 'boolean' ? (
                <button
                  onClick={() => updateSetting(s.key, !s.value)}
                  className={`btn ${s.value ? 'btn-primary' : 'btn-outline'}`}
                  style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-md)' }}
                >
                  {s.value ? 'ENABLED' : 'DISABLED'}
                </button>
              ) : (
                <input
                  type="number"
                  className="input"
                  style={{ width: '80px', textAlign: 'center' }}
                  value={s.value}
                  onChange={(e) => updateSetting(s.key, parseInt(e.target.value))}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
