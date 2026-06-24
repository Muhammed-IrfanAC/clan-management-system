'use client';

import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error';
export interface ToastState {
  message: string;
  type: ToastType;
}

/**
 * Lightweight, self-dismissing toast. Render once near the page root and drive it
 * with a single piece of state (`null` = hidden). Announces politely to screen
 * readers without stealing focus.
 */
export default function Toast({
  toast,
  onClose,
  duration = 3500,
}: {
  toast: ToastState | null;
  onClose: () => void;
  duration?: number;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [toast, duration, onClose]);

  if (!toast) return null;

  const success = toast.type === 'success';
  const accent = success ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)';

  return (
    <div
      role="status"
      aria-live="polite"
      className="toast"
      style={{
        position: 'fixed',
        bottom: 'var(--space-lg)',
        right: 'var(--space-lg)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-md)',
        maxWidth: 'min(380px, calc(100vw - 2 * var(--space-lg)))',
        padding: '0.85rem 1rem',
        background: 'var(--color-secondary, #1E293B)',
        color: 'var(--color-text, #F8FAFC)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      }}
    >
      {success ? (
        <CheckCircle2 size={18} style={{ color: accent, flexShrink: 0 }} />
      ) : (
        <AlertCircle size={18} style={{ color: accent, flexShrink: 0 }} />
      )}
      <span style={{ fontSize: '0.85rem', lineHeight: 1.4, flex: 1 }}>{toast.message}</span>
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer', display: 'flex', flexShrink: 0 }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
