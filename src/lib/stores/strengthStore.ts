/**
 * Zustand store for the Strength page (`/dashboard/strength`): the family ranking from
 * `/api/views/strength` (server truth, read-only — the page has no mutations) plus its transient UI
 * state, the search box and the table's sort.
 */
import { create } from 'zustand';
import type { FamilyStrengthAccount, SkillCuts } from '@/lib/cwl/familyStrength';

export type StrengthSortKey = 'rank' | 'name' | 'clan' | 'th' | 'mirror' | 'triples' | 'cwlTriples' | 'form';

type StrengthState = {
  accounts: FamilyStrengthAccount[];
  cuts: SkillCuts | null;
  loading: boolean;
  error: string | null;
  search: string;
  sort: { key: StrengthSortKey; desc: boolean };

  fetchAll: () => Promise<void>;
  setSearch: (search: string) => void;
  /** Sort by a column; the same column again flips the direction. */
  sortBy: (key: StrengthSortKey) => void;
};

/** The direction a column sorts in first: best first for the numbers, A–Z for the names. */
const DESC_FIRST: Record<StrengthSortKey, boolean> = {
  rank: false, name: false, clan: false, th: true, mirror: true, triples: true, cwlTriples: true, form: true,
};

export const useStrengthStore = create<StrengthState>((set, get) => ({
  accounts: [],
  cuts: null,
  loading: true,
  error: null,
  search: '',
  sort: { key: 'rank', desc: false },

  async fetchAll() {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/views/strength');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load strength');
      set({ accounts: body.accounts ?? [], cuts: body.cuts ?? null, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load strength' });
    }
  },

  setSearch: (search) => set({ search }),

  sortBy(key) {
    const { sort } = get();
    set({ sort: sort.key === key ? { key, desc: !sort.desc } : { key, desc: DESC_FIRST[key] } });
  },
}));
