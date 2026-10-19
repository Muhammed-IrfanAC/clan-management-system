/**
 * Confirm / Dismiss on a hit-up review alert (`strikes/reviewPost.ts`). Same bar as the dashboard's
 * review queue — dashboard access — and the same code path (`strikes/review.ts`), so a click here is
 * a click there: one winner when two leaders race, never a second strike for a war.
 *
 * Deferred, because a confirm writes the strike and posts the member's strike notice before it can
 * report back. Whatever happens, the alert ends up saying who settled it — including when somebody
 * else already did, from Discord or the dashboard, which is how a stale alert heals itself.
 */

import { namesForTags } from '@/lib/kicks/kickList';
import { reviewSuggestion } from '@/lib/strikes/review';
import { REVIEW_NS } from '@/lib/strikes/reviewPost';
import { isLeadership } from '../actor';
import { byUser, stampResolution } from '../resolution';
import { ephemeral, type HandlerResult } from '../types';
import type { ComponentHandler } from './registry';

export const reviewButtons: ComponentHandler = {
  namespace: REVIEW_NS,
  async run(interaction, actor, id): Promise<HandlerResult> {
    if (!isLeadership(actor) || !actor.actorTag) return ephemeral('Reviewing strikes is for leadership.');
    const [suggestionId, action] = id.args;
    if (id.version !== 1 || !suggestionId || (action !== 'confirm' && action !== 'dismiss')) {
      return ephemeral('This button is no longer active.');
    }

    return {
      kind: 'deferUpdate',
      work: async () => {
        const outcome = await reviewSuggestion(suggestionId, action, actor.actorTag!);
        if (outcome.ok) {
          const line = outcome.status === 'confirmed'
            ? `✅ Strike confirmed by ${byUser(actor.discordUserId)}`
            : `🗑️ Dismissed by ${byUser(actor.discordUserId)}`;
          return stampResolution(interaction.message, line);
        }
        if (outcome.code === 409 && outcome.current) {
          const by = outcome.current.reviewedBy
            ? (await namesForTags([outcome.current.reviewedBy])).get(outcome.current.reviewedBy) ?? outcome.current.reviewedBy
            : 'someone';
          return stampResolution(interaction.message, `Already ${outcome.current.status} by ${by}`);
        }
        if (outcome.code === 404) return stampResolution(interaction.message, '⚠️ This review no longer exists');
        throw new Error(outcome.error);
      },
    };
  },
};
