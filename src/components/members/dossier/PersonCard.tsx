'use client';

import { useState } from 'react';
import { User, Baby, Clock, AtSign, CheckCircle, Link as LinkIcon, Trash2 } from 'lucide-react';
import { useMemberDossierStore } from '@/lib/stores/memberDossierStore';
import { babyDaysLeft } from '@/lib/babies';

// Left column of the dossier: identity, baby badge, Discord-link editor, and linked accounts.
// Destructive actions are delegated up (the confirm modal and any navigation live in the page).
export default function PersonCard({
  onRequestRemove,
  onUnlink,
}: {
  onRequestRemove: (tag: string, inGameName: string) => void;
  onUnlink: (tag: string) => void;
}) {
  const person = useMemberDossierStore((s) => s.person);
  const babyTrialDays = useMemberDossierStore((s) => s.babyTrialDays);
  const savingDiscord = useMemberDossierStore((s) => s.savingDiscord);
  const saveDiscordId = useMemberDossierStore((s) => s.saveDiscordId);

  const [editingDiscord, setEditingDiscord] = useState(false);
  const [discordDraft, setDiscordDraft] = useState('');

  if (!person) return null;

  async function handleSaveDiscord(value: string) {
    if (await saveDiscordId(value)) setEditingDiscord(false);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <User size={32} color="var(--color-cta)" />
        </div>
        <div>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{person.display_name}</h1>
          <p className="text-muted" style={{ fontSize: '0.8rem' }}>Member since {new Date(person.created_at).toLocaleDateString()}</p>
        </div>
      </div>

      {person.is_baby && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 'var(--radius-md)' }}>
          <span className="baby-badge">
            <Baby size={12} /> BABY
            <span className="baby-badge-count">
              <Clock size={11} /> {(() => { const d = babyDaysLeft(person.baby_started_at, babyTrialDays); return d > 0 ? `${d}d left` : 'trial ended'; })()}
            </span>
          </span>
          <span className="text-muted" style={{ fontSize: '0.7rem', textAlign: 'right' }}>
            Promotion is automatic on in-game Elder promotion
          </span>
        </div>
      )}

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
        <h3 style={{ fontSize: '0.9rem', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <AtSign size={15} /> Discord
        </h3>
        {editingDiscord ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <input
              autoFocus
              value={discordDraft}
              onChange={(e) => setDiscordDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDiscord(discordDraft); if (e.key === 'Escape') setEditingDiscord(false); }}
              placeholder="Discord user ID (17–20 digits)"
              inputMode="numeric"
              className="input"
              style={{ fontSize: '0.8rem' }}
            />
            <p className="text-muted" style={{ fontSize: '0.68rem', margin: 0 }}>
              Discord → User Settings → Advanced → Developer Mode, then right-click the member → Copy User ID.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <button onClick={() => handleSaveDiscord(discordDraft)} disabled={savingDiscord} className="btn btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>{savingDiscord ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setEditingDiscord(false)} disabled={savingDiscord} className="btn btn-outline" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
            {person.discord_user_id ? (
              <span style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--color-success)' }}>
                <CheckCircle size={13} /> Linked <span className="text-muted" style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>({person.discord_user_id})</span>
              </span>
            ) : (
              <span className="text-muted" style={{ fontSize: '0.8rem' }}>Not linked — strikes won&apos;t @-mention this member.</span>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <button onClick={() => { setDiscordDraft(person.discord_user_id || ''); setEditingDiscord(true); }} className="btn btn-outline" style={{ padding: '0.3rem 0.7rem', fontSize: '0.72rem' }}>{person.discord_user_id ? 'Change' : 'Link'}</button>
              {person.discord_user_id && (
                <button onClick={() => handleSaveDiscord('')} disabled={savingDiscord} className="btn btn-outline" style={{ padding: '0.3rem 0.7rem', fontSize: '0.72rem', color: 'var(--color-danger)' }}>Unlink</button>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 'var(--space-lg)' }}>
        <h3 style={{ fontSize: '0.9rem', marginBottom: 'var(--space-md)' }}>Linked Accounts</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {person.player_accounts.map((acc) => (
            <div key={acc.player_tag} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                <span style={{ fontWeight: '700' }}>{acc.in_game_name}</span>
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  <button onClick={() => onUnlink(acc.player_tag)} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Unlink Account"><LinkIcon size={14} /></button>
                  <button onClick={() => onRequestRemove(acc.player_tag, acc.in_game_name)} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete Account"><Trash2 size={14} /></button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }} className="text-muted">
                <span>{acc.player_tag} • TH{acc.th_level}</span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}>{acc.clan.display_name}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
