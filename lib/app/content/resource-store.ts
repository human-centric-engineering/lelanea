/**
 * The resource library, read from and written to the database (f-content-seeds
 * t-87).
 *
 * **The one service for `app_resource_collection`, `app_resource` and
 * `app_resource_words`.** The seed writes through it now, and the admin editor
 * will in t-91.
 *
 * **What reads it:**
 * - `/api/v1/app/content/resources` (the library) and `/resources/:key` (the
 *   drawer's selection);
 * - the voice block, which lists the library for the model on every turn
 *   (`lib/app/voice/context-contributor.ts` → `lib/app/resources/offering.ts`).
 *   It reads the library once per turn and hands it down;
 * - `suggest_resource`, which looks one id up per call
 *   (`lib/app/resources/suggest.ts`);
 * - chip resolution on reload and replay (`lib/app/conversation/transcript.ts`,
 *   `lib/app/agent/turn-record.ts`), which reads the library once per read and
 *   resolves every stored suggestion against it.
 *
 * Read per request, no cache, and an unseeded database throws
 * {@link ContentNotSeededError}, both for the reasons `document-store.ts` gives.
 *
 * @see lib/app/content/resource-view.ts — the projection and the row rules
 * @see lib/app/content/resources.ts — the schemas and the selection
 */

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '@/lib/db/client';
import { ContentNotSeededError } from '@/lib/app/content/document-view';
import { getJourneyStructure } from '@/lib/app/content/journey-store';
import {
  FIXED_RESOURCE_KEYS,
  provenanceSchema,
  selectResources,
  type ResourceFilmView,
  type ResourceReadingView,
  type ResourcesLibrary,
  type ResourcesSelection,
} from '@/lib/app/content/resources';
import {
  toFilm,
  toReading,
  toResourcesLibrary,
  toWords,
  type ResourceRow,
} from '@/lib/app/content/resource-view';
import type { ResourcesSeed } from '@/lib/app/content/resource-view';

const NOT_SEEDED = ['No resource library in the database', '018-resources.ts'] as const;

const RESOURCE_COLUMNS = {
  id: true,
  kind: true,
  position: true,
  title: true,
  subtitle: true,
  relatesTo: true,
  duration: true,
  readingTime: true,
  href: true,
  documentId: true,
  revision: true,
} as const;

// ============================================================================
// Reads
// ============================================================================

/**
 * The whole library: every film and reading in order, and her words by key.
 *
 * **Retired resources are left out** unless `includeRetired` is set (t-91). A
 * retired resource is no longer offered, listed or suggestable, so every
 * surface that shows the library reads it without them. Chip resolution is the
 * one caller that asks for them: a suggestion already made in a conversation
 * names a resource by id, and its chip must still resolve after the resource is
 * retired. That is what the tombstone is for.
 *
 * @throws ContentNotSeededError when the seed has not run.
 */
export async function getResourcesLibrary(
  options: { includeRetired?: boolean } = {}
): Promise<ResourcesLibrary> {
  const [collection, resources, words] = await Promise.all([
    defaultClient.appResourceCollection.findFirst({
      select: { id: true, title: true, version: true, locale: true, provenance: true },
      orderBy: { createdAt: 'asc' },
    }),
    defaultClient.appResource.findMany({
      where: options.includeRetired ? {} : { retired: false },
      select: RESOURCE_COLUMNS,
      orderBy: { position: 'asc' },
    }),
    defaultClient.appResourceWords.findMany({
      select: {
        key: true,
        quote: true,
        paragraphs: true,
        sourceCollection: true,
        sourceId: true,
        revision: true,
      },
      orderBy: { key: 'asc' },
    }),
  ]);
  if (!collection) throw new ContentNotSeededError(...NOT_SEEDED);
  return toResourcesLibrary(collection, resources, words);
}

/**
 * One live film or reading by id, or `null` when the library has no such id or
 * it has been retired.
 *
 * One indexed read, for a caller that needs one item: the suggestion tool, per
 * call. A retired resource is `null` here because suggesting it is exactly what
 * retiring stops. A caller resolving many ids reads the library once instead.
 */
export async function getResource(
  id: string
): Promise<ResourceFilmView | ResourceReadingView | null> {
  const row = await defaultClient.appResource.findUnique({
    where: { id },
    select: { ...RESOURCE_COLUMNS, retired: true },
  });
  if (!row || row.retired) return null;
  return row.kind === 'film' ? toFilm(row) : toReading(row);
}

/**
 * Her words, two films and three readings for whatever is open — or `null` for
 * a key that is neither a module on the journey nor a fixed key. See
 * {@link selectResources}.
 */
