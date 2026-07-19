'use client';

import { useState } from 'react';
import { History, Pin, User, Shield, Sword, Tag, Trash2, Pencil, MessageSquare, ChevronDown } from 'lucide-react';
import { useActivityStore, type ExtendedLog } from '@/lib/stores/activityStore';
import ActivityNotes from './ActivityNotes';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  promotion: <Shield size={16} className="text-cta" />,
  demotion: <Shield size={16} className="text-danger" />,
  war: <Sword size={16} />,
  recruitment: <User size={16} />,
  capital: <Tag size={16} />,
  general: <History size={16} />,
};

// One leadership-log entry: header/body/meta, the complete/edit/delete controls, and a collapsible
// note thread. Editing and deletion are delegated up (the edit modal and confirm modal live in the
// page); everything else reads and mutates the store directly. "Notes expanded" is card-local.
export default function ActivityCard({
  log,
  onEdit,
  onRequestDelete,
}: {
  log: ExtendedLog;
  onEdit: (log: ExtendedLog) => void;
  onRequestDelete: (id: string) => void;
}) {
  const loggerNames = useActivityStore((s) => s.loggerNames);
  const togglingId = useActivityStore((s) => s.togglingId);
  const toggleComplete = useActivityStore((s) => s.toggleComplete);
  const isAuthoredByMe = useActivityStore((s) => s.isAuthoredByMe);

  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <div className="card" style={{ borderLeft: log.pinned ? '4px solid var(--color-cta)' : '1px solid rgba(255,255,255,0.05)', opacity: log.completed ? 0.7 : 1 }}>
      <div className="warning-card-layout" style={{ gap: 'var(--space-lg)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-lg)', flex: 1, minWidth: 0 }}>
          <div style={{ width: '40px', height: '40px', background: 'var(--color-primary)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {CATEGORY_ICONS[log.category] || <History size={16} />}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                <span style={{ fontWeight: '700', textTransform: 'uppercase', fontSize: '0.75rem', color: 'var(--color-muted)' }}>{log.category}</span>
                {log.pinned && <Pin size={14} className="text-cta" />}
                {log.completed && <span style={{ fontSize: '0.6rem', padding: '1px 6px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-cta)', borderRadius: '4px' }}>COMPLETED</span>}
              </div>
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>{new Date(log.logged_at).toLocaleString()}</span>
            </div>

            <p style={{ margin: 0, lineHeight: '1.6', color: log.completed ? 'var(--color-muted)' : 'var(--color-text)', textDecoration: log.completed ? 'line-through' : 'none' }}>
              {log.description}
            </p>

            <div className="warning-card-meta text-muted" style={{ marginTop: 'var(--space-sm)' }}>
              {log.clan && <span>Clan: <strong>{log.clan.display_name}</strong></span>}
              {log.person && <span>Related: <strong>{log.person.display_name}</strong></span>}
              <span>By: <strong>{loggerNames[log.logged_by] || log.logged_by}</strong>{log.edited_at ? <span className="text-muted"> (edited)</span> : null}</span>
            </div>
          </div>
        </div>

        <div className="warning-card-actions">
          <button
            onClick={() => toggleComplete(log.id, log.completed)}
            disabled={togglingId === log.id}
            className={`btn ${log.completed ? 'btn-outline' : 'btn-primary'}`}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', border: log.completed ? '1px solid rgba(255,255,255,0.1)' : '' }}
          >
            {log.completed ? 'Re-open' : 'Complete'}
          </button>
          {isAuthoredByMe(log.logged_by) && (
            <button onClick={() => onEdit(log)} className="btn btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--color-muted)' }}>
              <Pencil size={14} /> Edit
            </button>
          )}
          <button onClick={() => onRequestDelete(log.id)} className="btn btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', border: 'none', color: 'var(--color-danger)' }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {/* Progress notes */}
      <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <button
          onClick={() => setNotesOpen((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
        >
          <MessageSquare size={15} />
          Notes {log.activity_notes.length > 0 ? `(${log.activity_notes.length})` : ''}
          <ChevronDown size={14} style={{ transform: notesOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }} />
        </button>

        {notesOpen && <ActivityNotes log={log} />}
      </div>
    </div>
  );
}
