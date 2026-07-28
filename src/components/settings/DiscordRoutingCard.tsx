'use client';

import { useEffect, useState } from 'react';
import { Radio, AlertTriangle, Megaphone } from 'lucide-react';
import { useSettingsStore } from '@/lib/stores/settingsStore';

/**
 * The notification ROUTING OVERRIDE control (migration 027).
 *
 * While the redirect is on, every Discord notification the app produces — strikes, warnings, CWL
 * lineup notices — goes to one channel instead of fanning out to the per-clan webhooks. That is the
 * testing-phase posture: watch the whole system talk in a private channel before it talks to the
 * family.
 *
 * It also holds the ANNOUNCEMENT channel (migration 029) — where the CWL roster posts go, separately
 * from the clan channels that carry everything addressed to specific people. Leaving it unset is a
 * real choice, not an omission: announcements then post to each clan's own channel exactly as before.
 *
 * The URL fields are WRITE-ONLY. What comes back from the API is a masked fingerprint, because a
 * webhook URL is a credential — see the route's doc block. Typing a new value replaces it; leaving
 * the field blank leaves the stored one alone.
 */
export default function DiscordRoutingCard() {
  const route = useSettingsStore((s) => s.discordRoute);
  const saving = useSettingsStore((s) => s.savingDiscordRoute);
  const fetchDiscordRoute = useSettingsStore((s) => s.fetchDiscordRoute);
  const saveDiscordRoute = useSettingsStore((s) => s.saveDiscordRoute);

  const [url, setUrl] = useState('');
  const [announceUrl, setAnnounceUrl] = useState('');

  useEffect(() => {
    fetchDiscordRoute();
  }, [fetchDiscordRoute]);

  if (!route) return null; // not loaded, or the actor lacks leader.manage

  const active = route.enabled;

  return (
    <div
      className="card"
      style={{
        padding: 'var(--space-lg)',
        border: active ? '1px solid var(--color-warning)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
        <Radio size={18} style={{ color: active ? 'var(--color-warning)' : 'var(--color-cta)' }} />
        <p style={{ fontWeight: 700, margin: 0 }}>NOTIFICATION ROUTING</p>
        {active && (
          <span
            style={{
              fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', padding: '2px 7px',
              borderRadius: 'var(--radius-sm)', background: 'var(--color-warning)', color: '#1a1a1a',
            }}
          >
            OVERRIDE ON
          </span>
        )}
      </div>
      <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0 0 var(--space-lg)' }}>
        {active
          ? 'Every notification is going to the override channel — the clan channels are receiving nothing. Members are still @-mentioned normally.'
          : 'Notifications fan out to each clan’s own channel. Turn the override on to send everything to one private channel instead.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <label style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
          Override webhook URL
          {route.configured && (
            <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
              · currently <code style={{ fontSize: '0.7rem' }}>{route.maskedUrl}</code>
            </span>
          )}
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <input
            type="password"
            className="input"
            style={{ flex: '1 1 320px' }}
            autoComplete="off"
            placeholder={route.configured ? 'Enter a new URL to replace the stored one' : 'https://discord.com/api/webhooks/…'}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="btn btn-outline"
            disabled={saving || !url.trim()}
            onClick={async () => {
              if (await saveDiscordRoute({ webhookUrl: url.trim() })) setUrl('');
            }}
          >
            Save URL
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginTop: 'var(--space-sm)' }}>
          <button
            className={`btn ${active ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-md)' }}
            disabled={saving || (!active && !route.configured)}
            onClick={() => saveDiscordRoute({ enabled: !active })}
          >
            {active ? 'REDIRECT ON' : 'REDIRECT OFF'}
          </button>
          {!route.configured && (
            <span className="text-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }}>
              <AlertTriangle size={13} /> Set a webhook URL first.
            </span>
          )}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-lg) 0 var(--space-md)' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
        <Megaphone size={16} style={{ color: 'var(--color-cta)' }} />
        <p style={{ fontWeight: 700, margin: 0, fontSize: '0.9rem' }}>ANNOUNCEMENT CHANNEL</p>
      </div>
      <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0 0 var(--space-md)' }}>
        {route.announcementConfigured
          ? 'CWL roster posts go here. Transfer calls, strikes and lineup notices still go to each clan’s own channel — they are aimed at specific people.'
          : 'Not set — CWL roster posts go to each clan’s own channel. Set a webhook to keep the standing roster out of the channels people watch for things aimed at them.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <label style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
          Announcement webhook URL
          {route.announcementConfigured && (
            <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
              · currently <code style={{ fontSize: '0.7rem' }}>{route.maskedAnnouncementUrl}</code>
            </span>
          )}
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <input
            type="password"
            className="input"
            style={{ flex: '1 1 320px' }}
            autoComplete="off"
            placeholder={route.announcementConfigured ? 'Enter a new URL to replace the stored one' : 'https://discord.com/api/webhooks/…'}
            value={announceUrl}
            onChange={(e) => setAnnounceUrl(e.target.value)}
          />
          <button
            className="btn btn-outline"
            disabled={saving || !announceUrl.trim()}
            onClick={async () => {
              if (await saveDiscordRoute({ announcementWebhookUrl: announceUrl.trim() })) setAnnounceUrl('');
            }}
          >
            Save URL
          </button>
          {/* Clearing is a supported end state, not an undo — it hands announcements back to the clan
              channels, so it gets its own control rather than being reachable only by saving blank. */}
          {route.announcementConfigured && (
            <button
              className="btn btn-outline"
              disabled={saving}
              onClick={() => saveDiscordRoute({ announcementWebhookUrl: '' })}
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-muted" style={{ fontSize: '0.7rem', margin: 0 }}>
          Changing this re-posts each clan’s roster into the new channel on the next roster post. The
          old ones stay where they are — delete them manually so nobody reads a stale roster.
        </p>
      </div>
    </div>
  );
}
