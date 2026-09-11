/**
 * Journey read queries (f-journey-state t-2) — the `canRead`-guarded reads the
 * deterministic engine (`f-engine`, 11) and guidance layer (`f-guidance`, 12)
 * consume over the journey-state tables. Mirrors `map/queries.ts`: raw `prisma`,
 * throws rather than swallowing, one testable place per read.
 *
 * **Every read routes through {@link canRead} first** (convention X2). The viewer
 * is gated against the *named* subject before any Prisma call — a denied read
 * throws `ForbiddenError` without touching the database. As a second, in-query
 * guard the node-state / timeline reads also constrain rows to the subject's
 * ownership (`journey.userId` / `JourneyEvent.userId`), so a caller that pairs a
 * `journeyId` with the wrong `subject` gets an empty result, never another user's
 * rows — the access decision and the row filter agree.
 *
 * This *file* ships no writer — these reads are the consumer side of the tables t-1
 * shipped. The three writers live elsewhere and are split on purpose: **state
 * transitions** are `applyEvent` (`f-engine`, F11), the sole writer of the node
 * lifecycle projection and the event log; **journey creation** is `createJourney`
 * (`create.ts`, #159); and the module-owned `UserNodeState.progress` payload — which
 * the engine treats as opaque — is `recordNodeProgress` (`progress.ts`, #168).
 * f-journey-state's own note said creation was `f-engine`'s too, which turned out to
 * be nobody's — see #159.
 */

import { Prisma } from '@prisma/client';
import type { UserJourney, UserNodeState, JourneyEvent } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { ForbiddenError } from '@/lib/api/errors';
import {
  canRead,
  subjectScope,
  type JourneyViewer,
  type AccessScope,
} from '@/lib/framework/shared/access';

/** Identifies one journey by its natural `@@unique([userId, graphSlug, contextKey])` key. */
export interface JourneyKey {
  /** The owning user (the access subject). */
  userId: string;
  /** The map being walked. */
  graphSlug: string;
  /** Parallel-instance discriminator; `''` is the default, context-free journey (X3). */
  contextKey?: string;
}

/** Identifies journey-scoped rows (node states / events) plus their owning subject. */
export interface JourneyScopedKey {
  /** The journey these rows hang off (`UserJourney.id`). */
  journeyId: string;
  /** The journey owner's user id — the access subject `canRead` gates against. */
  subject: string;
}

/** Narrowing options for {@link getJourneyTimeline}. */
export interface JourneyTimelineOptions {
  /** Chronological (`'asc'`, default) or most-recent-first (`'desc'`). */
  order?: 'asc' | 'desc';
  /**
   * Non-negative cap on the number of events returned. Omitted ⇒ the full
   * timeline; `0` ⇒ none. Passed straight to Prisma `take`, so a **negative**
   * value takes rows from the *opposite* end of the ordering — callers must not
   * pass one.
   */
  limit?: number;
}

/**
 * One user's journey on a map, by its natural key — or `null` if they have not
 * started it (`createJourney` is what starts one; a fresh fork has none). The viewer
 * is gated against the journey's owner (`key.userId`) before any query runs.
 */
export async function getJourney(
  viewer: JourneyViewer,
  key: JourneyKey,
  scope?: AccessScope
): Promise<UserJourney | null> {
  if (!(await canRead(viewer, key.userId, scope))) {
    throw new ForbiddenError('Not permitted to read this journey');
  }
  return prisma.userJourney.findUnique({
    where: {
      userId_graphSlug_contextKey: {
        userId: key.userId,
        graphSlug: key.graphSlug,
        contextKey: key.contextKey ?? '',
      },
    },
  });
}

/**
 * The node-state projection for one journey, ordered by `nodeKey` for a stable
 * read. Gated on `key.subject`; the `journey.userId` filter also holds the rows to
 * that subject, so a `journeyId`/`subject` mismatch yields `[]` rather than another
 * user's states. Served by `@@unique([journeyId, nodeKey])`.
 */
