'use client';

import { useState } from 'react';
import { MessageSquare, Baby, Send, Pencil, Trash2 } from 'lucide-react';
import { useMemberDossierStore } from '@/lib/stores/memberDossierStore';

// Member notes comment thread — available for every member; baby-phase notes carry forward.
// Draft/edit state stays local; the store owns the notes list and the mutations.
export default function MemberNotes() {
  const notes = useMemberDossierStore((s) => s.person?.member_notes ?? []);
  const isBaby = useMemberDossierStore((s) => s.person?.is_baby ?? false);
  const loggerNames = useMemberDossierStore((s) => s.loggerNames);
  const postingComment = useMemberDossierStore((s) => s.postingComment);
  const savingEdit = useMemberDossierStore((s) => s.savingEdit);
  const deletingCommentId = useMemberDossierStore((s) => s.deletingCommentId);
  const addComment = useMemberDossierStore((s) => s.addComment);
  const saveCommentEdit = useMemberDossierStore((s) => s.saveCommentEdit);
  const deleteComment = useMemberDossierStore((s) => s.deleteComment);
  const isAuthoredByMe = useMemberDossierStore((s) => s.isAuthoredByMe);

  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  async function handleAdd() {
    if (await addComment(newComment)) setNewComment('');
  }

  async function handleSaveEdit(commentId: string) {
    if (await saveCommentEdit(commentId, editDraft)) {
      setEditingCommentId(null);
      setEditDraft('');
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <MessageSquare size={20} color="var(--color-cta)" />
          <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Notes (exceptional)</h2>
        </div>
        {isBaby && (
          <span className="baby-badge">
            <Baby size={11} /> Baby trial
          </span>
        )}
      </div>

      <div style={{ marginBottom: notes.length ? 'var(--space-lg)' : 0 }}>
        <textarea
          className="input"
          rows={2}
          placeholder="Add a note about this member..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          style={{ resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
          <button onClick={handleAdd} disabled={postingComment || !newComment.trim()} className="btn btn-primary" style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}>
            <Send size={14} /> {postingComment ? 'Posting...' : 'Post Note'}
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="text-muted" style={{ padding: 'var(--space-md)', textAlign: 'center' }}>No notes yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {[...notes].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((c) => {
            const mine = isAuthoredByMe(c.author_tag);
            const edited = c.updated_at && c.updated_at !== c.created_at;
            return (
              <div key={c.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid rgba(34, 197, 94, 0.4)' }}>
                {editingCommentId === c.id ? (
                  <div>
                    <textarea className="input" rows={2} value={editDraft} onChange={(e) => setEditDraft(e.target.value)} style={{ resize: 'vertical' }} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                      <button onClick={() => { setEditingCommentId(null); setEditDraft(''); }} className="btn btn-outline" style={{ border: 'none', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>Cancel</button>
                      <button onClick={() => handleSaveEdit(c.id)} disabled={savingEdit || !editDraft.trim()} className="btn btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>{savingEdit ? 'Saving...' : 'Save'}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: '0.85rem', margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{c.body}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)' }}>
                      <span style={{ fontSize: '0.7rem' }} className="text-muted">
                        {loggerNames[c.author_tag] || c.author_tag} • {new Date(c.created_at).toLocaleDateString()}{edited ? ' (edited)' : ''}
                      </span>
                      {mine && (
                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                          <button onClick={() => { setEditingCommentId(c.id); setEditDraft(c.body); }} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Edit"><Pencil size={13} /></button>
                          <button onClick={() => deleteComment(c.id)} disabled={deletingCommentId === c.id} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
