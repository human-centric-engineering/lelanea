/**
 * What each content service refuses, and the one delete it allows
 * (f-content-seeds t-91).
 *
 * The happy paths are in `edit-reaches-clients.test.ts` and the routes' tests;
 * this pins the refusals, because a refusal that quietly stops refusing is the
 * failure nobody notices: a stale save that overwrites, an import into an
 * unseeded database, a document deleted that a surface still renders. Each case
 * also checks the database is unchanged where the refusal says nothing was
 * written.
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
import { storedDocumentBlocksSchema } from '@/lib/app/content/schemas';
import { buildFoundationalSeed } from '@/lib/app/content/seed-input/foundational-seed';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import * as documents from '@/lib/app/content/admin/documents';
import * as journey from '@/lib/app/content/admin/journey';
import * as questions from '@/lib/app/content/admin/questions';
import * as resources from '@/lib/app/content/admin/resources';

const EDITOR = 'editor';

async function seed(fake: ContentDbFake) {
  const client = fake.client as unknown as PrismaClient;
  await seedFoundationalDocuments(buildFoundationalSeed(), client);
  await seedJourneyStructure(buildJourneySeed(), client);
  await seedDiscoveryQuestions(buildQuestionSeed(), client);
  await seedResources(buildResourcesSeed(), client);
}

beforeEach(async () => {
  db.current = createContentDbFake();
  await seed(db.current);
});

const video = {
  kind: 'video' as const,
  title: 'F',
  subtitle: 'f',
  relatesTo: null,
  duration: '1:00',
  href: 'https://example.com/f',
};

/**
 * The live videos, in drawer order. The drafted library ships empty, so these
 * are the ones a test added.
 */
function liveVideoIds(): string[] {
  return db
    .current!.rows('appResource')
    .filter((row) => row.kind === 'video' && !row.retired)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .map((row) => row.id as string);
}

describe('an item that does not exist', () => {
  it.each([
    ['a document', () => documents.listDocumentHistory('nope')],
    ['a document revision', () => documents.restoreDocumentRevision('the_mission', 99, 1, EDITOR)],
    ['a tier', () => journey.listTierHistory('nope')],
    ['a module', () => journey.listModuleHistory('nope')],
    ['a tier revision', () => journey.restoreTierRevision('foundations', 99, 1, EDITOR)],
    ['a tier to save', () => journey.updateTier('nope', { label: 'x', intent: 'y' }, 1, EDITOR)],
    ['a question set', () => questions.listQuestionSetHistory('nope')],
    ['a question', () => questions.listQuestionHistory('nope')],
    ['a question revision', () => questions.restoreQuestionRevision('q01', 99, 1, EDITOR)],
    [
      'a set revision',
      () => questions.restoreQuestionSetRevision('onboarding_discovery_questions', 99, 1, EDITOR),
    ],
    ['a question to delete', () => questions.deleteQuestion('q99', 1, EDITOR)],
    ['a resource', () => resources.listResourceHistory('nope')],
    ['a resource to save', () => resources.updateResource('nope', video, 1, EDITOR)],
    ['a resource revision', () => resources.restoreResourceRevision('nope', 1, 1, EDITOR)],
    ['a resource to retire', () => resources.setResourceRetired('nope', true, 1, EDITOR)],
    ['words', () => resources.listWordsHistory('nope')],
    ['a words revision', () => resources.restoreWordsRevision('default', 99, 1, EDITOR)],
    ['words to delete', () => resources.deleteWords('journey', 1)],
  ])('is a 404 for %s', async (_what, run) => {
    await expect(run()).rejects.toMatchObject({ status: 404 });
  });
});

