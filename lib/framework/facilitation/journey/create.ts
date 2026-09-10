/**
 * `createJourney` (#159) — the seam that **starts** a journey.
 *
 * `f-journey-state` shipped the three journey tables deliberately without a writer
 * ("writes deferred to `f-engine`"), and `f-engine` then shipped the *transition*
 * writer only: `applyEvent` is the sole writer of journey **state** and takes an
 * already-existing `journeyId`. Nothing ever created the `UserJourney` row those
 * transitions hang off — the gap is visible in `getJourney`'s own docblock ("`null`
 * if they have not started it — **no writer yet**"). So the first leaf to start a
 * run wrote `prisma.userJourney.create` itself, which is exactly the leaf-reaches-
 * into-`framework_*` shape the framework tier exists to prevent.
 *
 * This is the counterpart to `applyJourneyTransition`: **create the journey, then
 * transition it.** It writes the `UserJourney` row and nothing else — no node
 * states, no events. `applyEvent` remains the sole writer of state.
 *
 * ## The four decisions behind the signature
 *
 * 1. **Guarded by {@link canWrite}, not by `canRead`.** The first draft used
 *    `canRead` — one access seam, default-deny inherited, and the existing write
 *    path (`applyJourneyTransition` via `assembleJourneyContext`) already authorizes
 *    writes through a read. Review pushed back, correctly: `canRead` is documented
 *    as widening `own → team → all` when Sunrise #367's ownership resolver lands,
 *    and that widening is about *reading* a cohort. Guarding creation on it would
 *    hand every future cohort-reader the right to create journeys for those
 *    subjects, silently, with no diff to this file. `canWrite` pins the write grant
 *    to self-or-admin-support so widening it is a visible edit. It composes with
 *    `canRead` rather than replacing it — see `shared/access.ts`.
 * 2. **Idempotent on the natural key** `@@unique([userId, graphSlug, contextKey])`,
 *    returning the existing row untouched rather than throwing. A double-submitted
 *    "start" is ordinary client behaviour, and the natural key already *is* a run's
 *    identity — two calls with the same `contextKey` are asking for the same
 *    journey, not for two. `startedAt` therefore never moves once set.
 * 3. **The caller supplies `contextKey`; the framework never mints one.** This is
 *    the more general of the two shapes: a leaf wanting a fresh run per call passes
 *    its own id, and a leaf with one journey per map passes nothing and takes the
 *    `''` sentinel (X3). A `startJourney()` that minted keys would foreclose the
 *    first case. **This also settles the `contextKey` ↔ `runId` identity** that
 *    #167 resolves runs by — one definition, in one place.
 * 4. **No `journey.started` event.** The event stream is the source of truth (F10),
 *    so emitting one is arguable — but no consumer exists, `f-engagement-analytics`
 *    already dropped `session.started` on hot-path cost, and adding one later is
 *    additive and migration-free. Recorded so the omission reads as a decision.
 *
 * ## What this deliberately does NOT validate
 *
 * **`graphSlug` is not checked against a published map.** `UserJourney.graphSlug` is
 * a plain string by design (F2) — not an FK — because the engine takes the graph as
 * an *input*: `applyEvent` walks a `GraphStore` the caller supplies, which is why
 * `scripts/smoke/engine.ts` legitimately drives a journey against an in-memory
 * one-node graph that was never published. Rejecting unpublished slugs here would
 * refuse that supported pattern to catch a typo.
 *
 * The cost is worth naming: a journey created against a slug with no published
 * version makes {@link assembleJourneyContext} return `null` — indistinguishable
 * from "not started" — so a leaf that mistypes a slug sees a silently inert run.
 * Publish the map before starting journeys against it.
 */

import { Prisma } from '@prisma/client';
import type { UserJourney } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { ForbiddenError } from '@/lib/api/errors';
import { canWrite, type JourneyViewer, type AccessScope } from '@/lib/framework/shared/access';
import type { JourneyKey } from '@/lib/framework/facilitation/journey/queries';

/**
 * Start `key`'s journey, or return the one already started. Idempotent on the
 * natural key: calling twice yields the same row with its original `startedAt`.
 *
 * The viewer is gated against the journey's owner (`key.userId`) **before any
 * write** — a denied call throws `ForbiddenError` without touching the database,
 * mirroring the read queries. The gate is {@link canWrite}, which is deliberately
 * narrower than the `canRead` guarding those reads (see decision 1).
 *
 * @throws {ForbiddenError} when `viewer` may not act for `key.userId`.
 */
export async function createJourney(
  viewer: JourneyViewer,
  key: JourneyKey,
  scope?: AccessScope
): Promise<UserJourney> {
  if (!(await canWrite(viewer, key.userId, scope))) {
    throw new ForbiddenError('Not permitted to start this journey');
  }

  const naturalKey = {
    userId: key.userId,
    graphSlug: key.graphSlug,
    contextKey: key.contextKey ?? '', // '' is the default, context-free journey (X3)
  };

  try {
    return await prisma.userJourney.upsert({
      where: { userId_graphSlug_contextKey: naturalKey },
      create: naturalKey,
      // Empty on purpose: an already-started run is returned AS IT STANDS. Writing
      // anything here (a touched `startedAt`, say) would make a second "start"
      // observably different from the first, which is the opposite of idempotent.
      update: {},
    });
  } catch (err) {
    // P2002: two concurrent starts of the same run both found no row inside Prisma's
    // upsert, and the loser hit the unique index. Idempotency has to hold under the
    // race as well as without it, so the loser reads the winner's row instead of
    // failing — the same "the DB is the arbiter" discipline `applyEvent`'s
    // conditional-update path uses for a racing `complete`.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return prisma.userJourney.findUniqueOrThrow({
        where: { userId_graphSlug_contextKey: naturalKey },
      });
    }
    throw err;
  }
}
