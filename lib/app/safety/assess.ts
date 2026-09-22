/**
 * The crisis path's entry point (f-safety t-58; product description §12).
 *
 * Three calls, in the order a caller makes them:
 *
 * 1. `detectCrisis(text, locale, who)` — decides the tier, asks the context
 *    check on a hard hit, and resolves the resource. Writes nothing.
 * 2. `crisisFrame(assessment.resource)` (`resource.ts`) — the response.
 * 3. `recordCrisisShown(assessment, who)` — once the frame is actually on its
 *    way to the person, and not before.
 *
 * The record is its own call because deciding and showing are not the same
 * event: a soft hit on a retry that is refused (409) carries no stream, so it
 * shows nothing, and a record written at decision time would say it had
 * (found by /code-review). The turn seam calls all three today; the pre-signup
 * conversation calls the same three, unchanged, with a `null` user — the
 * feature's standing rule.
 *
 * **Nothing in here withholds the resource by choice.** Detection is pure. The
 * context check can only soften a hard hit to soft, and never throws. A failed
 * record write is logged, not raised: the person is owed the resource whether
 * or not the row was kept.
 *
 * **Resolving the resource CAN throw, since t-88.** It used to serve a bundled
 * file when the tables could not answer; there is no file any more, so an
 * unreadable database raises here and the turn fails rather than answering a
 * person in danger with nothing. `resources-store.ts` says why the two states
 * that used to reach the fallback are now unreachable instead, which is what
 * makes that acceptable: what is left is a database that cannot be read, and
 * then the app is down anyway.
 *
 * @see lib/app/agent/turns.ts — where a turn calls it, and what it does next
 * @see .context/app/safety.md
 */

import { logger } from '@/lib/logging';
import { checkCrisisContext, type ContextCheckOutcome } from '@/lib/app/safety/context-check';
import { detectCrisisTier, type CrisisCategory, type CrisisTier } from '@/lib/app/safety/detect';
import { recordCrisisEvent } from '@/lib/app/safety/record';
import { resolveCrisisResource, type CrisisResource } from '@/lib/app/safety/resource';

export interface CrisisAssessment {
  /** What the turn acts on. */
  tier: CrisisTier;
  /** What the phrase list said, before the context check. */
  detectedTier: CrisisTier;
  categories: CrisisCategory[];
  contextCheck: ContextCheckOutcome;
  /** The language tag the resource was chosen from. */
  locale: string | null;
  /** The resource to show — present exactly when `tier` is not `none`. */
  resource: CrisisResource | null;
}

export interface CrisisSubject {
  /** Null before signup. */
  userId: string | null;
  /** The seat, or the pre-signup surface's name. */
  seat: string;
}

/**
 * Assess a message.
 *
 * Detection is pure and the context check turns every failure into an outcome,
 * so the tiering cannot throw — but `resolveCrisisResource` can (t-88), and
 * this does not catch it. A crisis turn with an unreadable database fails
 * rather than answering without a helpline.
 */
export async function detectCrisis(
  text: string,
  locale: string | null,
  who: CrisisSubject
): Promise<CrisisAssessment> {
  const detection = detectCrisisTier(text);
  if (detection.tier === 'none') {
    return {
      tier: 'none',
      detectedTier: 'none',
      categories: [],
      contextCheck: 'not_run',
      locale,
      resource: null,
    };
  }

  const contextCheck: ContextCheckOutcome =
    detection.tier === 'hard'
      ? await checkCrisisContext({ message: text, userId: who.userId, seat: who.seat })
      : 'not_run';
  // The only move the check can make. Every other outcome leaves the tier as detected.
  const tier: 'soft' | 'hard' = contextCheck === 'softened' ? 'soft' : detection.tier;

  return {
    tier,
    detectedTier: detection.tier,
    categories: detection.categories,
    contextCheck,
    locale,
    resource: await resolveCrisisResource(locale, tier),
  };
}

/**
 * Record that the resource was shown. Call it when the frame is on its way, and
 * only then. A no-op for an assessment that matched nothing; never throws.
 */
export async function recordCrisisShown(
  assessment: CrisisAssessment,
  who: CrisisSubject
): Promise<void> {
  const { resource } = assessment;
  if (resource === null || assessment.detectedTier === 'none') return;

  const event = {
    userId: who.userId,
    seat: who.seat,
    detectedTier: assessment.detectedTier,
    actedTier: resource.tier,
    categories: assessment.categories,
    contextCheck: assessment.contextCheck,
    locale: assessment.locale,
    resourceRegion: resource.region,
  };
  // Logged without the person: the log is read more widely than the table.
  const { userId: _userId, ...logged } = event;
  logger.info('Crisis language detected; resource shown', logged);
  try {
    await recordCrisisEvent(event);
  } catch (err) {
    logger.error('Crisis event record write failed; the resource was still shown', {
      ...logged,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
