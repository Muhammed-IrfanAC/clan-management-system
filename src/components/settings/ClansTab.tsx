'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useSettingsStore } from '@/lib/stores/settingsStore';
import type { RuleAutomationMode } from '@/types/database';
import type { Confirm } from './types';

// Clan family tab: register/remove family clans and set each clan's rule-automation scope.
export default function ClansTab({ onAdd, confirm }: { onAdd: () => void; confirm: Confirm }) {
  const clans = useSettingsStore((s) => s.clans);
  const updateClanAutomation = useSettingsStore((s) => s.updateClanAutomation);
  const removeClan = useSettingsStore((s) => s.removeClan);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
        <h3>Clan Family</h3>
        <button onClick={onAdd} className="btn btn-primary" style={{ fontSize: '0.75rem' }}><Plus size={16} /> Add Clan</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {clans.map((c) => (
          <div key={c.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: '700' }}>{c.display_name}</span>
              <span className="text-muted" style={{ marginLeft: 'var(--space-md)' }}>{c.clan_tag}</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textTransform: 'uppercase' }}>{c.clan_type}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.7rem', color: 'var(--color-muted)' }} title="When the rule detectors act on this clan's wars">
                <span style={{ textTransform: 'uppercase' }}>Automation</span>
                <select
                  className="input"
                  value={c.rule_automation_mode ?? 'always'}
                  onChange={(e) => updateClanAutomation(c.id, e.target.value as RuleAutomationMode)}
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
                  aria-label={`Rule automation for ${c.display_name}`}
                >
                  <option value="always">Always</option>
                  <option value="cwl_only">CWL only</option>
                  <option value="never">Never</option>
                </select>
              </label>
              <button
                onClick={() =>
                  confirm({
                    title: 'Remove Clan',
                    message: `Permanently remove ${c.display_name}? Accounts will remain but lose clan affiliation.`,
                    action: () => removeClan(c.id),
                  })
                }
                style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
