'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { X, Activity, Send, Megaphone, AlertTriangle } from 'lucide-react';
import { useCWLStore } from '@/lib/stores/cwlStore';
import type { DiscordMessage } from '@/lib/discord';

/**
 * Publish the finalized roster to Discord — with a preview first.
 *
 * The preview is not a mock-up: it is the exact payload the API would send, rendered by the same pure
 * functions (`cwl/rosterPost.ts`), fetched from the same endpoint that posts it. Posting to the whole
 * family is outward-facing and hard to take back, so a leader sees the real thing before pressing.
 *
 * Two separate actions, because they behave differently and a leader must be able to tell them apart:
 * the rosters are silent and idempotent (edited in place on every press), while the transfer call
 * genuinely @-pings people and is sent fresh every time.
 */
export default function RosterPostModal({ onClose }: { onClose: () => void }) {
  const posts = useCWLStore((s) => s.rosterPost);
  const loading = useCWLStore((s) => s.loadingRosterPost);
  const posting = useCWLStore((s) => s.postingRoster);
  const loadRosterPost = useCWLStore((s) => s.loadRosterPost);
  const clearRosterPost = useCWLStore((s) => s.clearRosterPost);
  const publish = useCWLStore((s) => s.publishRosterPost);

  const [tab, setTab] = useState<'roster' | 'transfers'>('roster');

  useEffect(() => {
    loadRosterPost();
    return () => clearRosterPost();
  }, [loadRosterPost, clearRosterPost]);

  const alreadyPosted = !!posts?.clans.some((c) => c.messageId);

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '680px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-lg)', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <Megaphone size={18} className="text-cta" />
            <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Post roster to Discord</h2>
          </div>
          <button className="btn btn-outline" style={{ border: 'none', padding: 6 }} aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-xs)', padding: 'var(--space-md) var(--space-lg) 0' }}>
          {(['roster', 'transfers'] as const).map((t) => (
            <button
              key={t}
              className={`btn ${tab === t ? 'btn-primary' : 'btn-outline'}`}
              style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-md)' }}
              onClick={() => setTab(t)}
            >
              {t === 'roster' ? 'Rosters + digest' : `Transfer call${posts?.pendingMoves ? ` (${posts.pendingMoves})` : ''}`}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-lg)' }}>
          {loading || !posts ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
              <Activity className="animate-spin text-muted" size={22} />
            </div>
          ) : tab === 'roster' ? (
            <>
              <p className="text-muted" style={{ fontSize: '0.78rem', margin: '0 0 var(--space-md)' }}>
                {alreadyPosted
                  ? 'These messages already exist and will be UPDATED in place — no new notifications, no duplicate rosters.'
                  : 'One message per clan, sent to that clan’s own channel, plus a digest to the family-wide channel. Nobody is pinged.'}
              </p>
              {posts.clans.map((c) => (
                <MessagePreview key={c.clanId} label={`${c.clanName} — clan channel`} message={c.message} />
              ))}
              <MessagePreview label="Leadership digest — family-wide channel" message={posts.digest} />
            </>
          ) : (
            <>
              <p className="text-muted" style={{ fontSize: '0.78rem', margin: '0 0 var(--space-md)' }}>
                One message per clan people are moving <em>out of</em>, sent to that clan&apos;s own channel. Plain
                messages, not embeds — a mention inside an embed never notifies. Each one{' '}
                <strong>@-mentions</strong> the accounts that still have to move, and is sent fresh every time:
                pressing this twice pings them twice.
              </p>
              {posts.transferCallPostedAt && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--color-warning)', marginBottom: 'var(--space-md)' }}>
                  <AlertTriangle size={13} />
                  Already sent {new Date(posts.transferCallPostedAt).toLocaleString()}.
                </div>
              )}
              {posts.transferCalls.length === 0 ? (
                <p className="text-muted" style={{ fontSize: '0.8rem' }}>
                  Nothing to send — everyone is already in the clan they are rostered for.
                </p>
              ) : (
                posts.transferCalls.map((g) => (
                  <MessagePreview
                    key={g.fromClanId || 'family'}
                    label={g.fromClanName ? `${g.fromClanName} — clan channel` : 'Not in a family clan — family-wide channel'}
                    message={g.message}
                  />
                ))
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', padding: 'var(--space-lg)', borderTop: '1px solid var(--color-border)' }}>
          <button className="btn btn-outline" style={{ border: 'none' }} onClick={onClose}>Close</button>
          <button
            className="btn btn-primary"
            disabled={!posts || !!posting || (tab === 'transfers' && posts.transferCalls.length === 0)}
            onClick={() => publish(tab)}
          >
            <Send size={15} />
            {posting
              ? 'Posting…'
              : tab === 'roster'
                ? (alreadyPosted ? 'Update rosters' : 'Post rosters')
                : `Send transfer call${posts?.pendingMoves ? ` (pings ${posts.pendingMoves})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A readable rendering of one Discord payload — same shape as Discord draws it, minus the styling. */
function MessagePreview({ label, message }: { label: string; message: DiscordMessage }) {
  const embed = message.embeds?.[0];
  return (
    <div style={{ marginBottom: 'var(--space-lg)' }}>
      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-muted)', marginBottom: 4 }}>
        {label}
      </div>
      <div
        className="card"
        style={{
          padding: 'var(--space-md)',
          borderLeft: `3px solid ${embed?.color ? `#${embed.color.toString(16).padStart(6, '0')}` : 'var(--color-border)'}`,
        }}
      >
        {/* Plain content, not an embed field — the transfer call lives entirely here, because a
            mention inside an embed renders but never notifies. */}
        {message.content && (
          <div style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: embed ? 'var(--space-sm)' : 0 }}>
            {message.content}
          </div>
        )}
        {embed?.title && <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{embed.title}</div>}
        {embed?.description && <Body text={embed.description} style={{ margin: '4px 0 0' }} />}
        {embed?.fields?.map((f, i) => (
          <div key={i} style={{ marginTop: 'var(--space-sm)' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700 }}>{f.name}</div>
            <Body text={f.value} />
          </div>
        ))}
        {embed?.footer && (
          <div className="text-muted" style={{ fontSize: '0.65rem', marginTop: 'var(--space-sm)' }}>{embed.footer.text}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Embed text as Discord draws it. Rosters are ```-fenced tables, so the fence markers are stripped
 * and the block rendered monospace — otherwise the preview shows backticks the real message never has,
 * and the column alignment the whole format depends on is invisible in a proportional font.
 */
function Body({ text, style }: { text: string; style?: CSSProperties }) {
  const fenced = text.startsWith('```\n') && text.endsWith('\n```');
  return (
    <div
      className={fenced ? undefined : 'text-muted'}
      style={{
        fontSize: fenced ? '0.72rem' : '0.78rem',
        whiteSpace: 'pre',
        overflowX: 'auto',
        fontFamily: fenced ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
        ...style,
      }}
    >
      {fenced ? text.slice(4, -4) : text}
    </div>
  );
}
