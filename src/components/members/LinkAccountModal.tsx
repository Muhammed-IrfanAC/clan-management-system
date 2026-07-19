'use client';

import { useState } from 'react';
import { Search, X, Check, Baby } from 'lucide-react';
import { useMembersStore, type AccountWithClan } from '@/lib/stores/membersStore';

// Assigns an unlinked account to a person — either an existing entry (alt link) or a brand-new
// person (optionally a baby with an opening note). Form state is local; the person list, the
// trial-window copy, the linking guard, and the link action all come from the store. On success
// the store splices the result in and this modal closes.
export default function LinkAccountModal({ account, onClose }: { account: AccountWithClan; onClose: () => void }) {
  const members = useMembersStore((s) => s.members);
  const babyTrialDays = useMembersStore((s) => s.babyTrialDays);
  const linking = useMembersStore((s) => s.linking);
  const linkAccount = useMembersStore((s) => s.linkAccount);

  const [tab, setTab] = useState<'existing' | 'new'>('existing');
  const [linkSearch, setLinkSearch] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [newPersonName, setNewPersonName] = useState(account.in_game_name);
  const [newPersonIsBaby, setNewPersonIsBaby] = useState(false);
  const [newPersonComment, setNewPersonComment] = useState('');

  const linkablePersons = members.filter((m) => m.display_name.toLowerCase().includes(linkSearch.toLowerCase()));

  const canSubmit = tab === 'existing' ? !!selectedPersonId : !!newPersonName;

  async function handleSubmit() {
    if (!canSubmit) return;
    const ok = await linkAccount({
      playerTag: account.player_tag,
      personId: tab === 'existing' ? selectedPersonId : null,
      newPersonName: tab === 'new' ? newPersonName : null,
      isBaby: tab === 'new' ? newPersonIsBaby : false,
      comment: tab === 'new' && newPersonIsBaby ? newPersonComment : null,
    });
    if (ok) onClose();
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ padding: 0 }}>
        {/* Header */}
        <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Assign Identity</h2>
            <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>Linking account {account.in_game_name} ({account.player_tag})</p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: 'var(--color-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex' }}>
          <button onClick={() => setTab('existing')} className={`tab-btn ${tab === 'existing' ? 'active' : ''}`}>Link to Existing</button>
          <button onClick={() => setTab('new')} className={`tab-btn ${tab === 'new' ? 'active' : ''}`}>Create New Entry</button>
        </div>

        {/* Content */}
        <div style={{ padding: 'var(--space-lg)' }}>
          {tab === 'existing' ? (
            <div>
              <div style={{ position: 'relative', marginBottom: 'var(--space-md)' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
                <input type="text" className="input" placeholder="Find human entry..." style={{ paddingLeft: '2.5rem', fontSize: '0.85rem' }} value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} />
              </div>

              <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {linkablePersons.map((p) => (
                  <div key={p.id} className={`search-item ${selectedPersonId === p.id ? 'selected' : ''}`} onClick={() => setSelectedPersonId(p.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{p.display_name}</span>
                      {selectedPersonId === p.id && <Check size={16} color="var(--color-cta)" />}
                    </div>
                    <p className="text-muted" style={{ fontSize: '0.7rem', margin: '4px 0 0' }}>{p.player_accounts.length} linked accounts</p>
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
              <input type="text" className="input" placeholder="Known human name..." value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} />
              <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 'var(--space-md)' }}>
                This creates a new &quot;Human&quot; record. You can link other alts to this name later.
              </p>

              <label className="switch-row" style={{ marginTop: 'var(--space-lg)' }}>
                <span className="switch" data-on={newPersonIsBaby}>
                  <input type="checkbox" checked={newPersonIsBaby} onChange={(e) => setNewPersonIsBaby(e.target.checked)} />
                  <span className="switch-knob" />
                </span>
                <span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600', fontSize: '0.85rem' }}>
                    <Baby size={15} className="text-warning" /> Mark as Baby
                  </span>
                  <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                    Starts a {babyTrialDays}-day trial. Promote before it ends or the link is auto-removed.
                  </span>
                </span>
              </label>

              {newPersonIsBaby && (
                <div style={{ marginTop: 'var(--space-md)' }}>
                  <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '8px' }}>Initial Note <span style={{ textTransform: 'none', fontWeight: '400' }}>(optional)</span></label>
                  <textarea className="input" rows={3} placeholder="Why are we trialing them? Anything to watch during the trial..." value={newPersonComment} onChange={(e) => setNewPersonComment(e.target.value)} style={{ resize: 'vertical' }} />
                  <p className="text-muted" style={{ fontSize: '0.72rem', marginTop: '6px' }}>
                    Starts the comment thread. You and other leaders can add more notes during the trial.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: 'var(--space-lg)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)' }}>
          <button className="btn btn-outline" style={{ border: 'none' }} onClick={onClose} disabled={linking}>Cancel</button>
          <button className="btn btn-primary" disabled={linking || !canSubmit} onClick={handleSubmit} style={{ minWidth: '140px' }}>
            {linking ? 'Assigning...' : 'Complete Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
