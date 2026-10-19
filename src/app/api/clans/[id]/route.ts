import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';
import { normalizeChannelId } from '@/lib/discord/format';
import type { RuleAutomationMode } from '@/types/database';

const RULE_AUTOMATION_MODES: RuleAutomationMode[] = ['always', 'cwl_only', 'never'];

// PATCH /api/clans/:id — update a clan's config: `rule_automation_mode` (whether the rule detectors
// act on this clan's wars: always / cwl_only / never) and/or `discord_channel_id` (the bot's channel
// for this clan, migration 037; blank clears it back to the clan webhook). Gated by clan management.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireAuth(request);
    await requireCapability(auth, 'clan.create');

    const body = await request.json().catch(() => ({}));
    const update: Record<string, unknown> = {};

    if ('rule_automation_mode' in body) {
      if (!RULE_AUTOMATION_MODES.includes(body.rule_automation_mode)) {
        return NextResponse.json({ error: 'Invalid rule_automation_mode' }, { status: 400 });
      }
      update.rule_automation_mode = body.rule_automation_mode;
    }

    if ('discord_channel_id' in body) {
      const raw = typeof body.discord_channel_id === 'string' ? body.discord_channel_id.trim() : '';
      const channelId = normalizeChannelId(raw);
      if (raw && !channelId) {
        return NextResponse.json({ error: 'That is not a Discord channel id or channel link' }, { status: 400 });
      }
      update.discord_channel_id = channelId;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('clans')
      .update(update)
      .eq('id', id)
      .select('id, rule_automation_mode, discord_channel_id')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return authErrorResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireAuth(request);
    await requireCapability(auth, 'clan.create');
    const { error } = await supabase.from('clans').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return authErrorResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }
}
