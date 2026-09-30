/**
 * Starting a person's journey — the first per-user journey the app creates.
 *
 * A person's journey begins when they pass the gate (§15, t-102). This is the
 * one function that does it, and it has two callers:
 *
 * - `POST /api/v1/app/acknowledgements`, on the write that turns the gate
 *   complete — the ordinary path.
 * - The shell layout, on entry, as a **backstop**: accounts that passed the gate
 *   before this shipped never post again, and a journey whose start failed
 *   after the acknowledgement landed would otherwise never be retried.
 *
 * Starting means two framework calls, in order: `createJourney` on
 * `JOURNEY_MAP_SLUG`, then an `enter` of the onboarding node through
 * `applyJourneyTransition`. The node has to be entered because
 * `recordNodeProgress` refuses a node that never was, and onboarding's
 * once-only beats are recorded there.
 *
 * ## Idempotent, and cheap when there is nothing to do
 *
 * `createJourney` is idempotent on its natural key, but an `enter` is not
 * idempotent in the log: every accepted `enter` appends a `node.entered` event,
 * even when the node was already active. So this reads first and enters only
 * when the journey has no node state at all — a journey that has been entered
 * anywhere has started, and re-entering onboarding for someone already in
 * Values would move them backwards. The same read makes the backstop cost two
 * indexed queries on a shell entry for everyone who already has a journey.
 *
 * Two concurrent first calls can both see no node state and both enter. The
 * projection converges (an `enter` upserts to `active`); the log gains a
 * second `node.entered`. Accepted: the window is one person racing their own
 * first request, and the log is read as a timeline, not counted.
 *
 * ## The map must be published
 *
 * `createJourney` does not check its slug against a published map (Daybreak's
 * decision, recorded in its docblock), so a journey on an unpublished or
 * mistyped slug is silently inert. This checks first and reports
 * `unpublished` rather than creating one — a fresh database before `db:seed`
 * gets its journeys on the first shell entry after the seed runs.
 *
 * ## `onFirstArrival` is not wired
 *
 * Ruling at planning (§15): the app renders the welcome itself. Nothing here
 * dispatches the node's hook, and our map sets none.
 *
 * ## It never throws
 *
 * Both callers have something more important to do: the acknowledgement route
 * has just recorded the legal floor, and the layout is rendering the shell.
 * Neither may fail because a journey could not be started, so a failure is
 * logged and answered as `failed`, and the next shell entry retries it.
 *
 * @see lib/framework/facilitation/journey/create.ts — `createJourney`
 * @see lib/framework/guidance/guidance.ts — `applyJourneyTransition`
 */

import { getJourney, getNodeStates } from '@/lib/framework/facilitation/journey/queries';
import { createJourney } from '@/lib/framework/facilitation/journey/create';
import { applyJourneyTransition } from '@/lib/framework/guidance/guidance';
import { getPublishedMapVersion } from '@/lib/framework/facilitation/map/version-service';
import { JOURNEY_MAP_SLUG, ONBOARDING_NODE_KEY } from '@/lib/app/journey/map-definition';
import { logger } from '@/lib/logging';

/**
 * What {@link ensureJourneyStarted} did.
 *
 * - `started` — this call entered the onboarding node.
 * - `already` — the journey had been entered before; nothing written.
 * - `unpublished` — no published map to start a journey on; nothing written.
 * - `failed` — a framework call refused or threw; logged, retried next entry.
 */
export type JourneyStartOutcome = 'started' | 'already' | 'unpublished' | 'failed';

/**
 * Start `userId`'s journey and enter onboarding, unless it has started already.
 * Acts as the person themself — both callers are that person's own request.
 */
export async function ensureJourneyStarted(userId: string): Promise<JourneyStartOutcome> {
  const viewer = { userId };
  const key = { userId, graphSlug: JOURNEY_MAP_SLUG };

  try {
    const existing = await getJourney(viewer, key);
    if (existing) {
      const states = await getNodeStates(viewer, { journeyId: existing.id, subject: userId });
      if (states.length > 0) return 'already';
    }

    if ((await getPublishedMapVersion(JOURNEY_MAP_SLUG)) === null) {
      logger.warn('Journey not started: the journey map is not published', {
        userId,
        map: JOURNEY_MAP_SLUG,
      });
      return 'unpublished';
    }

    if (!existing) await createJourney(viewer, key);

    const result = await applyJourneyTransition(viewer, key, {
      nodeKey: ONBOARDING_NODE_KEY,
      kind: 'enter',
    });
    if (result === null || !result.ok) {
      logger.error('Journey started but onboarding could not be entered', undefined, {
        userId,
        map: JOURNEY_MAP_SLUG,
        rejection: result === null ? 'journey_not_found' : result.rejection.code,
      });
      return 'failed';
    }

    logger.info('Journey started', { userId, map: JOURNEY_MAP_SLUG, node: ONBOARDING_NODE_KEY });
    return 'started';
  } catch (error) {
    logger.error('Journey could not be started', error, { userId, map: JOURNEY_MAP_SLUG });
    return 'failed';
  }
}
