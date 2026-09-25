/**
 * Export, import, and the round trip between them (f-content-seeds t-91,
 * done-when 5 and 6).
 *
 * The same shape the slot export test uses: a fresh export, previewed as an
 * import, plans no writes. Here it is run for each of the four collections
 * against the REAL seeded rows (`content-db-fake.ts`), and again after edits
 * that move things around, because a round trip that only holds on the seed
 * would miss the ordering writes that make it hold later.
 *
 * An export is also a seed input: the real seed builder reads it and writes the
 * same rows the export came from.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';

const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy({}, { get: (_target, key) => db.current?.client[key as string] }),
}));
vi.mock('@/lib/app/content/knowledge-mirror', () => ({
  reconcileKnowledgeMirror: vi.fn(async () => ({ status: 'reconciled', failed: [] })),
}));

import { seedFoundationalDocuments } from '@/lib/app/content/document-store';
import { seedJourneyStructure } from '@/lib/app/content/journey-store';
import { seedDiscoveryQuestions } from '@/lib/app/content/question-store';
import { seedResources } from '@/lib/app/content/resource-store';
import { buildFoundationalSeed } from '@/lib/app/content/seed-input/foundational-seed';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import {
  applyDocumentsImport,
  exportDocumentsFile,
  previewDocumentsImport,
  reorderDocuments,
} from '@/lib/app/content/admin/documents';
import {
  exportJourneyFile,
  previewJourneyImport,
  applyJourneyImport,
} from '@/lib/app/content/admin/journey';
import {
  applyQuestionsImport,
  createQuestion,
  deleteQuestion,
  exportQuestionsFile,
  previewQuestionsImport,
} from '@/lib/app/content/admin/questions';
import {
  applyResourcesImport,
  createResource,
  exportResourcesFile,
  previewResourcesImport,
  setResourceRetired,
} from '@/lib/app/content/admin/resources';
import type { ContentImportPlan } from '@/lib/app/content/admin/shared';

const EDITOR = 'editor';

async function seedInto(fake: ContentDbFake, files: { documents?: unknown } = {}) {
  const client = fake.client as unknown as PrismaClient;
  await seedFoundationalDocuments(
    files.documents ? buildFoundationalSeed(files.documents as never) : buildFoundationalSeed(),
    client
  );
  await seedJourneyStructure(buildJourneySeed(), client);
  await seedDiscoveryQuestions(buildQuestionSeed(), client);
  await seedResources(buildResourcesSeed(), client);
}

/** Everything a plan would touch, flattened, so "nothing" is one assertion. */
function writes(plan: ContentImportPlan): string[] {
  return plan.sections.flatMap((section) => [
    ...section.creates.map((item) => `create ${section.entity}:${item.key}`),
    ...section.updates.map(
      (item) => `update ${section.entity}:${item.key} ${item.changedFields.join(',')}`
    ),
    ...section.removals.map((item) => `remove ${section.entity}:${item.key}`),
  ]);
}

function unchangedCount(plan: ContentImportPlan): number {
  return plan.sections.reduce((sum, section) => sum + section.unchanged.length, 0);
}

/** A table's rows without the columns a fresh write stamps differently. */
function stable(rows: Record<string, unknown>[]) {
  return rows.map(({ createdAt: _c, updatedAt: _u, changedAt: _a, id: _i, ...rest }) => rest);
}

beforeEach(async () => {
  db.current = createContentDbFake();
  await seedInto(db.current);
});

