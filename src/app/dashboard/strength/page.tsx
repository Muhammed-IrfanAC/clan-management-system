'use client';

import { useEffect } from 'react';
import { Search } from 'lucide-react';
import { useStrengthStore } from '@/lib/stores/strengthStore';
import TierLegend from '@/components/strength/TierLegend';
import StrengthTable from '@/components/strength/StrengthTable';

/**
 * Every active family account ranked by the attack model. The header's clan switcher filters the
 * list; ranks and labels stay family-wide, since "goat" means one of the family's top five.
 */
export default function StrengthPage() {
  const loading = useStrengthStore((s) => s.loading);
  const error = useStrengthStore((s) => s.error);
  const search = useStrengthStore((s) => s.search);
  const setSearch = useStrengthStore((s) => s.setSearch);
  const fetchAll = useStrengthStore((s) => s.fetchAll);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div>
      <div className="responsive-header">
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Strength</h1>
          <p className="text-muted" style={{ maxWidth: 760 }}>
            Every account in the family, ranked by how well it attacks for its town hall: its Ranked league, adjusted by its war record with us.
          </p>
        </div>
        <div className="header-actions">
          <div className="search-container" style={{ flex: '1 1 auto' }}>
            <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
            <input type="text" className="input search-input" placeholder="Search accounts..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading strength...</p>
      ) : error ? (
        <div className="card" style={{ padding: 'var(--space-md)', color: 'var(--color-danger)' }}>{error}</div>
      ) : (
        <>
          <TierLegend />
          <StrengthTable />
        </>
      )}
    </div>
  );
}
