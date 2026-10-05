'use client';

import { useState } from 'react';
import Link from 'next/link';
import { User, AtSign, CheckCircle, Link as LinkIcon, Trash2, AlertTriangle, Ban } from 'lucide-react';
import { useMemberDossierStore, type FullPerson } from '@/lib/stores/memberDossierStore';
import MarkKickedModal from '@/components/kicks/MarkKickedModal';

type Account = FullPerson['player_accounts'][number];

// Left column of the dossier: identity, Discord-link editor, and linked accounts.
// Destructive actions are delegated up (the confirm modal and any navigation live in the page).
export default function PersonCard({
  onRequestRemove,
  onUnlink,
  onRequestDeletePerson,
}: {
  onRequestRemove: (tag: string, inGameName: string) => void;
  onUnlink: (tag: string) => void;
  onRequestDeletePerson: () => void;
}) {
  const person = useMemberDossierStore((s) => s.person);
  const savingDiscord = useMemberDossierStore((s) => s.savingDiscord);
  const saveDiscordId = useMemberDossierStore((s) => s.saveDiscordId);
  const myCapabilities = useMemberDossierStore((s) => s.myCapabilities);
  const kickedTags = useMemberDossierStore((s) => s.kickedTags);
  const markKickedLocal = useMemberDossierStore((s) => s.markKickedLocal);
  const setToast = useMemberDossierStore((s) => s.setToast);

  // UI gating only (API enforces): capabilities are overrides-aware, so a co-leader granted
  // leader.manage in Settings → Permissions sees the Danger Zone too.
  const canManage = myCapabilities.includes('leader.manage');

  const [editingDiscord, setEditingDiscord] = useState(false);
  const [discordDraft, setDiscordDraft] = useState('');
  const [marking, setMarking] = useState<Account | null>(null);

  if (!person) return null;

  // Inactive = gone from the family past the cleanup window. Kept (so the person is recognised if
  // they come back) but listed apart, below the accounts that are actually around.
  const currentAccounts = person.player_accounts.filter((a) => a.status !== 'inactive');
  const inactiveAccounts = person.player_accounts.filter((a) => a.status === 'inactive');

  function renderAccount(acc: Account) {
    const kicked = kickedTags.includes(acc.player_tag);
    const inactive = acc.status === 'inactive';
    return (
      <div key={acc.player_tag} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.05)', opacity: inactive ? 0.65 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
          <span style={{ fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            {acc.in_game_name}
            {kicked && (
              <Link href="/dashboard/kicks" style={{ fontSize: '0.6rem', fontWeight: 800, padding: '1px 6px', borderRadius: '3px', background: 'var(--color-danger)', color: '#fff' }}>
                KICK LIST
              </Link>
            )}
          </span>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            {/* Leadership's accounts are never put on the kick list (they kick their own alts to make room). */}
            {!kicked && !person!.access_role && (
              <button onClick={() => setMarking(acc)} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Mark as kicked"><Ban size={14} /></button>
            )}
            <button onClick={() => onUnlink(acc.player_tag)} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Unlink Account"><LinkIcon size={14} /></button>
            <button onClick={() => onRequestRemove(acc.player_tag, acc.in_game_name)} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete Account"><Trash2 size={14} /></button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }} className="text-muted">
          <span>{acc.player_tag} • TH{acc.th_level}</span>
          <span style={{ fontSize: '0.65rem', padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}>
            {inactive ? 'inactive' : acc.clan?.display_name ?? 'No clan'}
          </span>
        </div>
      </div>
    );
  }

  async function handleSaveDiscord(value: string) {
    if (await saveDiscordId(value)) setEditingDiscord(false);
  }

  return (
    <>
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
          {currentAccounts.map(renderAccount)}
          {currentAccounts.length === 0 && <p className="text-muted" style={{ fontSize: '0.8rem', margin: 0 }}>No accounts in the family right now.</p>}
        </div>
        {inactiveAccounts.length > 0 && (
          <>
            <h3 style={{ fontSize: '0.8rem', margin: 'var(--space-lg) 0 var(--space-xs)' }} className="text-muted">Inactive Accounts</h3>
            <p className="text-muted" style={{ fontSize: '0.7rem', margin: '0 0 var(--space-sm)' }}>
              Gone from every family clan for a while. Hidden everywhere else, kept so a returning player is recognised.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {inactiveAccounts.map(renderAccount)}
            </div>
          </>
        )}
      </div>
    </div>

    {marking && (
      <MarkKickedModal
        account={{ tag: marking.player_tag, name: marking.in_game_name }}
        onClose={() => setMarking(null)}
        onDone={(entry) => {
          markKickedLocal(entry.tag);
          setMarking(null);
          setToast({ type: 'success', message: `${entry.name} added to the kick list.` });
        }}
      />
    )}

    {/* Danger Zone: delete the whole person (accounts → Unlinked, history erased). leader.manage
        only; blocked while the person still holds dashboard access. */}
    {canManage && (
      <div className="card" style={{ border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.02)' }}>
        <h3 style={{ fontSize: '0.9rem', margin: '0 0 var(--space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--color-danger)' }}>
          <AlertTriangle size={15} /> Danger Zone
        </h3>
        {person.access_role ? (
          <p className="text-muted" style={{ fontSize: '0.78rem', margin: 0 }}>
            This member holds dashboard access ({person.access_role.replace('_', ' ')}). Revoke it in Settings → Leaders before you can delete them.
          </p>
        ) : (
          <>
            <p className="text-muted" style={{ fontSize: '0.78rem', margin: '0 0 var(--space-md)' }}>
              Deletes this person. Their {person.player_accounts.length} linked account{person.player_accounts.length === 1 ? '' : 's'} return to the Unlinked pool; all strikes and notes are permanently erased. This cannot be undone.
            </p>
            <button
              onClick={onRequestDeletePerson}
              className="btn"
              style={{ background: 'var(--color-danger)', color: '#fff', fontSize: '0.8rem' }}
            >
              <Trash2 size={14} /> Delete Person
            </button>
          </>
        )}
      </div>
    )}
    </>
  );
}