describe('a fresh export, re-imported, plans no writes', () => {
  // Each against the seed, with the population asserted, so "no writes" is
  // not the empty plan of an empty file. With removal asked for and without
  // (t-100): a whole file leaves nothing out, so the flag changes nothing.
  it.each([
    ['documents', exportDocumentsFile, previewDocumentsImport, 7, false],
    ['documents', exportDocumentsFile, previewDocumentsImport, 7, true],
    ['journey', exportJourneyFile, previewJourneyImport, 5 + 17, false],
    ['journey', exportJourneyFile, previewJourneyImport, 5 + 17, true],
    ['questions', exportQuestionsFile, previewQuestionsImport, 30, false],
    ['questions', exportQuestionsFile, previewQuestionsImport, 30, true],
    ['resources', exportResourcesFile, previewResourcesImport, 2, false],
    ['resources', exportResourcesFile, previewResourcesImport, 2, true],
  ] as const)(
    '%s, removing what it leaves out: %s',
    async (_name, exportFile, preview, population, removeAbsent) => {
      const file = JSON.parse(JSON.stringify(await exportFile())) as unknown;
      const plan = await preview(file, removeAbsent);

      expect(plan.refusals).toEqual([]);
      expect(writes(plan)).toEqual([]);
      expect(plan.writesNothing).toBe(true);
      expect(unchangedCount(plan)).toBe(population);
    }
  );

  it('still plans nothing after reorders, retirements, removals and additions', async () => {
    const documents = db
      .current!.rows('appFoundationalDocument')
      .sort((a, b) => (a.position as number) - (b.position as number));
    await reorderDocuments(
      [...documents]
        .reverse()
        .map((row) => ({ id: row.id as string, revision: row.revision as number })),
      EDITOR
    );
    await createResource(
      'video-a',
      {
        kind: 'video',
        title: 'A',
        subtitle: 'a',
        relatesTo: null,
        duration: '1:00',
        href: 'https://example.com/a',
      },
      EDITOR
    );
    await createResource(
      'video-b',
      {
        kind: 'video',
        title: 'B',
        subtitle: 'b',
        relatesTo: null,
        duration: '2:00',
        href: 'https://example.com/b',
      },
      EDITOR
    );
    await createResource(
      'video-c',
      {
        kind: 'video',
        title: 'C',
        subtitle: 'c',
        relatesTo: null,
        duration: '3:00',
        href: 'https://example.com/c',
      },
      EDITOR
    );
    await setResourceRetired('video-a', true, 1, EDITOR);
    await deleteQuestion('q05', 1, EDITOR);
    await createQuestion(
      { text: 'A new one?', inputType: 'long_text', hint: null, conditionalFollowUp: null },
      EDITOR
    );

    for (const [exportFile, preview] of [
      [exportDocumentsFile, previewDocumentsImport],
      [exportQuestionsFile, previewQuestionsImport],
      [exportResourcesFile, previewResourcesImport],
    ] as const) {
      for (const removeAbsent of [false, true]) {
        const plan = await preview(
          JSON.parse(JSON.stringify(await exportFile())) as unknown,
          removeAbsent
        );
        expect(writes(plan)).toEqual([]);
      }
    }
    // The live videos are contiguous from 0, the retired one parked below.
    const videos = db
      .current!.rows('appResource')
      .map((row) => [row.id, row.position, row.retired]);
    expect(videos).toEqual(
      expect.arrayContaining([
        ['video-b', 0, false],
        ['video-c', 1, false],
        ['video-a', -1, true],
      ])
    );
  });
});

describe('an export is a valid seed input', () => {
  it('the documents export, seeded into an empty database, writes the rows it came from', async () => {
    const file = JSON.parse(JSON.stringify(await exportDocumentsFile())) as unknown;
    const fresh = createContentDbFake();
    const original = db.current!;
    db.current = fresh;
    await seedInto(fresh, { documents: file });

    expect(stable(fresh.rows('appFoundationalDocument'))).toEqual(
      stable(original.rows('appFoundationalDocument'))
    );
    expect(stable(fresh.rows('appDocumentCollection'))).toEqual(
      stable(original.rows('appDocumentCollection'))
    );
  });

  it('carries every section key, so a seeded export keys what the surfaces select', async () => {
    const file = await exportDocumentsFile();
    const initiation = file.documents.find((document) => document.id === 'the_initiation')!;
    expect(initiation.blocks.every((block) => block.section !== undefined)).toBe(true);
    expect(new Set(initiation.blocks.map((block) => block.section))).toEqual(
      new Set(['welcome', 'invitation', 'guide', null])
    );
  });
});

