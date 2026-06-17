'use client';

import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  variant = 'danger',
  isLoading = false
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  const colorMap = {
    danger: 'var(--color-danger)',
    warning: 'var(--color-warning)',
    info: 'var(--color-cta)'
  };

  const bgColorMap = {
    danger: 'rgba(239, 68, 68, 0.1)',
    warning: 'rgba(245, 158, 11, 0.1)',
    info: 'rgba(34, 197, 94, 0.1)'
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
          <div style={{ 
            display: 'inline-flex', 
            padding: 'var(--space-md)', 
            borderRadius: '50%', 
            background: bgColorMap[variant],
            marginBottom: 'var(--space-lg)'
          }}>
            <AlertTriangle size={32} color={colorMap[variant]} />
          </div>
          
          <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-sm)' }}>{title}</h2>
          <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: 'var(--space-xl)', lineHeight: '1.5' }}>
            {message}
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
            <button 
              className="btn btn-outline" 
              style={{ flex: 1, border: 'none' }} 
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button 
              className="btn btn-primary" 
              style={{ flex: 1, background: colorMap[variant] }} 
              onClick={onConfirm}
              disabled={isLoading}
            >
              {isLoading ? 'Processing...' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