describe('a save against a revision that has moved', () => {
  // The drafted library ships empty, so there is nothing to go stale until
  // there is something in it. Two, so a reorder has an order to change.
  beforeEach(async () => {
    await resources.createResource('first-video', video, EDITOR);
    await resources.createResource('second-video', { ...video, title: 'G' }, EDITOR);
  });

  it.each([
    ['a tier', () => journey.updateTier('foundations', { label: 'x', intent: 'y' }, 7, EDITOR)],
    [
      'a question',
      () =>
        questions.updateQuestion(
          'q01',
          { text: 'x?', inputType: 'long_text', hint: null, conditionalFollowUp: null },
          7,
          EDITOR
        ),
    ],
    ['a question delete', () => questions.deleteQuestion('q01', 7, EDITOR)],
    ['words', () => resources.deleteWords('module_01_values', 7)],
    ['a resource', () => resources.updateResource(liveVideoIds()[0], video, 7, EDITOR)],
    ['a resource retire', () => resources.setResourceRetired(liveVideoIds()[0], true, 7, EDITOR)],
    [
      'a resource reorder',
      () =>
        resources.reorderResources(
          'video',
          liveVideoIds().map((id) => ({ id, revision: 7 })),
          EDITOR
        ),
    ],
    [
      'a words save',
      async () => {
        const words = (await resources.getResourcesAdminView()).words.find(
          (row) => row.key === 'default'
        )!;
        // A valid edit, so the refusal below is the lock's and nothing else's.
        expect(words.sourceCollection).toBe('foundational_documents');
        return resources.updateWords(
          'default',
          {
            quote: words.quote,
            paragraphs: [...words.paragraphs],
            source: { collection: 'foundational_documents', id: words.sourceId },
          },
          7,
          EDITOR
        );
      },
    ],
    [
      'a reorder',
      () =>
        documents.reorderDocuments(
          db
            .current!.rows('appFoundationalDocument')
            .map((row) => ({ id: row.id as string, revision: 7 })),
          EDITOR
        ),
    ],
  ])('is refused for %s, and writes nothing', async (_what, run) => {
    const before = db.current!.fingerprint();
    await expect(run()).rejects.toMatchObject({
      status: 409,
      details: { reason: 'revision_moved' },
    });
    expect(db.current!.fingerprint()).toBe(before);
  });
});

describe('the one document delete that is allowed', () => {
  it('deletes a document nothing renders, closing the gap in reading order', async () => {
    const file = await documents.exportDocumentsFile();
    file.documents.push({
      id: 'a_new_note',
      title: 'A note',
      subtitle: null,
      category: 'about',
      surface: 'about_note',
      version: '1.0',
      blocks: [{ type: 'paragraph', text: 'Hers.', section: null }],
    });
    file.collection.suggestedOrder.splice(2, 0, 'a_new_note');
    const plan = await documents.applyDocumentsImport(file, false, EDITOR);
    expect(plan.sections.find((section) => section.entity === 'document')?.creates).toEqual([
      expect.objectContaining({ key: 'a_new_note' }),
    ]);

    // Someone else saved it since this page read revision 1.
    await documents.updateDocument(
      'a_new_note',
      {
        title: 'A note, edited',
        subtitle: null,
        category: 'about',
        surface: 'about_note',
        placeholders: [],
        renderStyle: null,
        renderNote: null,
        blocks: storedDocumentBlocksSchema.parse(
          db.current!.rows('appFoundationalDocument').find((row) => row.id === 'a_new_note')!.blocks
        ),
        version: '1.0',
      },
      1,
      EDITOR
    );
    await expect(documents.deleteDocument('a_new_note', 1, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'revision_moved', currentRevision: 2 },
    });

    await documents.deleteDocument('a_new_note', 2, EDITOR);

    const positions = db
      .current!.rows('appFoundationalDocument')
      .map((row) => row.position as number)
      .sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await expect(documents.deleteDocument('a_new_note', 2, EDITOR)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses a document an article opens, naming the article', async () => {
    const file = await documents.exportDocumentsFile();
    file.documents.push({
      id: 'opened',
      title: 'O',
      subtitle: null,
      category: 'about',
      surface: 's',
      version: '1.0',
      blocks: [{ type: 'paragraph', text: 'x', section: null }],
    });
    file.collection.suggestedOrder.push('opened');
    await documents.applyDocumentsImport(file, false, EDITOR);
    await resources.createResource(
      'reads-it',
      {
        kind: 'article',
        title: 'R',
        subtitle: 'r',
        relatesTo: null,
        readingTime: '2 min',
        documentId: 'opened',
      },
      EDITOR
    );

    await expect(documents.deleteDocument('opened', 1, EDITOR)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('reads-it'),
    });

    // A removal import that drops it is refused the same way, in the preview and the apply.
    const without = await documents.exportDocumentsFile();
    without.documents = without.documents.filter((document) => document.id !== 'opened');
    without.collection.suggestedOrder = without.collection.suggestedOrder.filter(
      (id) => id !== 'opened'
    );
    const preview = await documents.previewDocumentsImport(without, true);
    expect(preview.refusals.join(' ')).toContain('the resource "reads-it"');
    await expect(documents.applyDocumentsImport(without, true, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'import_refused' },
    });
    expect(db.current!.rows('appFoundationalDocument').map((row) => row.id)).toContain('opened');
  });

  it('refuses a document a key’s words cite, naming the key', async () => {
    const file = await documents.exportDocumentsFile();
    file.documents.push({
      id: 'cited',
      title: 'C',
      subtitle: null,
      category: 'about',
      surface: 's',
      version: '1.0',
      blocks: [{ type: 'paragraph', text: 'Her words, verbatim.', section: null }],
    });
    file.collection.suggestedOrder.push('cited');
    await documents.applyDocumentsImport(file, false, EDITOR);
    const view = await resources.getResourcesAdminView();
    const key = view.wordsKeyOptions.find((option) => !view.words.some((w) => w.key === option))!;
    await resources.createWords(
      key,
      {
        quote: 'Her words, verbatim.',
        paragraphs: ['Her words, verbatim.'],
        source: { collection: 'foundational_documents', id: 'cited' },
      },
      EDITOR
    );

    // Nothing renders it and no resource opens it, but deleting it would leave
    // words citing a document that is not there — and the library unable to
    // export, import or save them.
    await expect(documents.deleteDocument('cited', 1, EDITOR)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(`the words for "${key}"`),
    });

    const without = await documents.exportDocumentsFile();
    without.documents = without.documents.filter((document) => document.id !== 'cited');
    without.collection.suggestedOrder = without.collection.suggestedOrder.filter(
      (id) => id !== 'cited'
    );
    const preview = await documents.previewDocumentsImport(without, true);
    expect(preview.refusals.join(' ')).toContain(`the words for "${key}"`);
    await expect(documents.applyDocumentsImport(without, true, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'import_refused' },
    });
    expect(db.current!.rows('appFoundationalDocument').map((row) => row.id)).toContain('cited');
  });
});

