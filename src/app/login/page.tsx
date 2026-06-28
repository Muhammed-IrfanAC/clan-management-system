'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Sword, ChevronRight } from 'lucide-react';

const REMEMBERED_TAG_KEY = 'clanops-remembered-tag';

export default function LoginPage() {
  const [playerTag, setPlayerTag] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  // Prefill the tag saved on this device so returning users don't retype it.
  useEffect(() => {
    const saved = localStorage.getItem(REMEMBERED_TAG_KEY);
    if (saved) {
      setPlayerTag(saved);
    } else {
      // Nothing remembered yet — leave the checkbox on but the field empty.
      setRememberMe(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerTag }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Persist (or clear) the tag on this device based on the checkbox.
      if (rememberMe) {
        localStorage.setItem(REMEMBERED_TAG_KEY, playerTag.toUpperCase().replace('#', ''));
      } else {
        localStorage.removeItem(REMEMBERED_TAG_KEY);
      }

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      padding: 'var(--space-md)',
      background: 'radial-gradient(circle at center, #0F172A 0%, #020617 100%)'
    }}>
      <div className="card" style={{ maxWidth: '400px', width: '100%', textAlign: 'center' }}>
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div style={{ 
            display: 'inline-flex', 
            padding: 'var(--space-md)', 
            borderRadius: '50%', 
            background: 'rgba(34, 197, 94, 0.1)',
            marginBottom: 'var(--space-md)'
          }}>
            <Shield size={48} color="var(--color-cta)" />
          </div>
          <h1 className="glow-text" style={{ fontSize: '2.5rem', marginBottom: '0' }}>ClanOps</h1>
          <p className="text-muted" style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Leadership Management System
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ textAlign: 'left' }}>
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--space-sm)', fontSize: '0.8rem', fontWeight: '600', color: 'var(--color-muted)', textTransform: 'uppercase' }}>
              Your Player Tag
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }}>
                #
              </span>
              <input
                type="text"
                name="playerTag"
                autoComplete="username"
                autoFocus
                className="input"
                placeholder="P98VC2..."
                value={playerTag.replace('#', '')}
                onChange={(e) => setPlayerTag(e.target.value.toUpperCase())}
                style={{ paddingLeft: '2.5rem' }}
                required
              />
            </div>
            {error && <p className="text-danger" style={{ fontSize: '0.8rem', marginTop: 'var(--space-sm)' }}>{error}</p>}
          </div>

          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            marginBottom: 'var(--space-lg)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            color: 'var(--color-muted)',
            userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={{ width: '1.1rem', height: '1.1rem', accentColor: 'var(--color-cta)', cursor: 'pointer' }}
            />
            Remember my tag on this device
          </label>

          <button
            type="submit" 
            className="btn btn-primary" 
            style={{ width: '100%', height: '3.5rem' }}
            disabled={loading}
          >
            {loading ? 'Verifying...' : (
              <>
                Initialize Access <ChevronRight size={20} />
              </>
            )}
          </button>
        </form>

        <div style={{ marginTop: 'var(--space-xl)', padding: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-muted" style={{ fontSize: '0.75rem' }}>
            No email. No password. Identity = player tag.
          </p>
        </div>
      </div>
    </main>
  );
}
