import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, commit: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('./commit', () => ({ commitReviewStrike: h.commit }));

import { reviewSuggestion } from './review';

const suggestion = (over: Record<string, unknown> = {}) => ({
  id: 's1', status: 'pending', reviewed_by: null, reviewed_at: null, strike_id: null, rule_id: 'r1', person_id: 'p1',
  player_account_tag: '#A', clan_id: 'c1', war_source: 'regular', war_round_id: 'w1', war_label: 'vs X',
  description: 'hit up', dedup_key: 'k1', occurred_at: '2026-10-18T00:00:00Z', member_name: 'A', ...over,
});

beforeEach(() => {
  h.db = createClanOpsDb();
  h.db.seed('rules', [{ id: 'r1', name: 'Hit-up' }]);
  h.commit.mockReset().mockResolvedValue({ strikeId: 'st1', created: true });
});

describe('reviewSuggestion', () => {
  it('confirms: folds into the war strike, attributed to the actor, and links the strike', async () => {
    h.db.seed('strike_suggestions', [suggestion()]);
    expect(await reviewSuggestion('s1', 'confirm', '#LEAD')).toEqual({ ok: true, status: 'confirmed', strikeId: 'st1' });
    expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({ actorTag: '#LEAD', ruleName: 'Hit-up', dedupKey: 'k1' }));
    expect(h.db.find('strike_suggestions', 's1')).toMatchObject({ status: 'confirmed', reviewed_by: '#LEAD', strike_id: 'st1' });
  });

  it('dismisses without a strike', async () => {
    h.db.seed('strike_suggestions', [suggestion()]);
    expect(await reviewSuggestion('s1', 'dismiss', '#LEAD')).toEqual({ ok: true, status: 'dismissed', strikeId: null });
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('refuses one that is already settled, saying by whom', async () => {
    h.db.seed('strike_suggestions', [suggestion({ status: 'dismissed', reviewed_by: '#OTHER' })]);
    expect(await reviewSuggestion('s1', 'confirm', '#LEAD')).toMatchObject({
      ok: false, code: 409, current: { status: 'dismissed', reviewedBy: '#OTHER' },
    });
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('hands it back to pending when the strike cannot be written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.db.seed('strike_suggestions', [suggestion()]);
    h.commit.mockResolvedValue({ strikeId: null, created: false });
    expect(await reviewSuggestion('s1', 'confirm', '#LEAD')).toMatchObject({ ok: false, code: 500 });
    expect(h.db.find('strike_suggestions', 's1')).toMatchObject({ status: 'pending', reviewed_by: null });
  });

  it('404s an unknown suggestion', async () => {
    expect(await reviewSuggestion('nope', 'dismiss', '#LEAD')).toMatchObject({ ok: false, code: 404 });
  });
});
