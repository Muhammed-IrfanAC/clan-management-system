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
  RefreshCw,
  Menu,
  X,
  User
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
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setIsSidebarOpen(false);
    setShowUserMenu(false);
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore — redirect regardless
    }
    window.location.href = '/login';
  };

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
    <div className="dashboard-container">
      {/* Sidebar Overlay Backdrop for Mobile */}
      <div 
        className={`sidebar-overlay ${isSidebarOpen ? 'open' : ''}`} 
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`dashboard-sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div style={{ marginBottom: 'var(--space-2xl)', paddingLeft: 'var(--space-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="glow-text" style={{ fontSize: '1.5rem', margin: 0 }}>ClanOps</h2>
            <p className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Leadership Dashboard</p>
          </div>
          <button 
            className="sidebar-toggle" 
            style={{ margin: 0, padding: '0.25rem' }} 
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <nav style={{ flex: 1 }}>
          <SidebarItem href="/dashboard" icon={<LayoutDashboard size={20} />} label="Overview" active={pathname === '/dashboard'} />
          <SidebarItem href="/dashboard/members" icon={<Users size={20} />} label="Members" active={pathname === '/dashboard/members'} />
          <SidebarItem href="/dashboard/warnings" icon={<AlertTriangle size={20} />} label="Warnings" active={pathname === '/dashboard/warnings'} />
          <SidebarItem href="/dashboard/activity" icon={<History size={20} />} label="Activity Log" active={pathname === '/dashboard/activity'} />
          <SidebarItem href="/dashboard/settings" icon={<Settings size={20} />} label="Settings" active={pathname === '/dashboard/settings'} />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="dashboard-main">
        {/* Top Header */}
        <header className="dashboard-header">
          <div className="header-left">
            <button 
              className="sidebar-toggle" 
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu size={24} />
            </button>

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
              <span className="text-muted sync-text">Auto-sync enabled</span>
              <SyncButton />
            </div>
          </div>

          <div style={{ position: 'relative' }}>
             <div
               style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', cursor: 'pointer' }}
               onClick={() => setShowUserMenu(!showUserMenu)}
             >
               <div className="user-info-text">
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

             {showUserMenu && (
               <>
               <div
                 onClick={() => setShowUserMenu(false)}
                 style={{ position: 'fixed', inset: 0, zIndex: 50 }}
               />
               <div style={{
                 position: 'absolute',
                 top: '100%',
                 right: 0,
                 marginTop: 'var(--space-sm)',
                 background: 'var(--color-secondary)',
                 border: '1px solid rgba(255,255,255,0.1)',
                 borderRadius: 'var(--radius-md)',
                 boxShadow: 'var(--shadow-lg)',
                 width: '200px',
                 zIndex: 60,
                 overflow: 'hidden'
               }}>
                 {user?.person_id && (
                   <Link
                     href={`/dashboard/members/${user.person_id}`}
                     onClick={() => setShowUserMenu(false)}
                     style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.85rem', color: 'var(--color-text)' }}
                   >
                     <User size={16} />
                     <span>Profile</span>
                   </Link>
                 )}
                 <button
                   onClick={() => { setShowUserMenu(false); handleLogout(); }}
                   style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', width: '100%', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.85rem', color: 'var(--color-danger)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                 >
                   <LogOut size={16} />
                   <span>Sign Out</span>
                 </button>
               </div>
               </>
             )}
          </div>
        </header>

        {/* Page Body */}
        <div className="dashboard-body">
          {children}
        </div>
      </main>
    </div>
  );
}
