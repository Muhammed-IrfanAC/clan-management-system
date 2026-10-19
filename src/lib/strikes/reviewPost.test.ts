import { describe, it, expect } from 'vitest';
import { decodeCustomId } from '@/lib/discord/interactions/customId';
import { renderReviewSuggestion, REVIEW_NS } from './reviewPost';

const POST = {
  suggestionId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  memberName: 'Sn*per',
  playerTag: '#ABC',
  clanName: 'Alpha',
  ruleName: 'Unjustified hit-up',
  warLabel: 'vs Rivals',
  description: 'Hit #3 from #12',
  occurredAt: '2026-10-19T12:00:00Z',
};

describe('renderReviewSuggestion', () => {
  it('describes the suggestion without pinging anyone', () => {
    const msg = renderReviewSuggestion(POST);
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.content).toBeUndefined();
    const e = msg.embeds![0];
    expect(e.title).toBe('⚖️ Review: Unjustified hit-up');
    expect(e.description).toBe('**Sn\\*per** `#ABC`\nAlpha · vs Rivals');
    expect(e.fields![0].value).toBe('Hit #3 from #12');
    expect(e.fields![1].value).toBe('<t:1792411200:f>');
  });

  it('offers Confirm and Dismiss carrying the suggestion id', () => {
    const buttons = renderReviewSuggestion(POST).components![0].components;
    expect(buttons.map((b) => decodeCustomId(b.custom_id))).toEqual([
      { namespace: REVIEW_NS, version: 1, args: [POST.suggestionId, 'confirm'] },
      { namespace: REVIEW_NS, version: 1, args: [POST.suggestionId, 'dismiss'] },
    ]);
  });
});
