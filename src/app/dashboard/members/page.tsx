'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { 
  Search, 
  Filter, 
  UserPlus, 
  Link as LinkIcon, 
  ExternalLink,
  X,
  User,
  Check,
  ChevronRight
} from 'lucide-react';
import { Person, PlayerAccount, Clan } from '@/types/database';
import { useClan } from '@/lib/ClanContext';

type PersonWithAccounts = Person & {
  player_accounts: (PlayerAccount & { clan: Clan })[];
};

export default function MembersPage() {
  const { selectedClanId } = useClan();
  const [members, setMembers] = useState<PersonWithAccounts[]>([]);
  const [unlinkedAccounts, setUnlinkedAccounts] = useState<(PlayerAccount & { clan: Clan })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Linking Modal State
  const [linkingAccount, setLinkingAccount] = useState<(PlayerAccount & { clan: Clan }) | null>(null);
  const [linkTab, setLinkTab] = useState<'existing' | 'new'>('existing');
  const [linkSearch, setLinkSearch] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [newPersonName, setNewPersonName] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  useEffect(() => {
    fetchData();
  }, [selectedClanId]);

  async function fetchData() {
    setLoading(true);
    try {
      // Fetch persons with their accounts
      const { data: personsData } = await supabase
        .from('persons')
        .select(`
          *,
          player_accounts!inner (
            *,
            clan:clans (*)
          )
        `)
        .order('display_name');
      
      let filteredPersons = personsData as PersonWithAccounts[] || [];
      if (selectedClanId !== 'all') {
          filteredPersons = filteredPersons.filter(p => p.player_accounts.some(acc => acc.clan_id === selectedClanId));
      }

      setMembers(filteredPersons);

      // Fetch unlinked accounts
      let unlinkedReq = supabase
        .from('player_accounts')
        .select('*, clan:clans (*)')
        .is('person_id', null)
        .eq('status', 'active');
      if (selectedClanId !== 'all') unlinkedReq = unlinkedReq.eq('clan_id', selectedClanId);
      const { data: unlinkedData } = await unlinkedReq;

      setUnlinkedAccounts(unlinkedData as (PlayerAccount & { clan: Clan })[] || []);
    } catch (err) {
      console.error('Error fetching members:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleOpenLinkModal = (account: PlayerAccount & { clan: Clan }) => {
    setLinkingAccount(account);
    setLinkTab('existing');
    setLinkSearch('');
    setSelectedPersonId(null);
    setNewPersonName(account.in_game_name);
  };

  const handleLinkSubmit = async () => {
    if (!linkingAccount) return;
    if (linkTab === 'existing' && !selectedPersonId) return;
    if (linkTab === 'new' && !newPersonName) return;

    setIsLinking(true);
    try {
      const res = await fetch('/api/members/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          playerTag: linkingAccount.player_tag, 
          personId: linkTab === 'existing' ? selectedPersonId : null, 
          newPersonName: linkTab === 'new' ? newPersonName : null 
        }),
      });

      if (!res.ok) throw new Error('Failed to link');
      
      setLinkingAccount(null);
      fetchData();
    } catch (err) {
      alert('Error linking account');
    } finally {
      setIsLinking(false);
    }
  };

  const filteredMembers = members.filter(m => {
    const matchesSearch = m.display_name.toLowerCase().includes(search.toLowerCase()) ||
      m.player_accounts.some(pa => pa.in_game_name.toLowerCase().includes(search.toLowerCase()) || pa.player_tag.includes(search.toUpperCase()));
    return matchesSearch;
  });

  const linkablePersons = members.filter(m => 
    m.display_name.toLowerCase().includes(linkSearch.toLowerCase())
  );

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-2xl)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Member Registry</h1>
          <p className="text-muted">Manage all human persons and their linked Clash accounts.</p>
        </div>
        
        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
           <div style={{ position: 'relative' }}>
             <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
             <input 
               type="text" 
               className="input" 
               placeholder="Search registry..." 
               style={{ paddingLeft: '2.8rem', width: '300px' }}
               value={search}
               onChange={(e) => setSearch(e.target.value)}
             />
           </div>
        </div>
      </div>

      {/* Unlinked Accounts Panel */}
      {unlinkedAccounts.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-2xl)', border: '1px solid rgba(34, 197, 94, 0.2)', background: 'rgba(34, 197, 94, 0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
            <div style={{ padding: '8px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: 'var(--radius-md)' }}>
              <UserPlus className="text-cta" size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Roster Review Required</h3>
            <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--color-cta)', color: '#000', borderRadius: '10px', fontWeight: '800' }}>{unlinkedAccounts.length} NEW</span>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-md)' }}>
             {unlinkedAccounts.map(acc => (
               <div key={acc.player_tag} style={{ 
                 padding: 'var(--space-md)', 
                 background: 'var(--color-background)', 
                 borderRadius: 'var(--radius-md)',
                 border: '1px solid rgba(255,255,255,0.05)',
                 display: 'flex',
                 justifyContent: 'space-between',
                 alignItems: 'center'
               }}>
                 <div>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                     <span style={{ fontWeight: '700' }}>{acc.in_game_name}</span>
                     <span style={{ fontSize: '0.65rem', padding: '1px 5px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', color: 'var(--color-muted)' }}>{acc.clan.display_name}</span>
                   </div>
                   <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>{acc.player_tag} • TH{acc.th_level}</p>
                 </div>
                 <button 
                  onClick={() => handleOpenLinkModal(acc)}
                  className="btn btn-primary"
                  style={{ padding: '0.5rem 1rem', fontSize: '0.75rem' }}
                 >
                  LINK
                 </button>
               </div>
             ))}
          </div>
        </div>
      )}

      {/* Members Registry */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {loading ? (
          <p className="text-muted">Loading registry...</p>
        ) : filteredMembers.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
            <p className="text-muted">No records match your filters.</p>
          </div>
        ) : (
          filteredMembers.map(member => (
            <div key={member.id} className="card" style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: 'var(--radius-md)', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <User size={24} color="var(--color-muted)" />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, marginBottom: '4px' }}>{member.display_name}</h3>
                    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                      {member.player_accounts.map(acc => (
                        <span key={acc.player_tag} style={{ 
                          fontSize: '0.7rem', 
                          padding: '2px 8px', 
                          background: 'rgba(255,255,255,0.05)', 
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: acc.status === 'active' ? 'var(--color-cta)' : 'var(--color-muted)' }}></span>
                          {acc.in_game_name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                
                <Link href={`/dashboard/members/${member.id}`} className="btn btn-outline" style={{ padding: '0.6rem 1rem', fontSize: '0.8rem' }}>
                  Open Dossier <ChevronRight size={16} />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Linking Modal (unchanged) ... */}
      {linkingAccount && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: 0 }}>
             {/* Header */}
             <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <div>
                 <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Assign Identity</h2>
                 <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>Linking account {linkingAccount.in_game_name} ({linkingAccount.player_tag})</p>
               </div>
               <button onClick={() => setLinkingAccount(null)} style={{ background: 'transparent', color: 'var(--color-muted)' }}>
                 <X size={20} />
               </button>
             </div>

             {/* Tabs */}
             <div style={{ display: 'flex' }}>
               <button 
                 onClick={() => setLinkTab('existing')} 
                 className={`tab-btn ${linkTab === 'existing' ? 'active' : ''}`}
               >
                 Link to Existing
               </button>
               <button 
                 onClick={() => setLinkTab('new')} 
                 className={`tab-btn ${linkTab === 'new' ? 'active' : ''}`}
               >
                 Create New Entry
               </button>
             </div>

             {/* Content */}
             <div style={{ padding: 'var(--space-lg)' }}>
               {linkTab === 'existing' ? (
                 <div>
                   <div style={{ position: 'relative', marginBottom: 'var(--space-md)' }}>
                     <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
                     <input 
                       type="text" 
                       className="input" 
                       placeholder="Find human entry..." 
                       style={{ paddingLeft: '2.5rem', fontSize: '0.85rem' }}
                       value={linkSearch}
                       onChange={(e) => setLinkSearch(e.target.value)}
                     />
                   </div>
                   
                   <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                     {linkablePersons.map(p => (
                       <div 
                         key={p.id} 
                         className={`search-item ${selectedPersonId === p.id ? 'selected' : ''}`}
                         onClick={() => setSelectedPersonId(p.id)}
                       >
                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{p.display_name}</span>
                            {selectedPersonId === p.id && <Check size={16} color="var(--color-cta)" />}
                         </div>
                         <p className="text-muted" style={{ fontSize: '0.7rem', margin: '4px 0 0' }}>
                           {p.player_accounts.length} linked accounts
                         </p>
                       </div>
                     ))}
                     {linkablePersons.length === 0 && (
                       <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-xl)', fontSize: '0.85rem' }}>No matching persons found.</p>
                     )}
                   </div>
                 </div>
               ) : (
                 <div>
                   <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '8px' }}>Display Name</label>
                   <input 
                     type="text" 
                     className="input" 
                     placeholder="Known human name..." 
                     value={newPersonName}
                     onChange={(e) => setNewPersonName(e.target.value)}
                   />
                   <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 'var(--space-md)' }}>
                     This creates a new "Human" record. You can link other alts to this name later.
                   </p>
                 </div>
               )}
             </div>

             {/* Footer */}
             <div style={{ padding: 'var(--space-lg)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)' }}>
               <button 
                 className="btn btn-outline" 
                 style={{ border: 'none' }}
                 onClick={() => setLinkingAccount(null)}
                 disabled={isLinking}
               >
                 Cancel
               </button>
               <button 
                 className="btn btn-primary" 
                 disabled={isLinking || (linkTab === 'existing' && !selectedPersonId) || (linkTab === 'new' && !newPersonName)}
                 onClick={handleLinkSubmit}
                 style={{ minWidth: '140px' }}
               >
                 {isLinking ? 'Assigning...' : 'Complete Link'}
               </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
