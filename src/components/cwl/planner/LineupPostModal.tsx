'use client';

import { useEffect, useState } from 'react';
import { X, Activity, Send, Megaphone } from 'lucide-react';
import { useCwlPlannerStore } from '@/lib/stores/cwlPlannerStore';
import { MessagePreview } from '@/components/cwl/RosterPostModal';
import { useClanName } from '@/components/cwl/useClanName';

/**
 * Post the clan's next-war lineup to its Discord channel — with the real message previewed first.
 *
 * The preview comes from the same endpoint and renderer that posts it. Posting the same war again
 * edits the message already in the channel (and an edit does not ping anyone); the next war gets a
 * fresh message.
 */
export default function LineupPostModal({ onClose }: { onClose: () => void }) {
  const clanId = useCwlPlannerStore((s) => s.clanId);
  const preview = useCwlPlannerStore((s) => s.lineupPreview);
  const loading = useCwlPlannerStore((s) => s.loadingLineupPreview);
  const posting = useCwlPlannerStore((s) => s.postingLineup);
  const loadPreview = useCwlPlannerStore((s) => s.loadLineupPreview);
  const clearPreview = useCwlPlannerStore((s) => s.clearLineupPreview);
  const postLineup = useCwlPlannerStore((s) => s.postLineup);
  const clanName = useClanName();
  const [ping, setPing] = useState(true);

  useEffect(() => {
    loadPreview(ping);
  }, [loadPreview, ping]);
  useEffect(() => () => clearPreview(), [clearPreview]);

  const updates = !!preview?.updatesExisting;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '680px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-lg)', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <Megaphone size={18} className="text-cta" />
            <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Post lineup to Discord</h2>
          </div>
          <button className="btn btn-outline" style={{ border: 'none', padding: 6 }} aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-lg)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', marginBottom: 'var(--space-sm)', cursor: 'pointer' }}>
            <input type="checkbox" checked={ping} onChange={(e) => setPing(e.target.checked)} />
            Ping the players in the lineup (those with a linked Discord account)
          </label>
          <p className="text-muted" style={{ fontSize: '0.78rem', margin: '0 0 var(--space-md)' }}>
            {updates
              ? 'This war was already posted — the message will be UPDATED in place. An update does not ping anyone again.'
              : 'Sent to the clan’s own channel. Posting this war again later updates the same message instead of adding a new one.'}
          </p>
          {loading || !preview ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
              <Activity className="animate-spin text-muted" size={22} />
            </div>
          ) : !preview.message ? (
            <p className="text-muted" style={{ fontSize: '0.85rem' }}>Every war has started — nothing left to post.</p>
          ) : (
            <MessagePreview label={`${clanName(clanId)} — clan channel`} message={preview.message} />
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', padding: 'var(--space-lg)', borderTop: '1px solid var(--color-border)' }}>
          <button className="btn btn-outline" style={{ border: 'none' }} onClick={onClose}>Close</button>
          <button
            className="btn btn-primary"
            disabled={loading || posting || !preview?.message}
            onClick={async () => {
              if (await postLineup(ping)) onClose();
            }}
          >
            <Send size={15} />
            {posting ? 'Posting…' : updates ? `Update war ${preview?.roundNumber} lineup` : `Post war ${preview?.roundNumber ?? ''} lineup`}
          </button>
        </div>
      </div>
    </div>
  );
}
