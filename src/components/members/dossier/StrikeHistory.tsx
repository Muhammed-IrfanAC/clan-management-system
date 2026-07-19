'use client';

import { AlertTriangle } from 'lucide-react';
import { useMemberDossierStore } from '@/lib/stores/memberDossierStore';
import { expiryOf } from '@/lib/strikes/status';
import { buildDossiers, type StrikeWithContext } from '@/lib/strikes/dossier';

const LEVEL_COLOR: Record<string, string> = {
  clear: 'var(--color-muted)',
  green: 'var(--color-cta)',
  orange: 'var(--color-warning)',
  red: 'var(--color-danger)',
};

// Strike history grouped per ACCOUNT: each account is judged on its own strikes (own count /
// colour / war-eligibility / removal-at-3), never combined across the persona's alts.
export default function StrikeHistory() {
  const person = useMemberDossierStore((s) => s.person);
  const loggerNames = useMemberDossierStore((s) => s.loggerNames);
  if (!person) return null;

  const now = new Date();
  const nameByTag = new Map(person.player_accounts.map((a) => [a.player_tag, a.in_game_name]));
  const dossiers = buildDossiers(person.strikes as unknown as StrikeWithContext[], now);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <AlertTriangle size={20} className="text-warning" />
        <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Strike History</h2>
      </div>
      {dossiers.length === 0 ? (
        <p className="text-muted" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>No strikes on record.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
          {dossiers.map((dos) => {
            const status = dos.status;
            const accountName = nameByTag.get(dos.accountTag) || dos.inGameName;
            return (
              <div key={dos.accountTag}>
                {/* Per-account status header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700 }}>{accountName}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '1.8rem', height: '1.8rem', borderRadius: '50%', background: LEVEL_COLOR[status.level], color: '#111', fontWeight: 800, fontSize: '0.9rem' }}>{status.activeCount}</span>
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>active</span>
                    {status.removalFlagged && <span style={{ fontSize: '0.62rem', padding: '2px 8px', background: 'var(--color-danger)', color: '#fff', borderRadius: '10px', fontWeight: 700 }}>REMOVAL</span>}
                    {!status.warEligible && <span style={{ fontSize: '0.62rem', padding: '2px 8px', background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)', borderRadius: '10px', fontWeight: 700 }}>WAR-INELIGIBLE</span>}
                    {status.eligibleForElderRestoration && <span style={{ fontSize: '0.62rem', padding: '2px 8px', background: 'rgba(34,197,94,0.12)', color: 'var(--color-cta)', borderRadius: '10px', fontWeight: 700 }}>RESTORE ELDER</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {dos.strikes.map((s) => {
                    const active = new Date(expiryOf(s.issued_at)).getTime() > now.getTime();
                    return (
                      <div key={s.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${!active ? 'var(--color-muted)' : s.leadership_approved ? 'var(--color-cta)' : 'var(--color-warning)'}`, opacity: active ? 1 : 0.65 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: '600' }}>{s.rule?.name || 'General strike'}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            <span style={{ fontSize: '0.6rem', padding: '2px 7px', borderRadius: '10px', fontWeight: 700, background: active ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)', color: active ? 'var(--color-warning)' : 'var(--color-muted)' }}>{active ? 'ACTIVE' : 'EXPIRED'}</span>
                            <span style={{ fontSize: '0.7rem' }} className="text-muted">{new Date(s.issued_at).toLocaleDateString()}</span>
                          </span>
                        </div>
                        {(s.strike_violations || []).length > 0 && (
                          <ul style={{ margin: '8px 0', paddingLeft: '1.1rem', fontSize: '0.82rem', lineHeight: 1.5 }}>
                            {s.strike_violations!.map((v) => <li key={v.id}>{v.description}</li>)}
                          </ul>
                        )}
                        <div style={{ fontSize: '0.7rem' }} className="text-muted">
                          Logged by {loggerNames[s.logged_by] || s.logged_by} • expires {new Date(expiryOf(s.issued_at)).toLocaleDateString()}
                          {s.leadership_approved ? ' • trust restored' : ''}
                          {s.removal_at ? ' • marked removed' : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
