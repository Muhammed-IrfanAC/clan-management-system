'use client';

import { useEffect, useState } from 'react';
import { Radio, AlertTriangle, Megaphone, ShieldAlert, UserPlus, Bot, CheckCircle2, XCircle } from 'lucide-react';
import { useSettingsStore, type DiscordChannelField } from '@/lib/stores/settingsStore';

/**
 * The notification ROUTING OVERRIDE control (migration 027).
 *
 * While the redirect is on, every Discord notification the app produces — strikes, warnings, CWL
 * lineup notices — goes to one channel instead of fanning out to the per-clan channels. That is the
 * testing-phase posture: watch the whole system talk in a private channel before it talks to the
 * family.
 *
 * It also holds the ANNOUNCEMENT channel (migration 029) — where the CWL roster posts go, separately
 * from the clan channels that carry everything addressed to specific people. Leaving it unset is a
 * real choice, not an omission: announcements then post to each clan's own channel exactly as before.
 *
 * And the LEADERSHIP channel (migration 035) — alerts meant for leadership only, currently a kicked
 * player rejoining a family clan. Same rule: unset, they post to the clan's own channel.
 *
 * And the UNLINKED-JOIN channel (migration 036) — an alert pinging the Leadership role when a player
 * with no linked person joins a family clan. Unset, it inherits the leadership channel. A clan's own
 * join-alert channel or thread (Clans tab, migration 039) wins over it.
 *
 * Every route is a bot channel id (migration 037); the per-clan channels are set on the Clans tab.
 */
