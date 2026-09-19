/**
 * The safety record: that a crisis was detected and what the app did —
 * never the words (f-safety t-58).
 *
 * The first consumer of `app_safety_event`; the misuse task (t-60) writes to
 * the same table under its own `kind`. What a row holds and why it holds no
 * text is on the model (`prisma/schema/app.prisma`).
 *
 * **A failed write never withholds the resource.** The person is owed the
 * resource whether or not the record was kept, so the caller logs and moves on
 * (`assess.ts`); the log line carries every field but the person's id, so what
 * happened is not lost with the row.
 */

import type { AppSafetyEvent } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import type { ContextCheckOutcome } from '@/lib/app/safety/context-check';
import type { CrisisCategory } from '@/lib/app/safety/detect';

export interface CrisisEventInput {
  /** Null before signup. */
  userId: string | null;
  seat: string;
  detectedTier: 'soft' | 'hard';
  actedTier: 'soft' | 'hard';
  categories: CrisisCategory[];
  contextCheck: ContextCheckOutcome;
  locale: string | null;
  resourceRegion: string | null;
}

export async function recordCrisisEvent(event: CrisisEventInput): Promise<void> {
  await prisma.appSafetyEvent.create({
    data: {
      kind: 'crisis',
      userId: event.userId,
      seat: event.seat,
      detectedTier: event.detectedTier,
      actedTier: event.actedTier,
      categories: event.categories,
      contextCheck: event.contextCheck,
      locale: event.locale,
      resourceRegion: event.resourceRegion,
    },
  });
}

/** A person's safety events, oldest first — their Art. 15 section. */
export function findSafetyEventsForSubject(subject: { userId: string }): Promise<AppSafetyEvent[]> {
  return prisma.appSafetyEvent.findMany({
    where: { userId: subject.userId },
    orderBy: { createdAt: 'asc' },
  });
}
