'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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
      const { data } = await supabase.from('clans').select('*').order('display_order');
      setClans(data || []);
      setLoading(false);
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
