/**
 * The journey's text, read from and written to the database (f-content-seeds
 * t-87).
 *
 * **The one service for `app_journey`, `app_journey_tier` and
 * `app_journey_module`.** Every read a surface makes and every write goes
 * through here: the seed's now, and the admin editor's in t-91.
 *
 * **What reads it:** the map drawer and the module pages (through
 * `lib/app/journey/map.ts`), the home page's journey list,
 * `/api/v1/app/content/journey-structure`, the resource drawer and offering
 * (for module titles), and startup, which names each registered module from its
 * row (`lib/app/leaf-bootstrap.ts`). The pages call this service rather than
 * fetching their own API. The parity test
 * `tests/unit/app/api/v1/app/content/journey-structure-parity.test.ts` proves the
 * API serves exactly the records the pages render from.
 *
 * **Who owns a module's title: its row here.** Structure is the code roster
 * (`lib/app/journey/roster.ts`). The published map carries no titles, and the
 * registered `ModuleDefinition.name` is derived from this row at startup. See
 * `AppJourney` in `prisma/schema/app.prisma` and the journal decision "Module
 * titles (t-87)".
 *
 * **Read per request, no cache**, for the reason `document-store.ts` gives: an
 * admin edit (t-91) must reach the next request without an invalidation step to
 * remember. Three indexed reads of 23 small rows.
 *
 * **An unseeded database throws {@link ContentNotSeededError}.** No fallback to
 * the file.
 *
 * @see lib/app/content/journey-view.ts — the projection and the stored JSON schemas
 * @see lib/app/content/seed-input/journey-seed.ts — what the seed writes
 */

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '@/lib/db/client';
import { ContentNotSeededError } from '@/lib/app/content/document-view';
import {
  storedPhasesSchema,
  storedPhaseTiersSchema,
  storedProducesSchema,
  toJourneyStructure,
  type JourneyStructure,
} from '@/lib/app/content/journey-view';
import type { JourneySeed } from '@/lib/app/content/journey-view';

const NOT_SEEDED = ['No journey in the database', '016-journey-structure.ts'] as const;

// ============================================================================
// Reads
// ============================================================================

/**
 * The journey: its tiers and modules in the roster's order, each with its text.
 *
 * @throws ContentNotSeededError when the seed has not run.
 */
export async function getJourneyStructure(): Promise<JourneyStructure> {
  const [journey, tiers, modules] = await Promise.all([
    defaultClient.appJourney.findFirst({
      select: { id: true, title: true, subtitle: true, version: true, locale: true },
      orderBy: { createdAt: 'asc' },
    }),
    defaultClient.appJourneyTier.findMany({
      select: { id: true, label: true, intent: true, revision: true },
    }),
    defaultClient.appJourneyModule.findMany({
      select: {
        id: true,
        displayNumber: true,
        title: true,
        subtitle: true,
        chartTitle: true,
        phases: true,
        phaseTiers: true,
        produces: true,
        revision: true,
      },
    }),
  ]);
  if (!journey) throw new ContentNotSeededError(...NOT_SEEDED);
  return toJourneyStructure(journey, tiers, modules);
}

// ============================================================================
// Writes
// ============================================================================

/** The fields a tier revision snapshots. At revision 1 every one is "changed". */
export const TIER_SNAPSHOT_FIELDS = ['label', 'intent'] as const;

/** The fields a module revision snapshots. */
export const MODULE_SNAPSHOT_FIELDS = [
  'displayNumber',
  'title',
  'subtitle',
  'chartTitle',
  'phases',
  'phaseTiers',
  'produces',
] as const;

export type SeedJourneyResult =
  | { status: 'seeded'; tiers: number; modules: number }
  /** A journey row already exists. Nothing was written. */
  | { status: 'skipped'; tiers: number; modules: number };

/**
 * Write the journey, its tiers' and modules' text, and each one's first
 * revision, once.
 *
 * **Write-once (`fp4`)**, marked by the journey row, exactly as
 * `seedFoundationalDocuments` is marked by its collection row: every table is
 * written in one transaction, so if the marker is present the rest landed with
 * it. **Safe on empty**: no removal pass.
 *
 * `client` is the seed runner's Prisma client. Other callers leave it out.
 */
export async function seedJourneyStructure(
  seed: JourneySeed,
  client: PrismaClient = defaultClient
): Promise<SeedJourneyResult> {
  const existing = await client.appJourney.findFirst({ select: { id: true } });
  if (existing) {
    const [tiers, modules] = await Promise.all([
      client.appJourneyTier.count(),
      client.appJourneyModule.count(),
    ]);
    return { status: 'skipped', tiers, modules };
  }

  const now = new Date();
  const modules = seed.modules.map((entry) => ({
    ...entry,
    // Validated again at the write, not just when the seed was built. The
    // editor's writes will pass through here too.
    phases: storedPhasesSchema.parse(entry.phases),
    phaseTiers: storedPhaseTiersSchema.parse(entry.phaseTiers) ?? undefined,
    produces: storedProducesSchema.parse(entry.produces) ?? undefined,
  }));
  const provenance = { origin: 'seed' as const, editorId: null, changedAt: now };

  await client.$transaction([
    client.appJourney.create({ data: { ...seed.journey, createdAt: now, updatedAt: now } }),
    client.appJourneyTier.createMany({
      data: seed.tiers.map((tier) => ({
        ...tier,
        journeyId: seed.journey.id,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })),
    }),
    client.appJourneyModule.createMany({
      data: modules.map((entry) => ({
        ...entry,
        journeyId: seed.journey.id,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })),
    }),
    client.appJourneyTierRevision.createMany({
      data: seed.tiers.map(({ id, ...text }) => ({
        tierId: id,
        revision: 1,
        ...text,
        changedFields: [...TIER_SNAPSHOT_FIELDS],
        ...provenance,
      })),
    }),
    client.appJourneyModuleRevision.createMany({
      data: modules.map(({ id, ...text }) => ({
        moduleId: id,
        revision: 1,
        ...text,
        changedFields: [...MODULE_SNAPSHOT_FIELDS],
        ...provenance,
      })),
    }),
  ]);

  return { status: 'seeded', tiers: seed.tiers.length, modules: seed.modules.length };
}