describe('bringing a resource back', () => {
  it('is refused when it would no longer be servable, and changes nothing', async () => {
    await resources.createResource(
      'for-a-module',
      { ...video, relatesTo: 'module_01_values' },
      EDITOR
    );
    await resources.setResourceRetired('for-a-module', true, 1, EDITOR);
    // Retired while it related to a module that has since left the journey.
    // The roster is code, so stand in for that change on the row itself.
    await (db.current!.client as unknown as PrismaClient).appResource.update({
      where: { id: 'for-a-module' },
      data: { relatesTo: 'module_99_gone' },
    });

    const before = db.current!.fingerprint();
    await expect(
      resources.setResourceRetired('for-a-module', false, 2, EDITOR)
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('module_99_gone') });
    expect(db.current!.fingerprint()).toBe(before);
  });
});

describe('imports that are refused', () => {
  it('refuses every collection into a database that was never seeded', async () => {
    const files = {
      documents: await documents.exportDocumentsFile(),
      journey: await journey.exportJourneyFile(),
      questions: await questions.exportQuestionsFile(),
      resources: await resources.exportResourcesFile(),
    };
    db.current = createContentDbFake();
    // The resource file checks the documents it cites, so they must exist.
    await seedFoundationalDocuments(
      buildFoundationalSeed(),
      db.current.client as unknown as PrismaClient
    );

    expect((await journey.previewJourneyImport(files.journey, false)).refusals.join(' ')).toContain(
      'not been seeded'
    );
    expect(
      (await questions.previewQuestionsImport(files.questions, false)).refusals.join(' ')
    ).toContain('not been seeded');
    expect(
      (await resources.previewResourcesImport(files.resources, false)).refusals.join(' ')
    ).toContain('not been seeded');
    await expect(journey.exportJourneyFile()).rejects.toMatchObject({
      details: { reason: 'nothing_to_export' },
    });
    await expect(questions.exportQuestionsFile()).rejects.toMatchObject({
      details: { reason: 'nothing_to_export' },
    });
    await expect(resources.exportResourcesFile()).rejects.toMatchObject({
      details: { reason: 'nothing_to_export' },
    });
  });

  it('refuses a documents file for another collection, and one that makes a new document gate', async () => {
    const file = await documents.exportDocumentsFile();
    file.collection.id = 'someone_elses';
    file.documents.push({
      id: 'new_terms',
      title: 'T',
      subtitle: null,
      category: 'legal',
      surface: 's',
      version: '1.0',
      requiresAcknowledgement: true,
      blocks: [{ type: 'paragraph', text: 'x', section: null }],
    });
    file.collection.suggestedOrder.push('new_terms');
    const terms = file.documents.find((document) => document.id === 'terms_of_use')!;
    delete terms.requiresAcknowledgement;

    const { refusals } = await documents.previewDocumentsImport(file, false);
    expect(refusals.join(' ')).toContain('"someone_elses"');
    expect(refusals.join(' ')).toContain('"new_terms" is new and asks to be acknowledged');
    expect(refusals.join(' ')).toContain('"terms_of_use" changes whether it must be acknowledged');
  });

  it('refuses a journey file for another app, and a questions file for a module not on the journey', async () => {
    const journeyFile = await journey.exportJourneyFile();
    journeyFile.app.name = 'Elsewhere';
    expect((await journey.previewJourneyImport(journeyFile, false)).refusals.join(' ')).toContain(
      '"Elsewhere"'
    );

    const questionsFile = await questions.exportQuestionsFile();
    questionsFile.content.module = 'module_99_nowhere';
    questionsFile.content.id = 'other_set';
    const { refusals } = await questions.previewQuestionsImport(questionsFile, false);
    expect(refusals.join(' ')).toContain('module_99_nowhere');
    expect(refusals.join(' ')).toContain('"other_set"');
  });

  it('refuses a resource that changes kind, and words that are not hers verbatim', async () => {
    await resources.createResource('shifty', video, EDITOR);
    const file = await resources.exportResourcesFile();
    file.videos = [];
    file.articles.push({
      id: 'shifty',
      title: 'S',
      subtitle: 's',
      relatesTo: null,
      readingTime: '3 min',
      href: 'https://example.com/s',
    });
    file.words.default = { ...file.words.default, quote: 'Not her words at all.' };

    const { refusals } = await resources.previewResourcesImport(file, false);
    expect(refusals.join(' ')).toContain('"shifty" is a video here and an article in the file');
    expect(refusals.join(' ')).toContain('The words for "default" are shown as hers');
  });

  it('applies a removal import that adds one video, retires another and drops a key’s words', async () => {
    await resources.createResource('old-video', video, EDITOR);
    const file = await resources.exportResourcesFile();
    file.videos = [{ ...video, id: 'new-video' }].map(({ kind: _kind, ...rest }) => rest);
    delete file.words.module_01_values;

    const plan = await resources.applyResourcesImport(file, true, EDITOR);

    const section = (entity: string) => plan.sections.find((entry) => entry.entity === entity)!;
    expect(section('resource').creates.map((item) => item.key)).toEqual(['new-video']);
    expect(section('resource').removals.map((item) => item.key)).toEqual(['old-video']);
    expect(section('words').removals.map((item) => item.key)).toEqual(['module_01_values']);
    const rows = db.current!.rows('appResource');
    expect(rows.find((row) => row.id === 'old-video')).toMatchObject({ retired: true });
    expect(rows.find((row) => row.id === 'new-video')).toMatchObject({
      retired: false,
      position: 0,
    });
    expect((await resources.previewResourcesImport(file, true)).writesNothing).toBe(true);
  });
});

