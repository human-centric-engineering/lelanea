/**
 * The journey, discovery-question, resource and voice-overlay seeds: each
 * fills its empty tables from the file, with a first revision per row, and
 * never touches them again (f-content-seeds t-87; the overlays t-88).
 *
 * ## `fp4` — operator-owned, written once
 *
 * The case that matters is the second run. An admin will edit these rows
 * (t-91), and a seed that rewrote them would undo the edit on the next deploy
 * that ran the seeder. So a second run against an edited row must leave the
 * edit in place. That is asserted against a stateful in-memory stand-in for the
 * tables, through the real units and the real services, rather than by checking
 * that some write method was not called.
 *
 * @see prisma/seeds/app-lelanea/016-journey-structure.ts
 * @see prisma/seeds/app-lelanea/017-discovery-questions.ts
 * @see prisma/seeds/app-lelanea/018-resources.ts
 * @see prisma/seeds/app-lelanea/019-voice-overlays.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

import journeyUnit from '@/prisma/seeds/app-lelanea/016-journey-structure';
import questionsUnit from '@/prisma/seeds/app-lelanea/017-discovery-questions';
import resourcesUnit from '@/prisma/seeds/app-lelanea/018-resources';
import overlaysUnit from '@/prisma/seeds/app-lelanea/019-voice-overlays';
import { MODULE_SNAPSHOT_FIELDS, TIER_SNAPSHOT_FIELDS } from '@/lib/app/content/journey-store';
import {
  QUESTION_SET_SNAPSHOT_FIELDS,
  QUESTION_SNAPSHOT_FIELDS,
} from '@/lib/app/content/question-store';
import { WORDS_SNAPSHOT_FIELDS, seedResources } from '@/lib/app/content/resource-store';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import { JOURNEY_MODULES } from '@/lib/app/journey/roster';
import {
  VOICE_OVERLAY_SET_SNAPSHOT_FIELDS,
  VOICE_OVERLAY_SNAPSHOT_FIELDS,
} from '@/lib/app/content/voice-overlay-store';
import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';

type Row = Record<string, unknown>;

const TABLES = [
  'appJourney',
  'appJourneyTier',
  'appJourneyTierRevision',
  'appJourneyModule',
  'appJourneyModuleRevision',
  'appQuestionSet',
  'appQuestionSetRevision',
  'appDiscoveryQuestion',
  'appDiscoveryQuestionRevision',
  'appResourceCollection',
  'appResource',
  'appResourceRevision',
  'appResourceWords',
  'appResourceWordsRevision',
  'appVoiceOverlaySet',
  'appVoiceOverlaySetRevision',
  'appVoiceOverlay',
  'appVoiceOverlayRevision',
] as const;
type Table = (typeof TABLES)[number];

/** Every table, held in memory, with the calls the services make. */
function inMemoryDatabase() {
  const tables = Object.fromEntries(TABLES.map((name) => [name, [] as Row[]])) as Record<
    Table,
    Row[]
  >;
  const matches = (row: Row, where?: Row) =>
    !where || Object.entries(where).every(([key, value]) => row[key] === value);
  const delegate = (name: Table) => ({
    findFirst: vi.fn(async () => tables[name][0] ?? null),
    findUnique: vi.fn(
      async ({ where }: { where: Row }) => tables[name].find((row) => matches(row, where)) ?? null
    ),
    findMany: vi.fn(async () => tables[name].map((row) => ({ ...row }))),
    count: vi.fn(
      async (args?: { where?: Row }) =>
        tables[name].filter((row) => matches(row, args?.where)).length
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      tables[name].push(structuredClone(data));
      return data;
    }),
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      tables[name].push(...data.map((row) => structuredClone(row)));
      return { count: data.length };
    }),
  });
  const client = {
    ...Object.fromEntries(TABLES.map((name) => [name, delegate(name)])),
    // Array form, as the services use it: every operation already started.
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  return {
    tables,
    client: client as unknown as PrismaClient,
    raw: client as unknown as { $transaction: ReturnType<typeof vi.fn> },
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

let db: ReturnType<typeof inMemoryDatabase>;

beforeEach(() => {
  vi.clearAllMocks();
  db = inMemoryDatabase();
});

type Unit = typeof journeyUnit;
async function run(unit: Unit) {
  await unit.run({ prisma: db.client, logger } as unknown as Parameters<Unit['run']>[0]);
}

async function runAll() {
  await run(journeyUnit);
  await run(questionsUnit);
  await run(resourcesUnit);
  await run(overlaysUnit);
}

describe('016-journey-structure', () => {
  it('writes the journey, five tiers and seventeen modules, in roster order', async () => {
    await run(journeyUnit);

    expect(db.tables.appJourney).toEqual([
      expect.objectContaining({ id: 'Lelañea', version: '1.0', locale: 'en-US' }),
    ]);
    expect(db.tables.appJourneyTier.map((row) => row.id)).toEqual([
      'onboarding',
      'foundations',
      'inner_authority',
      'embodied_relationship',
      'integration_and_expansion',
    ]);
    expect(db.tables.appJourneyModule.map((row) => row.id)).toEqual(
      JOURNEY_MODULES.map((module) => module.id)
    );
  });

  it('gives every tier and module its v1 revision, origin seed, with every field changed', async () => {
    await run(journeyUnit);

    expect(db.tables.appJourneyTierRevision).toHaveLength(5);
    expect(db.tables.appJourneyModuleRevision).toHaveLength(17);
    for (const revision of db.tables.appJourneyTierRevision) {
      expect(revision).toMatchObject({
        revision: 1,
        origin: 'seed',
        editorId: null,
        changedFields: [...TIER_SNAPSHOT_FIELDS],
      });
    }
    for (const revision of db.tables.appJourneyModuleRevision) {
      expect(revision).toMatchObject({
        revision: 1,
        origin: 'seed',
        editorId: null,
        changedFields: [...MODULE_SNAPSHOT_FIELDS],
      });
    }
    const values = db.tables.appJourneyModule.find((row) => row.id === 'module_01_values');
    const valuesV1 = db.tables.appJourneyModuleRevision.find(
      (row) => row.moduleId === 'module_01_values'
    );
    // A full snapshot, not a pointer.
    expect(valuesV1?.phases).toEqual(values?.phases);
    expect(valuesV1?.title).toBe('Values');
  });

  it('writes the five tables in one transaction', async () => {
    await run(journeyUnit);

    expect(db.raw.$transaction).toHaveBeenCalledTimes(1);
  });

  it('writes no maintainer notes into a row', async () => {
    await run(journeyUnit);

    const text = JSON.stringify(db.tables.appJourneyModule);
    expect(text).not.toMatch(/"(notes|contentNote|contentFile|contentSteps|appBehavior)":/);
  });

  it('leaves an edited title in place on a second run', async () => {
    await run(journeyUnit);

    const values = db.tables.appJourneyModule.find((row) => row.id === 'module_01_values')!;
    values.title = 'Values, as she renamed it';
    values.revision = 2;

    await run(journeyUnit);

    const after = db.tables.appJourneyModule.find((row) => row.id === 'module_01_values');
    expect(after).toMatchObject({ title: 'Values, as she renamed it', revision: 2 });
    expect(db.tables.appJourney).toHaveLength(1);
    expect(db.tables.appJourneyModule).toHaveLength(17);
    expect(db.tables.appJourneyModuleRevision).toHaveLength(17);
    expect(db.raw.$transaction).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenLastCalledWith(expect.stringMatching(/left as it is/));
  });
});

describe('017-discovery-questions', () => {
  it('writes the set against its module, and the thirty questions numbered 1–30', async () => {
    await run(journeyUnit);
    await run(questionsUnit);

    expect(db.tables.appQuestionSet).toEqual([
      expect.objectContaining({
        id: 'onboarding_discovery_questions',
        moduleId: 'module_00_onboarding',
        phase: 8,
        revision: 1,
      }),
    ]);
    expect(db.tables.appDiscoveryQuestion.map((row) => row.number)).toEqual(
      [...Array(30).keys()].map((n) => n + 1)
    );
  });

  it('gives the set and every question a v1 revision, origin seed', async () => {
    await run(journeyUnit);
    await run(questionsUnit);

    expect(db.tables.appQuestionSetRevision).toEqual([
      expect.objectContaining({
        revision: 1,
        origin: 'seed',
        editorId: null,
        changedFields: [...QUESTION_SET_SNAPSHOT_FIELDS],
      }),
    ]);
    expect(db.tables.appDiscoveryQuestionRevision).toHaveLength(30);
    for (const revision of db.tables.appDiscoveryQuestionRevision) {
      expect(revision).toMatchObject({
        origin: 'seed',
        changedFields: [...QUESTION_SNAPSHOT_FIELDS],
      });
    }
  });

  it('leaves an edited question in place on a second run', async () => {
    await run(journeyUnit);
    await run(questionsUnit);

    const first = db.tables.appDiscoveryQuestion.find((row) => row.id === 'q01')!;
    first.text = 'Edited by an admin.';
    first.revision = 2;

    await run(questionsUnit);

    expect(db.tables.appDiscoveryQuestion.find((row) => row.id === 'q01')).toMatchObject({
      text: 'Edited by an admin.',
      revision: 2,
    });
    expect(db.tables.appDiscoveryQuestion).toHaveLength(30);
    expect(db.tables.appDiscoveryQuestionRevision).toHaveLength(30);
    expect(logger.info).toHaveBeenLastCalledWith(expect.stringMatching(/left as they are/));
  });
});

describe('018-resources', () => {
  it('writes the collection with its provenance, no videos, audio or articles yet, and her words', async () => {
    await runAll();

    expect(db.tables.appResourceCollection).toEqual([
      expect.objectContaining({
        id: 'lelanea_resources',
        provenance: expect.objectContaining({ status: 'draft' }),
      }),
    ]);
    expect(db.tables.appResource).toEqual([]);
    expect(db.tables.appResourceWords.map((row) => row.key).sort()).toEqual([
      'default',
      'module_01_values',
    ]);
    expect(db.tables.appResourceWordsRevision).toHaveLength(2);
    for (const revision of db.tables.appResourceWordsRevision) {
      expect(revision).toMatchObject({
        revision: 1,
        origin: 'seed',
        editorId: null,
        changedFields: [...WORDS_SNAPSHOT_FIELDS],
      });
    }
  });

  it('leaves edited words in place on a second run', async () => {
    await runAll();

    const words = db.tables.appResourceWords.find((row) => row.key === 'default')!;
    words.quote = 'Edited by an admin.';
    words.revision = 2;

    await run(resourcesUnit);

    expect(db.tables.appResourceWords.find((row) => row.key === 'default')).toMatchObject({
      quote: 'Edited by an admin.',
      revision: 2,
    });
    expect(db.tables.appResourceWords).toHaveLength(2);
    expect(logger.info).toHaveBeenLastCalledWith(expect.stringMatching(/left as it is/));
  });

  it('refuses a key that names no module in the database, and writes nothing', async () => {
    // The journey has not been seeded, so no module exists to key words to.
    const seed = buildResourcesSeed();

    await expect(seedResources(seed, db.client)).rejects.toThrow(/unknown key "module_01_values"/);
    expect(db.tables.appResourceCollection).toEqual([]);
    expect(db.raw.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a video that is not well formed, rather than writing what cannot be read', async () => {
    await run(journeyUnit);
    const seed = buildResourcesSeed();
    seed.resources.push({
      id: 'half-a-video',
      kind: 'video',
      position: 0,
      title: 'Half a video',
      subtitle: 'no link',
      relatesTo: null,
      duration: '1:00',
      readingTime: null,
      href: null,
      documentId: null,
    });

    await expect(seedResources(seed, db.client)).rejects.toThrow(/half-a-video/);
    expect(db.tables.appResource).toEqual([]);
  });
});

describe('seedResources refuses what could not be read back', () => {
  beforeEach(async () => {
    await run(journeyUnit);
  });

  it('a piece that relates to `default`, which is spelled null', async () => {
    const seed = buildResourcesSeed();
    seed.resources.push({
      id: 'for-everything',
      kind: 'video',
      position: 0,
      title: 'For everything',
      subtitle: 'tagged the wrong way',
      relatesTo: 'default',
      duration: '1:00',
      readingTime: null,
      href: 'https://example.com/x',
      documentId: null,
    });

    await expect(seedResources(seed, db.client)).rejects.toThrow(/unknown key "default"/);
  });

  it('a library with no words for `default`', async () => {
    const seed = buildResourcesSeed();
    seed.words = seed.words.filter((row) => row.key !== 'default');

    await expect(seedResources(seed, db.client)).rejects.toThrow(/no words for "default"/);
  });

  it('a malformed provenance', async () => {
    const seed = buildResourcesSeed();
    seed.collection = { ...seed.collection, provenance: { status: 'maybe' } };

    await expect(seedResources(seed, db.client)).rejects.toThrow(/provenance is malformed/);
    expect(db.tables.appResourceCollection).toEqual([]);
  });

  it('words that are not well formed', async () => {
    const seed = buildResourcesSeed();
    seed.words = seed.words.map((row) => (row.key === 'default' ? { ...row, quote: '' } : row));

    await expect(seedResources(seed, db.client)).rejects.toThrow(
      /words for "default" failed validation/
    );
  });
});

describe('all three', () => {
  it('declare no hashInputs over their files, so an edit to one cannot imply it landed', () => {
    expect(journeyUnit.hashInputs).toBeUndefined();
    expect(questionsUnit.hashInputs).toBeUndefined();
    expect(resourcesUnit.hashInputs).toBeUndefined();
  });
});

describe('019-voice-overlays', () => {
  it('writes the set, every overlay and a first revision for each', async () => {
    const seed = buildVoiceOverlaySeed();

    await run(overlaysUnit);

    expect(db.tables.appVoiceOverlaySet).toHaveLength(1);
    expect(db.tables.appVoiceOverlaySet[0]).toMatchObject({
      id: seed.set.id,
      version: seed.set.version,
      status: 'draft',
      revision: 1,
    });
    expect(db.tables.appVoiceOverlay.map((row) => row.situation)).toEqual(
      seed.overlays.map((overlay) => overlay.situation)
    );
    // fp6: the file is non-empty, so the comparison above is not vacuous.
    expect(seed.overlays.length).toBeGreaterThan(0);
    expect(db.tables.appVoiceOverlaySetRevision).toHaveLength(1);
    expect(db.tables.appVoiceOverlayRevision).toHaveLength(seed.overlays.length);
  });

  it('stamps every first revision as the seed, by an author who is not a person', async () => {
    await run(overlaysUnit);

    for (const row of [
      ...db.tables.appVoiceOverlaySetRevision,
      ...db.tables.appVoiceOverlayRevision,
    ]) {
      expect(row).toMatchObject({ revision: 1, origin: 'seed', editorId: null });
    }
    expect(db.tables.appVoiceOverlaySetRevision[0].changedFields).toEqual([
      ...VOICE_OVERLAY_SET_SNAPSHOT_FIELDS,
    ]);
    expect(db.tables.appVoiceOverlayRevision[0].changedFields).toEqual([
      ...VOICE_OVERLAY_SNAPSHOT_FIELDS,
    ]);
  });

  it('writes every row as a draft: a seed cannot sign her register off', async () => {
    await run(overlaysUnit);

    for (const row of [...db.tables.appVoiceOverlaySet, ...db.tables.appVoiceOverlay]) {
      expect(row.status).toBe('draft');
    }
  });

  it('writes the whole set in one transaction, so the marker cannot land alone', async () => {
    await run(overlaysUnit);

    // The write-once guard reads the set row. If the set could be written
    // without its overlays, a half-seeded database would look complete and
    // never be repaired.
    expect(db.raw.$transaction).toHaveBeenCalledTimes(1);
  });

  it('leaves an EDITED overlay alone on a second run', async () => {
    await run(overlaysUnit);
    const [first] = db.tables.appVoiceOverlay;
    first.heading = 'Edited by an admin.';
    first.revision = 2;

    await run(overlaysUnit);

    // The case that matters (`fp4`). An admin edits these in t-92, and a seed
    // that rewrote them would undo the edit on the next deploy that seeded.
    expect(db.tables.appVoiceOverlay[0]).toMatchObject({
      heading: 'Edited by an admin.',
      revision: 2,
    });
    expect(db.tables.appVoiceOverlay).toHaveLength(buildVoiceOverlaySeed().overlays.length);
    expect(db.tables.appVoiceOverlayRevision).toHaveLength(buildVoiceOverlaySeed().overlays.length);
  });

  it('does not resurrect an overlay an admin deleted', async () => {
    await run(overlaysUnit);
    const removed = db.tables.appVoiceOverlay.pop();

    await run(overlaysUnit);

    expect(db.tables.appVoiceOverlay.map((row) => row.situation)).not.toContain(removed?.situation);
  });
});
