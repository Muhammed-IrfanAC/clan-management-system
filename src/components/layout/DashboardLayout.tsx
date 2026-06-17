'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  AlertTriangle, 
  History, 
  Settings, 
  LogOut,
  ChevronDown,
  RefreshCw
} from 'lucide-react';
import { useClan } from '@/lib/ClanContext';
import { supabase } from '@/lib/supabase';

interface SidebarItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}

const SidebarItem = ({ href, icon, label, active }: SidebarItemProps) => (
  <Link 
    href={href} 
    className={`sidebar-item ${active ? 'active' : ''}`}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-md)',
      padding: '0.875rem 1.25rem',
      borderRadius: 'var(--radius-md)',
      color: active ? 'var(--color-cta)' : 'var(--color-muted)',
      background: active ? 'rgba(34, 197, 94, 0.05)' : 'transparent',
      fontWeight: active ? '600' : '400',
      transition: 'all 200ms ease',
      marginBottom: 'var(--space-xs)',
      borderLeft: active ? '3px solid var(--color-cta)' : '3px solid transparent'
    }}
  >
    {icon}
    <span style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
  </Link>
);

const SyncButton = () => {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
    } catch (e) {
      console.error('Sync failed', e);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <RefreshCw 
      size={14} 
      className={`text-muted ${syncing ? 'animate-spin' : ''}`} 
      style={{ cursor: 'pointer' }} 
      onClick={handleSync}
    />
  );
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { selectedClanId, setSelectedClanId, clans } = useClan();
  const [showClanDropdown, setShowClanDropdown] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch (e) {
        console.error('Error fetching user:', e);
      }
    }
    fetchUser();
  }, []);

  const selectedClan = clans.find(c => c.id === selectedClanId);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-background)' }}>
      {/* Sidebar */}
      <aside style={{ 
        width: '280px', 
        borderRight: '1px solid rgba(255,255,255,0.05)', 
        display: 'flex', 
        flexDirection: 'column',
        padding: 'var(--space-lg)',
        position: 'fixed',
        height: '100vh',
        zIndex: 50,
        background: 'rgba(2, 6, 23, 0.8)',
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ marginBottom: 'var(--space-2xl)', paddingLeft: 'var(--space-sm)' }}>
          <h2 className="glow-text" style={{ fontSize: '1.5rem', margin: 0 }}>ClanOps</h2>
          <p className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Leadership Dashboard</p>
        </div>

        <nav style={{ flex: 1 }}>
          <SidebarItem href="/dashboard" icon={<LayoutDashboard size={20} />} label="Overview" active={pathname === '/dashboard'} />
          <SidebarItem href="/dashboard/members" icon={<Users size={20} />} label="Members" active={pathname === '/dashboard/members'} />
          <SidebarItem href="/dashboard/warnings" icon={<AlertTriangle size={20} />} label="Warnings" active={pathname === '/dashboard/warnings'} />
          <SidebarItem href="/dashboard/activity" icon={<History size={20} />} label="Activity Log" active={pathname === '/dashboard/activity'} />
          <SidebarItem href="/dashboard/settings" icon={<Settings size={20} />} label="Settings" active={pathname === '/dashboard/settings'} />
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 'var(--space-lg)' }}>
          <button 
            className="btn btn-outline" 
            style={{ width: '100%', justifyContent: 'flex-start', border: 'none', color: 'var(--color-danger)' }}
            onClick={() => {
              document.cookie = 'clanops-auth=; Max-Age=0; path=/;';
              window.location.href = '/login';
            }}
          >
            <LogOut size={20} />
            <span style={{ fontSize: '0.9rem', textTransform: 'uppercase' }}>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ marginLeft: '280px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Top Header */}
        <header style={{ 
          height: '70px', 
          borderBottom: '1px solid rgba(255,255,255,0.05)', 
          padding: '0 var(--space-xl)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          background: 'rgba(2, 6, 23, 0.8)',
          backdropFilter: 'blur(10px)',
          zIndex: 40
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xl)' }}>
            <div style={{ position: 'relative' }}>
              <div 
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}
                onClick={() => setShowClanDropdown(!showClanDropdown)}
              >
                <span style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase' }}>
                  {selectedClanId === 'all' ? 'All Clans' : selectedClan?.display_name}
                </span>
                <ChevronDown size={16} color="var(--color-muted)" />
              </div>

              {showClanDropdown && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 'var(--space-sm)',
                  background: 'var(--color-secondary)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  width: '200px',
                  zIndex: 60
                }}>
                  <div 
                    style={{ padding: 'var(--space-sm) var(--space-md)', cursor: 'pointer', fontSize: '0.8rem', background: selectedClanId === 'all' ? 'rgba(34, 197, 94, 0.1)' : 'transparent' }}
                    onClick={() => { setSelectedClanId('all'); setShowClanDropdown(false); }}
                  >
                    All Clans
                  </div>
                  {clans.map(clan => (
                    <div 
                      key={clan.id} 
                      style={{ padding: 'var(--space-sm) var(--space-md)', cursor: 'pointer', fontSize: '0.8rem', background: selectedClanId === clan.id ? 'rgba(34, 197, 94, 0.1)' : 'transparent' }}
                      onClick={() => { setSelectedClanId(clan.id); setShowClanDropdown(false); }}
                    >
                      {clan.display_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.75rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-cta)' }}></div>
              <span className="text-muted">Auto-sync enabled</span>
              <SyncButton />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
             <div style={{ textAlign: 'right' }}>
               <p style={{ fontSize: '0.85rem', fontWeight: '600', margin: 0 }}>{user?.in_game_name || 'Leader'}</p>
               <p style={{ fontSize: '0.65rem', color: 'var(--color-muted)', margin: 0, textTransform: 'uppercase' }}>{user?.db_role?.replace('_', ' ') || 'Super Admin'}</p>
             </div>
             <div style={{ 
               width: '36px', 
               height: '36px', 
               borderRadius: 'var(--radius-md)', 
               background: 'var(--color-secondary)',
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'center',
               border: '1px solid rgba(255,255,255,0.1)'
             }}>
               <Users size={18} />
             </div>
          </div>
        </header>

        {/* Page Body */}
        <div style={{ padding: 'var(--space-xl)', maxWidth: '1400px', width: '100%', margin: '0 auto' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
