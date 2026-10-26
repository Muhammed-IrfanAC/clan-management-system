'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Clan } from '@/types/database';

interface ClanContextType {
  selectedClanId: string;
  setSelectedClanId: (id: string) => void;
  clans: Clan[];
  loading: boolean;
}

const ClanContext = createContext<ClanContextType | undefined>(undefined);

export function ClanProvider({ children }: { children: React.ReactNode }) {
  const [selectedClanId, setSelectedClanId] = useState<string>('all');
  const [clans, setClans] = useState<Clan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchClans() {
      try {
        const res = await fetch('/api/clans');
        const data = res.ok ? await res.json() : [];
        setClans(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error loading clans:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchClans();
  }, []);

  return (
    <ClanContext.Provider value={{ selectedClanId, setSelectedClanId, clans, loading }}>
      {children}
    </ClanContext.Provider>
  );
}

export function useClan() {
  const context = useContext(ClanContext);
  if (context === undefined) {
    throw new Error('useClan must be used within a ClanProvider');
  }
  return context;
}
