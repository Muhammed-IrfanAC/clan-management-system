'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useSettingsStore } from '@/lib/stores/settingsStore';
import { can } from '@/lib/permissions';
import type { AccessRole } from '@/types/database';
import { DETECTOR_REGISTRY, detectorMeta, defaultConfigFor } from '@/lib/rules/registry';
import type { Confirm } from './types';

// Rules library tab: create/delete rules and wire each to a built-in detector (attach, enable, tune).
export default function RulesTab({ role, onAdd, confirm }: { role: AccessRole | null; onAdd: () => void; confirm: Confirm }) {
  const rules = useSettingsStore((s) => s.rules);
  const togglingRuleId = useSettingsStore((s) => s.togglingRuleId);
  const updateRuleAutomation = useSettingsStore((s) => s.updateRuleAutomation);
  const toggleRuleAutomation = useSettingsStore((s) => s.toggleRuleAutomation);
  const removeRule = useSettingsStore((s) => s.removeRule);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
        <h3>Rules Library</h3>
        <button onClick={onAdd} className="btn btn-primary" style={{ fontSize: '0.75rem' }}><Plus size={16} /> Add Rule</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {rules.map((r) => (
          <div key={r.id} className="card" style={{ background: 'rgba(255,255,255,0.02)', cursor: 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
              <h4 style={{ margin: 0 }}>{r.name}</h4>
              {can(role, 'rules.delete') && (
                <button
                  onClick={() =>
                    confirm({
                      title: 'Delete Rule',
                      message: `Delete rule "${r.name}"? Warnings using this rule will remain but the rule reference will be lost.`,
                      action: () => removeRule(r.id),
                    })
                  }
                  style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <p className="text-muted" style={{ fontSize: '0.85rem' }}>{r.description}</p>

            {/* Automation: attach a built-in detector, toggle it, and tune its params. */}
            <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>Automation</label>
                <select
                  className="input"
                  style={{ maxWidth: '240px' }}
                  value={r.automation_key ?? ''}
                  onChange={(e) => {
                    const key = e.target.value || null;
                    updateRuleAutomation(r.id, {
                      automation_key: key,
                      automation_enabled: false,
                      automation_config: key ? defaultConfigFor(key) : {},
                    });
                  }}
                >
                  <option value="">Manual (no automation)</option>
                  {DETECTOR_REGISTRY.map((d) => (
                    <option key={d.key} value={d.key}>{d.label}</option>
                  ))}
                </select>
                {r.automation_key && (
                  <button
                    onClick={() => toggleRuleAutomation(r.id, !r.automation_enabled)}
                    disabled={togglingRuleId === r.id}
                    className={`btn ${r.automation_enabled ? 'btn-primary' : 'btn-outline'}`}
                    style={{ fontSize: '0.7rem', padding: 'var(--space-xs) var(--space-md)' }}
                  >
                    {r.automation_enabled ? 'ENABLED' : 'DISABLED'}
                  </button>
                )}
              </div>
              {r.automation_key && (() => {
                const meta = detectorMeta(r.automation_key);
                if (!meta) return <p className="text-warning" style={{ fontSize: '0.7rem', marginTop: 'var(--space-sm)' }}>Unknown detector &quot;{r.automation_key}&quot;.</p>;
                return (
                  <>
                    <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)' }}>
                      {meta.description}{meta.mode === 'review' ? ' Queues for leader review.' : ''}
                    </p>
                    {meta.configFields.length > 0 && (
                      <div style={{ display: 'flex', gap: 'var(--space-lg)', flexWrap: 'wrap', marginTop: 'var(--space-sm)' }}>
                        {meta.configFields.map((f) => (
                          <div key={f.key}>
                            <label className="text-muted" style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>{f.label}</label>
                            <input
                              className="input"
                              type={f.type}
                              style={{ width: '130px' }}
                              defaultValue={(r.automation_config?.[f.key] ?? f.default) as string | number}
                              onBlur={(e) => {
                                if (togglingRuleId === r.id) return;
                                const val = f.type === 'number' ? Number(e.target.value) : e.target.value;
                                updateRuleAutomation(r.id, { automation_config: { ...(r.automation_config || {}), [f.key]: val } });
                              }}
                            />
                            {f.help && <p className="text-muted" style={{ fontSize: '0.6rem', margin: '2px 0 0' }}>{f.help}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