export default function DiscordRoutingCard() {
  const route = useSettingsStore((s) => s.discordRoute);
  const saving = useSettingsStore((s) => s.savingDiscordRoute);
  const fetchDiscordRoute = useSettingsStore((s) => s.fetchDiscordRoute);
  const saveDiscordRoute = useSettingsStore((s) => s.saveDiscordRoute);

  useEffect(() => {
    fetchDiscordRoute();
  }, [fetchDiscordRoute]);

  if (!route) return null; // not loaded, or the actor lacks leader.manage

  const active = route.enabled;
  const overrideReady = route.botConfigured && !!route.overrideChannelId;

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

      <BotStatus />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <ChannelIdField field="overrideChannelId" label="Override channel" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <button
            className={`btn ${active ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-md)' }}
            disabled={saving || (!active && !overrideReady)}
            onClick={() => saveDiscordRoute({ enabled: !active })}
          >
            {active ? 'REDIRECT ON' : 'REDIRECT OFF'}
          </button>
          {!overrideReady && (
            <span className="text-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }}>
              <AlertTriangle size={13} /> Set an override channel first.
            </span>
          )}
        </div>
      </div>

      <Divider />

      <SectionHeading icon={<Megaphone size={16} style={{ color: 'var(--color-cta)' }} />} title="ANNOUNCEMENT CHANNEL" />
      <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0 0 var(--space-md)' }}>
        {route.announcementChannelId
          ? 'CWL roster posts go here. Transfer calls, strikes and lineup notices still go to each clan’s own channel — they are aimed at specific people.'
          : 'Not set — CWL roster posts go to each clan’s own channel. Set one to keep the standing roster out of the channels people watch for things aimed at them.'}
      </p>
      <ChannelIdField field="announcementChannelId" label="Announcement channel" />
      <p className="text-muted" style={{ fontSize: '0.7rem', margin: 0 }}>
        Changing this re-posts each clan’s roster into the new channel on the next roster post. The
        old ones stay where they are — delete them manually so nobody reads a stale roster.
      </p>

      <Divider />

      <SectionHeading icon={<ShieldAlert size={16} style={{ color: 'var(--color-cta)' }} />} title="LEADERSHIP CHANNEL" />
      <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0 0 var(--space-md)' }}>
        {route.leadershipChannelId
          ? 'Kick list alerts go here, pinging the Leadership role — when a kicked player, or an alt of one, joins a family clan — and so do hit-up reviews waiting to be confirmed or dismissed.'
          : 'Not set — kick list alerts and hit-up reviews go to the clan’s own channel, where members can read them, kick reason included. Point this at a channel only leadership can see.'}
      </p>
      <ChannelIdField field="leadershipChannelId" label="Leadership channel" />

      <Divider />

      <SectionHeading icon={<UserPlus size={16} style={{ color: 'var(--color-cta)' }} />} title="UNLINKED-JOIN CHANNEL" />
      <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0 0 var(--space-md)' }}>
        {route.unlinkedChannelId
          ? 'When a player with no linked person joins a family clan, an alert posts here and pings the Leadership role — unless that clan has its own join-alert channel or thread (Clans tab).'
          : 'Not set — unlinked-join alerts (which ping the Leadership role) go to the clan’s join-alert channel or thread if it has one (Clans tab), else the leadership channel, else the clan’s own channel.'}
      </p>
      <ChannelIdField field="unlinkedChannelId" label="Unlinked-join channel" />
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-lg) 0 var(--space-md)' }} />;
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
      {icon}
      <p style={{ fontWeight: 700, margin: 0, fontSize: '0.9rem' }}>{title}</p>
    </div>
  );
}

/**
 * Whether the bot can post here, and a check that it can SEE every channel it has been given — the
 * one thing a channel id cannot prove by being saved. Fail-safe sending would otherwise swallow a
 * channel the bot was never invited to.
 */
function BotStatus() {
  const route = useSettingsStore((s) => s.discordRoute);
  const check = useSettingsStore((s) => s.discordCheck);
  const checking = useSettingsStore((s) => s.checkingDiscord);
  const checkDiscordChannels = useSettingsStore((s) => s.checkDiscordChannels);
  const syncing = useSettingsStore((s) => s.syncingCommands);
  const syncDiscordCommands = useSettingsStore((s) => s.syncDiscordCommands);
  if (!route) return null;

  return (
    <div style={{ marginBottom: 'var(--space-lg)', padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
        <Bot size={16} style={{ color: route.botConfigured ? 'var(--color-cta)' : 'var(--color-muted)' }} />
        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
          {route.botConfigured ? 'Bot connected' : 'Bot not configured'}
        </span>
        <span className="text-muted" style={{ fontSize: '0.75rem', flex: '1 1 240px' }}>
          {route.botConfigured
            ? 'Every route posts through the bot. A route with no channel falls through to the next one.'
            : 'DISCORD_BOT_TOKEN is not set, so nothing is posted to Discord. Channels can be saved now and take over once it is.'}
        </span>
        {route.botConfigured && (
          <button className="btn btn-outline" style={{ fontSize: '0.7rem' }} disabled={checking} onClick={checkDiscordChannels}>
            {checking ? 'Checking…' : 'Check channel access'}
          </button>
        )}
        {route.botConfigured && (
          <button
            className="btn btn-outline"
            style={{ fontSize: '0.7rem' }}
            disabled={syncing}
            title="Push the slash commands to Discord — after setup, or after a command changes"
            onClick={syncDiscordCommands}
          >
            {syncing ? 'Syncing…' : 'Sync slash commands'}
          </button>
        )}
      </div>
      {check && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--space-sm) 0 0', fontSize: '0.75rem' }}>
          {check.checks.length === 0 && <li className="text-muted">No bot channels are set yet.</li>}
          {check.checks.map((c) => (
            <li key={`${c.label}-${c.channelId}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              {c.ok
                ? <CheckCircle2 size={13} style={{ color: 'var(--color-cta)' }} />
                : <XCircle size={13} style={{ color: 'var(--color-danger)' }} />}
              <span style={{ fontWeight: 600 }}>{c.label}</span>
              <span className="text-muted">{c.ok ? `#${c.name}` : c.error}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One route's bot channel id. Accepts a bare id, a `<#id>` mention or a channel link. */
function ChannelIdField({ field, label }: { field: DiscordChannelField; label: string }) {
  const current = useSettingsStore((s) => s.discordRoute?.[field] ?? null);
  const saving = useSettingsStore((s) => s.savingDiscordRoute);
  const saveDiscordRoute = useSettingsStore((s) => s.saveDiscordRoute);
  const [value, setValue] = useState('');

  return (
    <>
      <label style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
        {label}
        {current && (
          <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
            · currently <code style={{ fontSize: '0.7rem' }}>{current}</code>
          </span>
        )}
      </label>
      <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
        <input
          className="input"
          style={{ flex: '1 1 240px', minWidth: 0 }}
          autoComplete="off"
          placeholder="Channel id or link (right-click the channel → Copy Link)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="btn btn-outline"
          disabled={saving || !value.trim()}
          onClick={async () => {
            if (await saveDiscordRoute({ [field]: value.trim() })) setValue('');
          }}
        >
          Save channel
        </button>
        {current && (
          <button className="btn btn-outline" disabled={saving} onClick={() => saveDiscordRoute({ [field]: '' })}>
            Clear
          </button>
        )}
      </div>
    </>
  );
}