describe('small rules', () => {
  it('refuses to remove the last question, which the file format cannot hold', async () => {
    for (const row of db.current!.rows('appDiscoveryQuestion').filter((q) => q.id !== 'q01')) {
      await questions.deleteQuestion(
        row.id as string,
        db.current!.rows('appDiscoveryQuestion').find((q) => q.id === row.id)!.revision as number,
        EDITOR
      );
    }
    // q01 stayed first, so it was never re-numbered: still revision 1.
    await expect(questions.deleteQuestion('q01', 1, EDITOR)).rejects.toMatchObject({
      details: { reason: 'last_question' },
    });
  });

  it('refuses words for a document that does not exist', async () => {
    await expect(
      resources.createWords(
        'journey',
        {
          quote: 'x',
          paragraphs: ['y'],
          source: { collection: 'foundational_documents', id: 'nope' },
        },
        EDITOR
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it('takes Values-module words without a verbatim check it cannot make', async () => {
    const created = await resources.createWords(
      'situations',
      {
        quote: 'Anything.',
        paragraphs: ['At all.'],
        source: { collection: 'values_module', id: 'lesson' },
      },
      EDITOR
    );
    expect(created).toEqual({ key: 'situations' });
  });

  it('names the export files by date', () => {
    const day = new Date('2026-09-23T12:00:00Z');
    expect(documents.documentsExportFilename(day)).toBe(
      'lelanea-foundational-documents-2026-09-23.json'
    );
    expect(journey.journeyExportFilename(day)).toBe('lelanea-module-structure-2026-09-23.json');
    expect(questions.questionsExportFilename(day)).toBe(
      'lelanea-discovery-questions-2026-09-23.json'
    );
    expect(resources.resourcesExportFilename(day)).toBe('lelanea-resources-2026-09-23.json');
  });
});

describe('the journey’s structure is the roster’s', () => {
  it('previews a file whose modules differ from the roster as refused, planning nothing', async () => {
    const file = await journey.exportJourneyFile();
    file.modules[1].number = 42;

    const plan = await journey.previewJourneyImport(file, false);

    expect(plan.refusals.join(' ')).toContain('lib/app/journey/roster.ts');
    expect(plan.writesNothing).toBe(true);
  });

  it('restores a tier’s words as a new revision, and a restore to the same words writes nothing', async () => {
    await journey.updateTier(
      'foundations',
      { label: 'Foundations, edited', intent: 'Edited.' },
      1,
      EDITOR
    );
    const restored = await journey.restoreTierRevision('foundations', 1, 2, EDITOR);
    expect(restored).toMatchObject({ changed: ['label', 'intent'], revision: 3 });
    const again = await journey.restoreTierRevision('foundations', 1, 3, EDITOR);
    expect(again.changed).toEqual([]);
  });
});
