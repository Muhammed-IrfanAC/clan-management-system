'use client';

import { useState } from 'react';
import { Plus, Trash2, Hash, UserPlus } from 'lucide-react';
import { useSettingsStore, type ClanChannelColumn } from '@/lib/stores/settingsStore';
import type { RuleAutomationMode } from '@/types/database';
import type { Confirm } from './types';

// Clan family tab: register/remove family clans, set each clan's rule-automation scope, its bot
// channel (migration 037 — where the bot posts this clan's notices) and its join-alert channel or
// thread (migration 039 — where this clan's unlinked-join alerts go instead of the shared one).
export default function ClansTab({ onAdd, confirm }: { onAdd: () => void; confirm: Confirm }) {
  const clans = useSettingsStore((s) => s.clans);
  const updateClanAutomation = useSettingsStore((s) => s.updateClanAutomation);
  const removeClan = useSettingsStore((s) => s.removeClan);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
        <h3>Clan Family</h3>
        <button onClick={onAdd} className="btn btn-primary" style={{ fontSize: '0.75rem' }}><Plus size={16} /> Add Clan</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {clans.map((c) => (
          // Wraps rather than overflowing: with two channel buttons and the automation select the
          // controls are wider than a phone, so they drop below the name and wrap among themselves.
          <div key={c.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm) var(--space-md)' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontWeight: '700' }}>{c.display_name}</span>
              <span className="text-muted" style={{ marginLeft: 'var(--space-md)' }}>{c.clan_tag}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm) var(--space-md)', alignItems: 'center', minWidth: 0 }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textTransform: 'uppercase' }}>{c.clan_type}</span>
              <ClanChannel id={c.id} name={c.display_name} channelId={c.discord_channel_id ?? null} />
              <ClanChannel
                id={c.id}
                name={c.display_name}
                channelId={c.discord_join_channel_id ?? null}
                column="discord_join_channel_id"
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.7rem', color: 'var(--color-muted)' }} title="When the rule detectors act on this clan's wars">
                <span style={{ textTransform: 'uppercase' }}>Automation</span>
                <select
                  className="input"
                  value={c.rule_automation_mode ?? 'always'}
                  onChange={(e) => updateClanAutomation(c.id, e.target.value as RuleAutomationMode)}
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
                  aria-label={`Rule automation for ${c.display_name}`}
                >
                  <option value="always">Always</option>
                  <option value="cwl_only">CWL only</option>
                  <option value="never">Never</option>
                </select>
              </label>
              <button
                onClick={() =>
                  confirm({
                    title: 'Remove Clan',
                    message: `Permanently remove ${c.display_name}? Accounts will remain but lose clan affiliation.`,
                    action: () => removeClan(c.id),
                  })
                }
                style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const CHANNEL_COPY: Record<ClanChannelColumn, { unset: string; title: string; label: string }> = {
  discord_channel_id: {
    unset: 'Set bot channel',
    title: "The channel the bot posts this clan's notices to",
    label: 'Bot channel',
  },
  discord_join_channel_id: {
    unset: 'Set join alerts',
    title: "Channel or thread for this clan's unlinked-join alerts. Unset: the shared unlinked-join channel",
    label: 'Join-alert channel or thread',
  },
};

/** One of the clan's bot destinations: shows the stored id, edits inline. Blank + save clears it. */
function ClanChannel({ id, name, channelId, column = 'discord_channel_id' }: {
  id: string;
  name: string;
  channelId: string | null;
  column?: ClanChannelColumn;
}) {
  const updateClanChannel = useSettingsStore((s) => s.updateClanChannel);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const copy = CHANNEL_COPY[column];

  if (!editing) {
    return (
      <button
        className="btn btn-outline"
        style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}
        title={copy.title}
        onClick={() => { setValue(channelId ?? ''); setEditing(true); }}
      >
        {column === 'discord_join_channel_id' ? <UserPlus size={12} /> : <Hash size={12} />} {channelId ?? copy.unset}
      </button>
    );
  }
  return (
    <form
      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: '1 1 260px', maxWidth: '100%' }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await updateClanChannel(id, value.trim(), column)) setEditing(false);
      }}
    >
      <input
        className="input"
        autoFocus
        style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem', flex: '1 1 160px', minWidth: 0 }}
        placeholder={column === 'discord_join_channel_id' ? 'Channel or thread link' : 'Channel id or link'}
        aria-label={`${copy.label} for ${name}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn btn-outline" style={{ fontSize: '0.7rem' }}>Save</button>
      <button type="button" className="btn btn-outline" style={{ fontSize: '0.7rem' }} onClick={() => setEditing(false)}>Cancel</button>
    </form>
  );
}
