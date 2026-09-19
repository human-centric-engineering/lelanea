/**
 * Where the crisis resource's content comes from: the admin-edited tables, or
 * the bundled file when they cannot answer (f-safety t-63).
 *
 * ## The rule this module exists for
 *
 * **A crisis turn never depends on a database read succeeding.** The tables are
 * the source once seeded; `content/lelanea_crisis_resources.json` is the floor.
 * The bundled file is served when:
 *
 * - the tables are **unseeded** — no `app_crisis_copy` row (the seed writes it
 *   with the regions, once);
 * - the read **throws**, or a stored row **fails validation** (a hand edit);
 * - the read passes {@link CRISIS_READ_DEADLINE_MS}.
 *
 * {@link loadCrisisContent} therefore never throws and never waits longer than
 * the deadline. The fallback, not the cache, is the safety net.
 *
 * ## The cache
 *
 * Module scope, {@link CRISIS_CACHE_TTL_MS}. A database answer (including
 * "unseeded") is cached; a failure or timeout is not, so the next crisis turn
 * tries again. An admin write calls {@link invalidateCrisisContentCache}, so the
 * instance that served the edit shows it at once; any other instance shows it
 * within the TTL. Nothing else caches this: a stale minute of a helpline's old
 * wording is acceptable, a minute of no helpline is not — and the fallback
 * rules that out.
 *
 * ## Once seeded, the tables are the whole list
 *
 * A region an admin removed is gone: people from there get the directory and
 * the local emergency line, exactly as for a region never listed. The file's
 * regions are not merged back in. That is also why the seed writes nothing
 * once the copy row exists (`prisma/seeds/app-lelanea/010-crisis-resources.ts`).
 *
 * @see lib/app/safety/resource.ts — which region a request gets
 * @see lib/app/safety/crisis-admin.ts — the only writer after the seed
 * @see .context/app/safety.md — "The resource"
 */

import type { AppCrisisCopy, AppCrisisRegion } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { getCrisisResources } from '@/lib/app/content/crisis-resources';
import {
  crisisCopyUpdateSchema,
  crisisServicesSchema,
  type CrisisService,
} from '@/lib/validations/app-crisis-resources';

/** The singleton copy row's key. */
export const CRISIS_COPY_SLUG = 'global';

/** How long a crisis turn waits for the tables before serving the bundled file. */
export const CRISIS_READ_DEADLINE_MS = 750;

/** How long a database answer is reused before the next read. */
export const CRISIS_CACHE_TTL_MS = 60_000;

export type CrisisContentStatus = 'draft' | 'signed_off';

export interface CrisisRegionContent {
  region: string;
  emergencyNumber: string;
  services: CrisisService[];
  status: CrisisContentStatus;
  /** A number for a stored row; `null` in the bundled file, which has one version for all. */
  version: number | null;
}

/** Everything the resolver needs, from whichever source answered. */
export interface CrisisContent {
  source: 'database' | 'bundled';
  copy: { hardIntro: string; softIntro: string; emergency: string; keptMessage: string };
  international: { name: string; contact: string; url: string; hours: string };
  copyStatus: CrisisContentStatus;
  /** The stored copy's version, or the file's `resources.version` string. */
  copyVersion: number | string;
  regions: CrisisRegionContent[];
}

/** The bundled file, in the same shape as a database answer. Never throws: the file is validated at import. */
export function bundledCrisisContent(): CrisisContent {
  const file = getCrisisResources();
  return {
    source: 'bundled',
    copy: { ...file.copy },
    international: {
      name: file.international.name,
      contact: file.international.contact,
      url: file.international.url,
      hours: file.international.hours,
    },
    copyStatus: file.resources.provenance.status,
    copyVersion: file.resources.version,
    regions: file.regions.map((r) => ({
      region: r.region,
      emergencyNumber: r.emergencyNumber,
      services: r.services.map((s) => ({ ...s })),
      status: file.resources.provenance.status,
      version: null,
    })),
  };
}

class CrisisReadDeadline extends Error {
  constructor() {
    super(`crisis resource read passed ${CRISIS_READ_DEADLINE_MS}ms`);
  }
}

/**
 * Stored rows as a {@link CrisisContent}. **Throws on any row the turn may not
 * serve** — the one definition of "servable", shared with the admin page so it
 * warns about exactly what sends everyone to the bundled file.
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
    source: 'database',
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
 * read error or a row that fails validation — the caller turns both into the
 * fallback.
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
 * The content a crisis resource is built from. **Never throws, and never waits
 * past {@link CRISIS_READ_DEADLINE_MS}** — see the module docblock.
 */
export async function loadCrisisContent(): Promise<CrisisContent> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.content;

  const readGeneration = generation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = readFromDatabase();
  // A read that loses the race may still reject later; it has nobody to tell.
  read.catch(() => undefined);
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CrisisReadDeadline()), CRISIS_READ_DEADLINE_MS);
  });

  try {
    const stored = await Promise.race([read, deadline]);
    if (stored === null) {
      logger.warn('Crisis resource tables are unseeded — serving the bundled file');
      const content = bundledCrisisContent();
      cache(content, readGeneration, now);
      return content;
    }
    cache(stored, readGeneration, now);
    return stored;
  } catch (err) {
    logger.error('Crisis resource read failed — serving the bundled file', {
      reason: err instanceof CrisisReadDeadline ? 'timeout' : 'error',
      error: err instanceof Error ? err.message : String(err),
    });
    return bundledCrisisContent();
  } finally {
    clearTimeout(timer);
  }
}
