/**
 * Pure renderer for a member PROFILE: one person (or one unlinked account) with every linked
 * account's clan, Town Hall and strike standing. Behind `/me` and `/whois`.
 *
 * Strike standing is shown PER ACCOUNT, matching the strike system: each alt is judged on its own,
 * so a person-level total would describe no account in particular.
 *
 * Two audiences. `self` is the member reading their own record; `leadership` additionally sees
 * dashboard access and kick-list status — the things a member has no business being told about
 * themselves through a bot command.
 */

import { COLOR_WARNING, discordTs, truncateField } from '@/lib/discord/format';
import type { DiscordEmbedField, DiscordMessage } from '@/lib/discord/types';
import { deriveStrikeStatus, type StrikeLite } from '@/lib/strikes/status';
import type { AccessRole, PlayerStatus } from '@/types/database';

export type ProfileAccount = {
  tag: string;
  name: string;
  thLevel: number | null;
  clanName: string | null;
  status: PlayerStatus;
  isMain: boolean;
  strikes: StrikeLite[];
  kicked: boolean;
};

export type Profile = {
  personName: string | null; // null = the account is not linked to a person
  discordUserId: string | null;
  accessRole: AccessRole | null;
  accounts: ProfileAccount[];
};

const ROLE_LABEL: Record<AccessRole, string> = {
  super_admin: 'Super admin',
  leader: 'Leader',
  co_leader: 'Co-leader',
};

const STATUS_LABEL: Record<PlayerStatus, string> = {
  active: '',
  left: ' · left the family',
  removed: ' · removed',
  inactive: ' · inactive',
};

export function renderProfile(profile: Profile, opts: { now: Date; audience: 'self' | 'leadership' }): DiscordMessage {
  const { now, audience } = opts;

  // Active accounts first, then the main account, then by name — the order a reader scans for.
  const accounts = [...profile.accounts].sort(
    (a, b) =>
      Number(b.status === 'active') - Number(a.status === 'active') ||
      Number(b.isMain) - Number(a.isMain) ||
      a.name.localeCompare(b.name),
  );

  let worst = 0;
  const fields: DiscordEmbedField[] = accounts.map((a) => {
    const st = deriveStrikeStatus(a.strikes, now);
    worst = Math.max(worst, st.activeCount);
    const lines = [
      `${a.clanName ?? 'Not in a family clan'}${a.thLevel ? ` · TH${a.thLevel}` : ''}${STATUS_LABEL[a.status]}`,
      st.activeCount === 0
        ? 'No active strikes'
        : `**${st.activeCount}** active strike${st.activeCount === 1 ? '' : 's'}` +
          (st.nextExpiry ? ` · next expires ${discordTs(st.nextExpiry, 'R')}` : ''),
      st.warEligible ? '✅ War-eligible' : '⛔ Not war-eligible until trust is restored',
    ];
    if (audience === 'leadership' && a.kicked) lines.push('🚫 On the kick list');
    return {
      name: `${a.isMain ? '⭐ ' : ''}${a.name} (${a.tag})`,
      value: truncateField(lines.join('\n')),
      inline: false,
    };
  });

  const header: string[] = [];
  if (profile.personName === null) header.push('This account is **not linked** to a person.');
  if (audience === 'leadership') {
    if (profile.discordUserId) header.push(`Discord: <@${profile.discordUserId}>`);
    if (profile.accessRole) header.push(`Dashboard access: **${ROLE_LABEL[profile.accessRole]}**`);
  }
  if (accounts.length === 0) header.push('No accounts are linked yet.');

  return {
    // Mentions inside an embed never notify, and none are allowed anyway: a lookup must not ping.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: profile.personName ?? accounts[0]?.name ?? 'Unknown player',
        description: header.join('\n') || undefined,
        color: worst >= 3 ? 0xef4444 : worst >= 1 ? COLOR_WARNING : 0x22c55e,
        fields: fields.slice(0, 25), // Discord's per-embed field cap
        footer: { text: 'ClanOps · strikes are counted per account over a rolling 90 days' },
      },
    ],
  };
}
