/**
 * Where the crisis resource's content comes from: the admin-edited tables, and
 * nothing else (f-safety t-63; the fallback removed in f-content-seeds t-88).
 *
 * ## The rule this module exists for
 *
 * **A crisis turn is served from the database, or it fails loudly.** There is
 * no bundled floor any more. That was the owner's ruling (2026-09-22), and the
 * reasoning is worth keeping because the old behaviour reads as the safer one:
 *
 * - A second copy of a helpline is a second thing to keep signed off, and it is
 *   the one nobody looks at. It went stale silently and answered in place of
 *   the rows an admin had just corrected.
 * - The states that used to need it are now unreachable rather than handled.
 *   The row is inserted by a data migration in every environment
 *   (`20260929100200_app_crisis_resources_data`), so "tables but no copy row"
 *   cannot happen; and every admin write validates through the same schemas
 *   {@link contentFromRows} reads with, so an edit cannot store a row that
 *   fails on the way out.
 * - What is left is a database that cannot be read at all — and then the app is
 *   down, so a crisis turn has nothing to say that the rest of the app would
 *   not already have failed to say.
 *
 * **The read deadline went with it.** Racing a 750ms timer only made sense when
 * losing the race meant serving the file instead. With no file, a timeout is
 * just a crisis turn failing faster, so the read now waits for the answer: a
 * slow helpline beats a prompt error with no helpline in it.
 *
 * ## The cache
 *
 * Module scope, {@link CRISIS_CACHE_TTL_MS}. A successful read is cached; a
 * failure is not, so the next crisis turn tries again. An admin write calls
 * {@link invalidateCrisisContentCache}, so the instance that served the edit
 * shows it at once; any other instance shows it within the TTL. A stale minute
 * of a helpline's old wording is acceptable.
 *
 * ## Once seeded, the tables are the whole list
 *
 * A region an admin removed is gone: people from there get the directory and
 * the local emergency line, exactly as for a region never listed. That is also
 * why the seed writes nothing once the copy row exists
 * (`prisma/seeds/app-lelanea/010-crisis-resources.ts`).
 *
 * @see lib/app/safety/resource.ts — which region a request gets
 * @see lib/app/safety/crisis-admin.ts — the only writer after the seed
 * @see .context/app/safety.md — "The resource"
 */

import type { AppCrisisCopy, AppCrisisRegion } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import {
  crisisCopyUpdateSchema,
  crisisServicesSchema,
  type CrisisService,
} from '@/lib/validations/app-crisis-resources';

/** The singleton copy row's key. */
export const CRISIS_COPY_SLUG = 'global';

/** How long a database answer is reused before the next read. */
export const CRISIS_CACHE_TTL_MS = 60_000;

export type CrisisContentStatus = 'draft' | 'signed_off';

export interface CrisisRegionContent {
  region: string;
  emergencyNumber: string;
  services: CrisisService[];
  status: CrisisContentStatus;
  version: number;
}

/** Everything the resolver needs. Always from the tables. */
export interface CrisisContent {
  copy: { hardIntro: string; softIntro: string; emergency: string; keptMessage: string };
  international: { name: string; contact: string; url: string; hours: string };
  copyStatus: CrisisContentStatus;
  /** The stored copy's version. */
  copyVersion: number;
  regions: CrisisRegionContent[];
}

/**
 * Stored rows as a {@link CrisisContent}. **Throws on any row the turn may not
 * serve** — the one definition of "servable", shared with the admin page so it
 * warns about exactly what would fail a crisis turn. Since t-88 every write
 * path validates through these same schemas, so reaching one of these throws
 * means a row was changed outside the admin.
 */
export function contentFromRows(copy: AppCrisisCopy, regions: AppCrisisRegion[]): CrisisContent {
  const text = crisisCopyUpdateSchema.parse({
    hardIntro: copy.hardIntro,
    softIntro: copy.softIntro,
    emergency: copy.emergency,
    keptMessage: copy.keptMessage,
    internationalName: copy.internationalName,
    internationalContact: copy.internationalContact,
    internationalUrl: copy.internationalUrl,
    internationalHours: copy.internationalHours,
  });

  return {
    copy: {
      hardIntro: text.hardIntro,
      softIntro: text.softIntro,
      emergency: text.emergency,
      keptMessage: text.keptMessage,
    },
    international: {
      name: text.internationalName,
      contact: text.internationalContact,
      url: text.internationalUrl,
      hours: text.internationalHours,
    },
    copyStatus: copy.status,
    copyVersion: copy.version,
    regions: regions.map((row) => {
      if (!/^[A-Z]{2}$/.test(row.region) || row.emergencyNumber.trim() === '') {
        throw new Error(`the ${row.region} row has an invalid region code or no emergency number`);
      }
      return {
        region: row.region,
        emergencyNumber: row.emergencyNumber,
        services: crisisServicesSchema.parse(row.services),
        status: row.status,
        version: row.version,
      };
    }),
  };
}

/**
 * The tables as a {@link CrisisContent}, or `null` when unseeded. Throws on a
 * read error or a row that fails validation.
 */
async function readFromDatabase(): Promise<CrisisContent | null> {
  const [copy, regions] = await Promise.all([
    prisma.appCrisisCopy.findUnique({ where: { slug: CRISIS_COPY_SLUG } }),
    prisma.appCrisisRegion.findMany({ orderBy: { region: 'asc' } }),
  ]);
  return copy ? contentFromRows(copy, regions) : null;
}

let cached: { content: CrisisContent; expiresAt: number } | null = null;
/**
 * Bumped by every invalidation. A read that started before an admin write must
 * not cache what it read once it finishes, or the pre-edit words would be
 * served here for another TTL (found by /code-review).
 */
let generation = 0;

/** Drop the cached answer. Every admin write calls this after it commits. */
export function invalidateCrisisContentCache(): void {
  cached = null;
  generation += 1;
}

function cache(content: CrisisContent, readGeneration: number, now: number): void {
  if (readGeneration === generation) cached = { content, expiresAt: now + CRISIS_CACHE_TTL_MS };
}

/**
 * The content a crisis resource is built from.
 *
 * **Throws** when the tables cannot answer — there is no floor beneath this
 * any more, and the module docblock says why the two states that used to reach
 * one are now unreachable instead.
 *
 * @throws when the copy row is missing, a row fails validation, or the read
 * fails. All three mean the app cannot serve a crisis turn honestly.
 */
export async function loadCrisisContent(): Promise<CrisisContent> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.content;

  const readGeneration = generation;
  let stored: CrisisContent | null;
  try {
    stored = await readFromDatabase();
  } catch (err) {
    // Logged here as well as rethrown: the caller turns this into a failed
    // turn, and whoever reads that needs to know it was the crisis tables.
    logger.error('Crisis resource read failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (stored === null) {
    logger.error('Crisis resource tables are unseeded — no copy row to serve');
    throw new Error(
      'Crisis resource tables are unseeded: no app_crisis_copy row. ' +
        'Every environment gets one from 20260929100200_app_crisis_resources_data; ' +
        'run `npm run db:migrate:deploy`.'
    );
  }

  cache(stored, readGeneration, now);
  return stored;
}