describe('importing', () => {
  it('previews without writing, applies as the admin, and a second apply writes nothing', async () => {
    const file = await exportDocumentsFile();
    const mission = file.documents.find((document) => document.id === 'the_mission')!;
    mission.title = 'The Mission, imported';
    const before = db.current!.fingerprint();

    const preview = await previewDocumentsImport(file, false);
    expect(writes(preview)).toEqual(['update document:the_mission title']);
    expect(db.current!.fingerprint()).toBe(before);

    const applied = await applyDocumentsImport(file, false, EDITOR);
    expect(writes(applied)).toEqual(['update document:the_mission title']);
    const revisions = db
      .current!.rows('appFoundationalDocumentRevision')
      .filter((row) => row.documentId === 'the_mission');
    expect(revisions.at(-1)).toMatchObject({
      revision: 2,
      origin: 'admin',
      editorId: EDITOR,
      title: 'The Mission, imported',
    });

    const again = await applyDocumentsImport(file, false, EDITOR);
    expect(again.writesNothing).toBe(true);
    expect(db.current!.rows('appFoundationalDocumentRevision')).toHaveLength(revisions.length + 6);
  });

  it('refuses a removal import that drops a document a surface renders, and writes nothing', async () => {
    const file = await exportDocumentsFile();
    file.documents = file.documents.filter((document) => document.id !== 'the_mission');
    file.collection.suggestedOrder = file.collection.suggestedOrder.filter(
      (id) => id !== 'the_mission'
    );
    const before = db.current!.fingerprint();

    const plan = await previewDocumentsImport(file, true);
    expect(plan.refusals.join(' ')).toContain('"the_mission" is missing from the file');
    await expect(applyDocumentsImport(file, true, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'import_refused' },
    });
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('refuses changed Terms that keep their version, and takes them with a new one', async () => {
    const file = await exportDocumentsFile();
    const terms = file.documents.find((document) => document.id === 'terms_of_use')!;
    terms.title = 'Terms, reworded';

    expect((await previewDocumentsImport(file, false)).refusals.join(' ')).toContain(
      '"version" to "1.2"'
    );

    terms.version = '1.2';
    const plan = await applyDocumentsImport(file, false, EDITOR);
    expect(writes(plan)).toEqual(['update document:terms_of_use title,version']);
  });

  it('refuses her original file, which carries no section keys, naming the surfaces', async () => {
    const { readFoundationalDocumentsFile } =
      await import('@/lib/app/content/seed-input/foundational-seed');
    const plan = await previewDocumentsImport(readFoundationalDocumentsFile(), false);
    expect(plan.refusals.join(' ')).toContain('the welcome email');
  });

  it('refuses a file that is not a documents file, with each problem named', async () => {
    await expect(previewDocumentsImport({ collection: {} }, false)).rejects.toMatchObject({
      status: 400,
      details: { errors: expect.arrayContaining([expect.objectContaining({ path: 'documents' })]) },
    });
  });

  it('a removal import of a questions file without a question removes it and closes the gap', async () => {
    const file = await exportQuestionsFile();
    file.questions = file.questions
      .filter((question) => question.id !== 'q02')
      .map((question, index) => ({ ...question, number: index + 1 }));
    file.content.questionCount = file.questions.length;

    const plan = await applyQuestionsImport(file, true, EDITOR);

    expect(writes(plan)).toContain('remove question:q02');
    const numbers = db
      .current!.rows('appDiscoveryQuestion')
      .map((row) => row.number as number)
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 29 }, (_, index) => index + 1));
  });

  it('a resources file naming a retired resource leaves it retired', async () => {
    await createResource(
      'kept',
      {
        kind: 'video',
        title: 'K',
        subtitle: 'k',
        relatesTo: null,
        duration: '1:00',
        href: 'https://example.com/k',
      },
      EDITOR
    );
    const withKept = await exportResourcesFile();
    await setResourceRetired('kept', true, 1, EDITOR);

    const plan = await applyResourcesImport(withKept, false, EDITOR);

    expect(plan.sections.find((section) => section.entity === 'resource')?.skippedRetired).toEqual([
      'kept',
    ]);
    expect(db.current!.rows('appResource').find((row) => row.id === 'kept')).toMatchObject({
      retired: true,
    });
  });

  it('a removal import of a module structure file missing a roster module is refused', async () => {
    const file = await exportJourneyFile();
    file.modules = file.modules.slice(0, -1);
    file.tiers = file.tiers.map((tier) => ({
      ...tier,
      modules: tier.modules.filter((id) => file.modules.some((m) => m.id === id)),
    }));

    await expect(applyJourneyImport(file, true, EDITOR)).rejects.toMatchObject({ status: 409 });
  });
});
