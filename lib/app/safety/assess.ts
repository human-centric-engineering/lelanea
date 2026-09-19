/**
 * The crisis path's one entry point (f-safety t-58; product description §12).
 *
 * `detectCrisis(text, locale, who)` decides the tier, asks the context check on
 * a hard hit, resolves the resource, and records the event. `crisisFrame()`
 * (`resource.ts`) is the response builder. The turn seam calls the pair today;
 * the pre-signup conversation calls the same pair, unchanged, with a `null`
 * user — the feature's standing rule.
 *
 * **Nothing in here can withhold the resource.** Detection is pure. The context
 * check can only soften a hard hit to soft, and never throws. The record is
 * written before the answer is returned but a failed write is logged, not
 * raised: the person is owed the resource whether or not the row was kept.
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
  /** The resource to show — present exactly when `tier` is not `none`. */
  resource: CrisisResource | null;
}

export interface CrisisSubject {
  /** Null before signup. */
  userId: string | null;
  /** The seat, or the pre-signup surface's name. */
  seat: string;
}

const NOTHING: CrisisAssessment = {
  tier: 'none',
  detectedTier: 'none',
  categories: [],
  contextCheck: 'not_run',
  resource: null,
};

/**
 * Assess a message. Never throws for a message that matched nothing, and never
 * throws once it has matched: the resource comes back even if the record could
 * not be written.
 */
export async function detectCrisis(
  text: string,
  locale: string | null,
  who: CrisisSubject
): Promise<CrisisAssessment> {
  const detection = detectCrisisTier(text);
  if (detection.tier === 'none') return NOTHING;

  const contextCheck: ContextCheckOutcome =
    detection.tier === 'hard'
      ? await checkCrisisContext({ message: text, userId: who.userId, seat: who.seat })
      : 'not_run';
  // The only move the check can make. Every other outcome leaves the tier as detected.
  const tier: 'soft' | 'hard' = contextCheck === 'softened' ? 'soft' : detection.tier;
  const resource = resolveCrisisResource(locale, tier);

  const event = {
    userId: who.userId,
    seat: who.seat,
    detectedTier: detection.tier,
    actedTier: tier,
    categories: detection.categories,
    contextCheck,
    locale,
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

  return {
    tier,
    detectedTier: detection.tier,
    categories: detection.categories,
    contextCheck,
    resource,
  };
}
