'use client';

import { useState, useEffect } from 'react';
import { Settings, Shield, Users, RefreshCw, ShieldCheck } from 'lucide-react';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useSettingsStore } from '@/lib/stores/settingsStore';
import Toast from '@/components/ui/Toast';
import GeneralTab from '@/components/settings/GeneralTab';
import ClansTab from '@/components/settings/ClansTab';
import RulesTab from '@/components/settings/RulesTab';
import LeadersTab from '@/components/settings/LeadersTab';
import PermissionsTab from '@/components/settings/PermissionsTab';
import AddClanModal from '@/components/settings/AddClanModal';
import AddRuleModal from '@/components/settings/AddRuleModal';
import AddLeaderModal from '@/components/settings/AddLeaderModal';
import type { ConfirmArgs } from '@/components/settings/types';

type Tab = 'general' | 'clans' | 'rules' | 'leaders' | 'permissions';

export default function SettingsPage() {
  const { role, capabilities } = useCurrentUser();
  // Gating is driven by the actor's EFFECTIVE capabilities (coded defaults + runtime overrides) from
  // /api/auth/me, so it matches what the API allows. Admin tabs need leader-management; configuring
  // co-leader permissions is owner-only (role.assign_any). UI gating is cosmetic — routes enforce.
  const canManage = capabilities.includes('leader.manage');
  const canConfigurePerms = capabilities.includes('role.assign_any');
  const visibleTabs: Tab[] = [
    ...(canManage ? (['general', 'clans', 'rules', 'leaders'] as Tab[]) : (['rules'] as Tab[])),
    ...(canConfigurePerms ? (['permissions'] as Tab[]) : []),
  ];

  const [activeTab, setActiveTab] = useState<Tab>('general');
  // Clamp the selected tab to what the role may see — co-leaders fall through to Rules — without
  // syncing state in an effect. Tab clicks set activeTab; this just guards the rendered value.
  const effectiveTab = visibleTabs.includes(activeTab) ? activeTab : visibleTabs[0];

  const loading = useSettingsStore((s) => s.loading);
  const toast = useSettingsStore((s) => s.toast);
  const setToast = useSettingsStore((s) => s.setToast);
  const fetchData = useSettingsStore((s) => s.fetchData);

  // Which add-modal is open is UI-local; the store owns data + mutations.
  const [showAddClan, setShowAddClan] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddLeader, setShowAddLeader] = useState(false);

  // Confirm-then-mutate orchestration lives here: tabs describe the destructive action, this owns
  // the modal and the single in-flight guard, running the action on confirm.
  const [confirmArgs, setConfirmArgs] = useState<ConfirmArgs | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirm = (args: ConfirmArgs) => setConfirmArgs(args);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleConfirm() {
    if (!confirmArgs || confirming) return;
    setConfirming(true);
    try {
      await confirmArgs.action();
    } finally {
      setConfirming(false);
      setConfirmArgs(null);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-2xl)' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Command Center</h1>
        <p className="text-muted">Global configuration and leadership management.</p>
      </div>

      <div className="settings-grid">
        {/* Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`btn ${effectiveTab === tab ? 'btn-primary' : 'btn-outline'}`}
              style={{ justifyContent: 'flex-start', border: effectiveTab === tab ? '' : 'none' }}
            >
              {tab === 'general' && <Settings size={18} />}
              {tab === 'clans' && <RefreshCw size={18} />}
              {tab === 'rules' && <Shield size={18} />}
              {tab === 'leaders' && <Users size={18} />}
              {tab === 'permissions' && <ShieldCheck size={18} />}
              <span style={{ marginLeft: '10px', textTransform: 'capitalize' }}>{tab}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="card" style={{ minHeight: '600px' }}>
          {loading ? (
            <p className="text-muted">Loading settings...</p>
          ) : (
            <>
              {effectiveTab === 'general' && <GeneralTab />}
              {effectiveTab === 'clans' && <ClansTab onAdd={() => setShowAddClan(true)} confirm={confirm} />}
              {effectiveTab === 'rules' && <RulesTab canDelete={capabilities.includes('rules.delete')} onAdd={() => setShowAddRule(true)} confirm={confirm} />}
              {effectiveTab === 'leaders' && <LeadersTab onAdd={() => setShowAddLeader(true)} confirm={confirm} />}
              {effectiveTab === 'permissions' && <PermissionsTab />}
            </>
          )}
        </div>
      </div>

      {showAddClan && <AddClanModal onClose={() => setShowAddClan(false)} />}
      {showAddRule && <AddRuleModal onClose={() => setShowAddRule(false)} />}
      {showAddLeader && <AddLeaderModal role={role} capabilities={capabilities} onClose={() => setShowAddLeader(false)} />}

      <ConfirmationModal
        isOpen={!!confirmArgs}
        onClose={() => setConfirmArgs(null)}
        onConfirm={handleConfirm}
        title={confirmArgs?.title ?? ''}
        message={confirmArgs?.message ?? ''}
        variant={confirmArgs?.variant ?? 'danger'}
        isLoading={confirming}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