export async function getNodeStates(
  viewer: JourneyViewer,
  key: JourneyScopedKey,
  scope?: AccessScope
): Promise<UserNodeState[]> {
  if (!(await canRead(viewer, key.subject, scope))) {
    throw new ForbiddenError('Not permitted to read this journey');
  }
  return prisma.userNodeState.findMany({
    where: { journeyId: key.journeyId, journey: { userId: key.subject } },
    orderBy: { nodeKey: 'asc' },
  });
}

/**
 * The event timeline for one journey (§5.2), ordered by `occurredAt` (chronological
 * by default) and served by `@@index([journeyId, occurredAt])`. Gated on
 * `key.subject`; the `userId` filter also holds the rows to that subject.
 */
export async function getJourneyTimeline(
  viewer: JourneyViewer,
  key: JourneyScopedKey,
  options?: JourneyTimelineOptions,
  scope?: AccessScope
): Promise<JourneyEvent[]> {
  if (!(await canRead(viewer, key.subject, scope))) {
    throw new ForbiddenError('Not permitted to read this journey');
  }
  return prisma.journeyEvent.findMany({
    where: { journeyId: key.journeyId, userId: key.subject },
    orderBy: { occurredAt: options?.order ?? 'asc' },
    ...(options?.limit !== undefined ? { take: options.limit } : {}),
  });
}

/**
 * One journey by its row id — the id-keyed read the admin explorer needs (the
 * natural-key {@link getJourney} is the engine's shape; an operator picks a row by
 * id). `null` when the row is absent (a benign miss — a 404 at the route). Unlike
 * the natural-key reads the subject isn't known until the row is loaded, so the
 * find runs first, then the viewer is gated against the loaded `userId` **before
 * the row is returned** — a denied viewer gets a `ForbiddenError`, never the row.
 */
export async function getJourneyById(
  viewer: JourneyViewer,
  journeyId: string,
  scope?: AccessScope
): Promise<UserJourney | null> {
  const journey = await prisma.userJourney.findUnique({ where: { id: journeyId } });
  if (!journey) return null;
  if (!(await canRead(viewer, journey.userId, scope))) {
    throw new ForbiddenError('Not permitted to read this journey');
  }
  return journey;
}

/** Narrowing / pagination options for {@link listJourneys}. */
export interface ListJourneysOptions {
  /** Rows to skip (page offset). */
  skip?: number;
  /** Page size (Prisma `take`). Omitted ⇒ unbounded — callers should pass one. */
  limit?: number;
  /** Restrict to one map's journeys (the picker's optional map filter). */
  graphSlug?: string;
}

/**
 * The journeys a viewer may see, newest first — the explorer picker's enumerator.
 * Its access face is {@link subjectScope} (the set form of {@link canRead}): an
 * admin-support viewer sees every subject's journeys (`{}`), everyone else only
 * their own (`{ userId }`) — the same predicate as the single-row reads, expressed
 * as a `where` fragment. Returns the page plus the unpaged `total` for the same
 * filter, so the route can build pagination meta in one round trip.
 */
export async function listJourneys(
  viewer: JourneyViewer,
  options?: ListJourneysOptions,
  scope?: AccessScope
): Promise<{ journeys: UserJourney[]; total: number }> {
  const subjectFilter = await subjectScope(viewer, scope);
  const where: Prisma.UserJourneyWhereInput = {
    ...subjectFilter,
    ...(options?.graphSlug ? { graphSlug: options.graphSlug } : {}),
  };
  const [journeys, total] = await Promise.all([
    prisma.userJourney.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      ...(options?.skip !== undefined ? { skip: options.skip } : {}),
      ...(options?.limit !== undefined ? { take: options.limit } : {}),
    }),
    prisma.userJourney.count({ where }),
  ]);
  return { journeys, total };
}