export async function selectResourcesFor(
  key: string,
  options: { pin?: string } = {}
): Promise<ResourcesSelection | null> {
  const [library, journey] = await Promise.all([getResourcesLibrary(), getJourneyStructure()]);
  return selectResources(library, journey.modules, key, options);
}

// ============================================================================
// Writes
// ============================================================================

/** The fields a resource revision snapshots. At revision 1 every one is "changed". */
export const RESOURCE_SNAPSHOT_FIELDS = [
  'kind',
  'position',
  'title',
  'subtitle',
  'relatesTo',
  'duration',
  'readingTime',
  'href',
  'documentId',
  'retired',
] as const;

/** The fields a words revision snapshots. */
export const WORDS_SNAPSHOT_FIELDS = [
  'quote',
  'paragraphs',
  'sourceCollection',
  'sourceId',
] as const;

export type SeedResourcesResult =
  | { status: 'seeded'; resources: number; words: number }
  /** A collection row already exists. Nothing was written. */
  | { status: 'skipped'; resources: number; words: number };

/**
 * Throw unless every key the seed names is a module on the journey or a fixed
 * key, and every item is well formed. Documents need no check here: the
 * `documentId` foreign key refuses an unknown one inside the transaction.
 */
async function assertWritable(seed: ResourcesSeed, client: PrismaClient): Promise<void> {
  const moduleIds = new Set(
    (await client.appJourneyModule.findMany({ select: { id: true } })).map((row) => row.id)
  );
  const isKey = (key: string) => moduleIds.has(key) || FIXED_RESOURCE_KEYS.some((k) => k === key);
  const problems: string[] = [];

  for (const row of seed.resources) {
    // Run through the read path's rules, so nothing is written that could not be read.
    const asRead = { ...row, revision: 1 } satisfies ResourceRow;
    try {
      if (row.kind === 'film') toFilm(asRead);
      else toReading(asRead);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    if (row.relatesTo !== null && (!isKey(row.relatesTo) || row.relatesTo === 'default')) {
      problems.push(`resource "${row.id}" relates to unknown key "${row.relatesTo}"`);
    }
  }
  for (const row of seed.words) {
    try {
      toWords({ ...row, revision: 1 });
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    if (!isKey(row.key)) problems.push(`words keyed to unknown key "${row.key}"`);
  }
  if (!seed.words.some((row) => row.key === 'default')) problems.push('no words for "default"');
  if (!provenanceSchema.safeParse(seed.collection.provenance).success) {
    problems.push('the collection provenance is malformed');
  }
  if (problems.length > 0) {
    throw new Error(`The resource library cannot be written: ${problems.join('; ')}`);
  }
}

/**
 * Write the collection, every film, reading and key's words, and each one's
 * first revision, once.
 *
 * **Write-once (`fp4`)**, marked by the collection row, written in the same
 * transaction as everything else. **Safe on empty**: no removal pass, and a
 * library with no films or readings is a real state (her list lands in t-76).
 *
 * Runs after the journey is seeded: a key is checked against the modules in
 * the database.
 */
export async function seedResources(
  seed: ResourcesSeed,
  client: PrismaClient = defaultClient
): Promise<SeedResourcesResult> {
  const existing = await client.appResourceCollection.findFirst({ select: { id: true } });
  if (existing) {
    const [resources, words] = await Promise.all([
      client.appResource.count(),
      client.appResourceWords.count(),
    ]);
    return { status: 'skipped', resources, words };
  }

  await assertWritable(seed, client);

  const now = new Date();
  const collectionId = seed.collection.id;
  const provenance = { origin: 'seed' as const, editorId: null, changedAt: now };

  await client.$transaction([
    client.appResourceCollection.create({
      data: {
        ...seed.collection,
        provenance: provenanceSchema.parse(seed.collection.provenance),
        createdAt: now,
        updatedAt: now,
      },
    }),
    client.appResource.createMany({
      data: seed.resources.map((row) => ({
        ...row,
        collectionId,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })),
    }),
    client.appResourceWords.createMany({
      data: seed.words.map((row) => ({
        ...row,
        collectionId,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })),
    }),
    client.appResourceRevision.createMany({
      data: seed.resources.map(({ id, ...fields }) => ({
        resourceId: id,
        revision: 1,
        ...fields,
        changedFields: [...RESOURCE_SNAPSHOT_FIELDS],
        ...provenance,
      })),
    }),
    client.appResourceWordsRevision.createMany({
      data: seed.words.map(({ key, ...fields }) => ({
        wordsKey: key,
        revision: 1,
        ...fields,
        changedFields: [...WORDS_SNAPSHOT_FIELDS],
        ...provenance,
      })),
    }),
  ]);

  return { status: 'seeded', resources: seed.resources.length, words: seed.words.length };
}
