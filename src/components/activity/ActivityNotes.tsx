'use client';

import { useState } from 'react';
import { Pencil, Trash2, Send } from 'lucide-react';
import { useActivityStore, type ExtendedLog } from '@/lib/stores/activityStore';

// Progress-note thread for a single activity entry. Draft/edit state is local to the card; the
// store owns the note list and the mutations (each of which splices only this log's thread).
export default function ActivityNotes({ log }: { log: ExtendedLog }) {
  const loggerNames = useActivityStore((s) => s.loggerNames);
  const postingNoteId = useActivityStore((s) => s.postingNoteId);
  const savingNote = useActivityStore((s) => s.savingNote);
  const deletingNoteId = useActivityStore((s) => s.deletingNoteId);
  const addNote = useActivityStore((s) => s.addNote);
  const saveNote = useActivityStore((s) => s.saveNote);
  const deleteNote = useActivityStore((s) => s.deleteNote);
  const isAuthoredByMe = useActivityStore((s) => s.isAuthoredByMe);

  const [draft, setDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const notes = log.activity_notes || [];

  async function handleAdd() {
    if (await addNote(log.id, draft)) setDraft('');
  }

  async function handleSaveEdit(noteId: string) {
    if (await saveNote(log.id, noteId, editDraft)) {
      setEditingNoteId(null);
      setEditDraft('');
    }
  }

  return (
    <div style={{ marginTop: 'var(--space-md)' }}>
      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
          {[...notes].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((n) => {
            const mine = isAuthoredByMe(n.author_tag);
            const edited = n.updated_at && n.updated_at !== n.created_at;
            return (
              <div key={n.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)' }}>
                {editingNoteId === n.id ? (
                  <div>
                    <textarea className="input" rows={2} value={editDraft} onChange={(e) => setEditDraft(e.target.value)} style={{ resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
                      <button onClick={() => { setEditingNoteId(null); setEditDraft(''); }} className="btn btn-outline" style={{ border: 'none', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>Cancel</button>
                      <button onClick={() => handleSaveEdit(n.id)} disabled={savingNote || !editDraft.trim()} className="btn btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>{savingNote ? 'Saving...' : 'Save'}</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.body}</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                        {loggerNames[n.author_tag] || n.author_tag} • {new Date(n.created_at).toLocaleDateString()}{edited ? ' (edited)' : ''}
                      </span>
                      {mine && (
                        <span style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                          <button onClick={() => { setEditingNoteId(n.id); setEditDraft(n.body); }} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Edit"><Pencil size={13} /></button>
                          <button onClick={() => deleteNote(log.id, n.id)} disabled={deletingNoteId === n.id} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete"><Trash2 size={13} /></button>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end' }}>
        <textarea
          className="input"
          rows={1}
          placeholder="Add a progress note..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ resize: 'vertical', flex: 1 }}
        />
        <button onClick={handleAdd} disabled={postingNoteId === log.id || !draft.trim()} className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
          <Send size={14} /> {postingNoteId === log.id ? 'Posting...' : 'Post'}
        </button>
      </div>
    </div>
  );
}
