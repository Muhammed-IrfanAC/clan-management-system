'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, ChevronRight, ArrowLeft } from 'lucide-react';

const REMEMBERED_TAG_KEY = 'clanops-remembered-tag';

export default function LoginPage() {
  const [playerTag, setPlayerTag] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Step 2: the code sent to the user's Discord DMs. Null while still on the tag step.
  const [challenge, setChallenge] = useState<{ id: string; tag: string } | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

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

  // Step 1: ask for a code to be sent to the tag owner's Discord.
  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
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
        if (data.retryAfterSec) setResendIn(data.retryAfterSec);
        throw new Error(data.error || 'Login failed');
      }

      // Persist (or clear) the tag on this device based on the checkbox.
      const tag = playerTag.toUpperCase().replace('#', '');
      if (rememberMe) {
        localStorage.setItem(REMEMBERED_TAG_KEY, tag);
      } else {
        localStorage.removeItem(REMEMBERED_TAG_KEY);
      }

      setChallenge({ id: data.challengeId, tag });
      setCode('');
      setResendIn(data.resendAfterSec ?? 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: exchange the code for a session.
  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: challenge.id, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCode('');
        throw new Error(data.error || 'Login failed');
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  };

  const backToTag = () => {
    setChallenge(null);
    setCode('');
    setError('');
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

        {challenge ? (
        <form onSubmit={verifyCode} style={{ textAlign: 'left' }}>
          <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: 'var(--space-lg)', textAlign: 'center' }}>
            We sent a 6-digit code to your Discord DMs for <strong>#{challenge?.tag}</strong>.
          </p>
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--space-sm)', fontSize: '0.8rem', fontWeight: '600', color: 'var(--color-muted)', textTransform: 'uppercase' }}>
              Login Code
            </label>
            <input
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              className="input"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
              style={{ letterSpacing: '0.4em', textAlign: 'center', fontSize: '1.25rem' }}
              required
            />
            {error && <p className="text-danger" style={{ fontSize: '0.8rem', marginTop: 'var(--space-sm)' }}>{error}</p>}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', height: '3.5rem' }}
            disabled={loading || code.length !== 6}
          >
            {loading ? 'Verifying...' : (
              <>
                Log in <ChevronRight size={20} />
              </>
            )}
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-md)', fontSize: '0.8rem' }}>
            <button type="button" className="btn-link text-muted" onClick={backToTag} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'none', border: 0, cursor: 'pointer' }}>
              <ArrowLeft size={14} /> Different tag
            </button>
            <button type="button" className="btn-link text-muted" onClick={() => sendCode()} disabled={loading || resendIn > 0} style={{ background: 'none', border: 0, cursor: resendIn > 0 ? 'default' : 'pointer' }}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
          </div>
        </form>
        ) : (
        <form onSubmit={sendCode} style={{ textAlign: 'left' }}>
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
            {loading ? 'Sending code...' : (
              <>
                Send code to Discord <ChevronRight size={20} />
              </>
            )}
          </button>
        </form>
        )}

        <div style={{ marginTop: 'var(--space-xl)', padding: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-muted" style={{ fontSize: '0.75rem' }}>
            No password. Your player tag, confirmed by a code on Discord.
          </p>
        </div>
      </div>
    </main>
  );
}
