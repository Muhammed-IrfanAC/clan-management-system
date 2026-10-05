'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useKickListStore } from '@/lib/stores/kickListStore';
import Toast from '@/components/ui/Toast';
import KickedPresenceBanner from '@/components/kicks/KickedPresenceBanner';
import AddKickForm from '@/components/kicks/AddKickForm';
import RecentDepartures from '@/components/kicks/RecentDepartures';
import KickEntryCard from '@/components/kicks/KickEntryCard';

// The kick list is family-wide by nature — the whole point is catching a player who moved to a
// different clan — so it ignores the header's clan switcher.
export default function KickListPage() {
  const entries = useKickListStore((s) => s.entries);
  const loading = useKickListStore((s) => s.loading);
  const toast = useKickListStore((s) => s.toast);
  const setToast = useKickListStore((s) => s.setToast);
  const fetchAll = useKickListStore((s) => s.fetchAll);

  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) =>
        [e.name, e.tag, e.personName ?? '', e.comment ?? '', ...e.alts.flatMap((a) => [a.name, a.tag])].some((s) => s.toLowerCase().includes(q)),
      )
    : entries;

  return (
    <div>
      <div className="responsive-header">
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Kick List</h1>
          <p className="text-muted">
            Accounts leadership kicked. If one of them — or another account linked to the same person — joins any family clan, leadership gets a Discord alert.
          </p>
        </div>
        <div className="header-actions">
          <div className="search-container" style={{ flex: '1 1 auto' }}>
            <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
            <input type="text" className="input search-input" placeholder="Search kick list..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <KickedPresenceBanner />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-2xl)' }}>
        <AddKickForm />
        <RecentDepartures />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {loading ? (
          <p className="text-muted">Loading kick list...</p>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
            <p className="text-muted">{entries.length === 0 ? 'Nobody is on the kick list.' : 'No entries match your search.'}</p>
          </div>
        ) : (
          filtered.map((entry) => <KickEntryCard key={entry.tag} entry={entry} />)
        )}
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
