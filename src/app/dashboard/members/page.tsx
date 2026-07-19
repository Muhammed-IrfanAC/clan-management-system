'use client';

import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useMembersStore, type AccountWithClan } from '@/lib/stores/membersStore';
import { useClan } from '@/lib/ClanContext';
import Toast from '@/components/ui/Toast';
import MemberCard from '@/components/members/MemberCard';
import UnlinkedAccountsPanel from '@/components/members/UnlinkedAccountsPanel';
import LinkAccountModal from '@/components/members/LinkAccountModal';

type FilterType = 'all' | 'babies' | 'permanent' | 'discord_unlinked';

export default function MembersPage() {
  const { selectedClanId } = useClan();

  const members = useMembersStore((s) => s.members);
  const unlinkedAccounts = useMembersStore((s) => s.unlinkedAccounts);
  const babyTrialDays = useMembersStore((s) => s.babyTrialDays);
  const loading = useMembersStore((s) => s.loading);
  const toast = useMembersStore((s) => s.toast);
  const setToast = useMembersStore((s) => s.setToast);
  const fetchData = useMembersStore((s) => s.fetchData);

  // Search, filter, and which account the link modal targets are all UI-local; the store
  // owns the roster, the unlinked queue, and the link mutation.
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [linkingAccount, setLinkingAccount] = useState<AccountWithClan | null>(null);

  useEffect(() => {
    fetchData(selectedClanId);
  }, [selectedClanId, fetchData]);

  // Honour a ?filter=babies shortcut from the dashboard "Current Babies" stat card.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('filter');
    if (f === 'babies' || f === 'permanent' || f === 'all' || f === 'discord_unlinked') setFilterType(f);
  }, []);

  const filteredMembers = members.filter((m) => {
    const matchesSearch =
      m.display_name.toLowerCase().includes(search.toLowerCase()) ||
      m.player_accounts.some((pa) => pa.in_game_name.toLowerCase().includes(search.toLowerCase()) || pa.player_tag.includes(search.toUpperCase()));
    const matchesType =
      filterType === 'all' ? true :
      filterType === 'babies' ? m.is_baby :
      filterType === 'discord_unlinked' ? !m.discord_user_id :
      !m.is_baby;
    return matchesSearch && matchesType;
  });

  const babyCount = members.filter((m) => m.is_baby).length;
  const discordUnlinkedCount = members.filter((m) => !m.discord_user_id).length;

  return (
    <div>
      <div className="responsive-header">
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Member Registry</h1>
          <p className="text-muted">Manage all human persons and their linked Clash accounts.</p>
        </div>

        <div className="header-actions">
          <div className="search-container" style={{ flex: '1 1 auto' }}>
            <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
            <input type="text" className="input search-input" placeholder="Search registry..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input filter-select" value={filterType} onChange={(e) => setFilterType(e.target.value as FilterType)} aria-label="Filter members by status">
            <option value="all">All Members</option>
            <option value="babies">Babies{babyCount ? ` (${babyCount})` : ''}</option>
            <option value="permanent">Permanent</option>
            <option value="discord_unlinked">Discord Unlinked{discordUnlinkedCount ? ` (${discordUnlinkedCount})` : ''}</option>
          </select>
        </div>
      </div>

      <UnlinkedAccountsPanel accounts={unlinkedAccounts} onLink={setLinkingAccount} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {loading ? (
          <p className="text-muted">Loading registry...</p>
        ) : filteredMembers.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
            <p className="text-muted">No records match your filters.</p>
          </div>
        ) : (
          filteredMembers.map((member) => <MemberCard key={member.id} member={member} babyTrialDays={babyTrialDays} />)
        )}
      </div>

      {linkingAccount && <LinkAccountModal account={linkingAccount} onClose={() => setLinkingAccount(null)} />}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
