/**
 * An admin edit is what every client is served on its next request, per
 * collection (f-content-seeds t-91, done-when 1, 3 and 4).
 *
 * Runs the REAL seeds, the REAL admin services and the REAL public routes
 * against one in-memory database (`tests/helpers/app/content-db-fake.ts`), so
 * nothing between the write and the response is mocked: not the store, not the
 * view, not the ETag. Each case reads the public API, edits through the admin
 * service, and reads it again, asserting the new words and a different ETag.
 *
 * Also here, because they are the same chain seen from a member: an edited
 * Disclaimer re-gates someone who had agreed to it, and a retired resource
 * still resolves the chip of a suggestion made before it was retired.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';

const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
const mirror = vi.hoisted(() => ({
  reconcileKnowledgeMirror: vi.fn(async () => ({
    status: 'reconciled',
    created: [],
    reingested: [],
    removed: [],
    unchanged: [],
    failed: [],
  })),
}));

// A proxy, because modules capture `prisma` at import, before the first
// `beforeEach` has built the database this file's cases run against.
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy({}, { get: (_target, key) => db.current?.client[key as string] }),
}));
// The questions and the resource library are served to signed-in members.
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/content/knowledge-mirror', () => mirror);

import { auth } from '@/lib/auth/config';
import { mockAuthenticatedUser } from '@/tests/helpers/auth';
import { GET as getDocumentRoute } from '@/app/api/v1/app/content/documents/[id]/route';
import { GET as getJourneyRoute } from '@/app/api/v1/app/content/journey-structure/route';
import { GET as getQuestionsRoute } from '@/app/api/v1/app/content/discovery-questions/route';
import { GET as getResourcesRoute } from '@/app/api/v1/app/content/resources/route';
import { seedFoundationalDocuments } from '@/lib/app/content/document-store';
import { seedJourneyStructure } from '@/lib/app/content/journey-store';
import { seedDiscoveryQuestions } from '@/lib/app/content/question-store';
import { seedResources } from '@/lib/app/content/resource-store';
import { buildFoundationalSeed } from '@/lib/app/content/seed-input/foundational-seed';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import {
  deleteDocument,
  getDocumentsAdminView,
  restoreDocumentRevision,
  updateDocument,
} from '@/lib/app/content/admin/documents';
import { getJourneyAdminView, updateModule, updateTier } from '@/lib/app/content/admin/journey';
import { getQuestionsAdminView, updateQuestion } from '@/lib/app/content/admin/questions';
import {
  createResource,
  getResourcesAdminView,
  setResourceRetired,
  updateResource,
  updateWords,
} from '@/lib/app/content/admin/resources';
import { getGateStatus } from '@/lib/app/gateway/acknowledgements';
import { loadLibraryForChips, suggestionsFromProvenance } from '@/lib/app/resources/suggest';
import { SUGGEST_RESOURCE_SLUG } from '@/lib/app/resources/suggestion';
import { getRegisteredModule } from '@/lib/framework/modules/registry';
import { moduleSlugFromId } from '@/lib/app/modules/definitions';
import type { DocumentEdit } from '@/lib/app/content/admin/validation';

const EDITOR = 'admin-editor-id';
const MEMBER = 'member-id';

async function seedAll(fake: ContentDbFake) {
  const client = fake.client as unknown as PrismaClient;
  await seedFoundationalDocuments(buildFoundationalSeed(), client);
  await seedJourneyStructure(buildJourneySeed(), client);
  await seedDiscoveryQuestions(buildQuestionSeed(), client);
  await seedResources(buildResourcesSeed(), client);
  fake.insert('user', { id: EDITOR, email: 'editor@example.com' });
}

function get(url: string, etag?: string): NextRequest {
  return new Request(url, {
    headers: etag ? { 'if-none-match': etag } : {},
  }) as unknown as NextRequest;
}

async function served(response: Response) {
  const body = (await response.json()) as { data: Record<string, unknown> };
  return { status: response.status, etag: response.headers.get('ETag'), data: body.data };
}

async function documentFromApi(id: string) {
  return served(
    await getDocumentRoute(get(`http://localhost/api/v1/app/content/documents/${id}`), {
      params: Promise.resolve({ id }),
    })
  );
}

/** The editable fields of a document as the admin view reads them. */
async function editOf(id: string): Promise<{ edit: DocumentEdit; revision: number }> {
  const document = (await getDocumentsAdminView()).documents.find((row) => row.id === id)!;
  return {
    revision: document.revision,
    edit: {
      title: document.title,
      subtitle: document.subtitle,
      category: document.category,
      surface: document.surface,
      placeholders: [...document.placeholders],
      renderStyle: document.renderStyle,
      renderNote: document.renderNote,
      blocks: document.blocks.map((block) => ({ ...block })),
      version: document.version,
    },
  };
}

function firstParagraph(blocks: DocumentEdit['blocks']): number {
  return blocks.findIndex((block) => block.type === 'paragraph');
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser());
  db.current = createContentDbFake();
  await seedAll(db.current);
});

describe('documents', () => {
  it('an edit is what the public API serves next, under a new ETag', async () => {
    const before = await documentFromApi('the_mission');
    const { edit, revision } = await editOf('the_mission');
    const at = firstParagraph(edit.blocks);
    edit.blocks[at] = { ...edit.blocks[at], type: 'paragraph', text: 'Edited in the admin.' };

    const result = await updateDocument('the_mission', edit, revision, EDITOR);
    const after = await documentFromApi('the_mission');

    expect(result.changed).toEqual(['blocks']);
    expect(JSON.stringify(after.data)).toContain('Edited in the admin.');
    expect(JSON.stringify(before.data)).not.toContain('Edited in the admin.');
    expect(after.etag).not.toBe(before.etag);
    expect((after.data.document as { revision: number }).revision).toBe(revision + 1);
  });

  it('writes a revision, as the admin, and reconciles the knowledge mirror', async () => {
    const { edit, revision } = await editOf('the_mission');
    edit.title = 'The Mission, edited';
    mirror.reconcileKnowledgeMirror.mockClear();

    await updateDocument('the_mission', edit, revision, EDITOR);

    const revisions = db
      .current!.rows('appFoundationalDocumentRevision')
      .filter((row) => row.documentId === 'the_mission');
    expect(revisions.map((row) => row.revision)).toEqual([1, 2]);
    expect(revisions[1]).toMatchObject({
      origin: 'admin',
      editorId: EDITOR,
      changedFields: ['title'],
      title: 'The Mission, edited',
    });
    expect(mirror.reconcileKnowledgeMirror).toHaveBeenCalled();
  });

  it('reconciles the mirror again when another save lands while it runs (t-90 note)', async () => {
    const { edit, revision } = await editOf('the_mission');
    const settled = {
      status: 'reconciled',
      created: [],
      reingested: [],
      removed: [],
      unchanged: [],
      failed: [],
    };
    mirror.reconcileKnowledgeMirror.mockClear();
    // The first reconcile runs while a second save commits: it read the rows
    // before that save, so what it mirrored is already stale.
    mirror.reconcileKnowledgeMirror.mockImplementationOnce(async () => {
      await (
        db.current!.client.appFoundationalDocument as {
          update: (args: unknown) => Promise<unknown>;
        }
      ).update({
        where: { id: 'about_the_creator' },
        data: { title: 'Saved meanwhile', revision: 2 },
      });
      return settled;
    });

    await updateDocument('the_mission', { ...edit, title: 'Mine' }, revision, EDITOR);

    expect(mirror.reconcileKnowledgeMirror).toHaveBeenCalledTimes(2);
  });

  it('refuses a save made against a revision someone else has moved on from', async () => {
    const { edit, revision } = await editOf('the_mission');
    await updateDocument('the_mission', { ...edit, title: 'First' }, revision, EDITOR);

    await expect(
      updateDocument('the_mission', { ...edit, title: 'Second' }, revision, EDITOR)
    ).rejects.toMatchObject({
      status: 409,
      details: { reason: 'revision_moved' },
    });
    expect((await documentFromApi('the_mission')).data.document).toMatchObject({ title: 'First' });
  });

  it('a save that changes nothing writes nothing', async () => {
    const { edit, revision } = await editOf('the_mission');
    const before = db.current!.fingerprint();
    const result = await updateDocument('the_mission', edit, revision, EDITOR);
    expect(result.changed).toEqual([]);
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('refuses to drop a section key a surface selects by, and names the reader', async () => {
    const { edit, revision } = await editOf('the_initiation');
    const unkeyed = edit.blocks.map((block) =>
      block.section === 'welcome' ? { ...block, section: null } : block
    );

    await expect(
      updateDocument('the_initiation', { ...edit, blocks: unkeyed }, revision, EDITOR)
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('the welcome email'),
    });
  });

  it('keeps the single-line cadence: each paragraph stays its own block', async () => {
    const { edit, revision } = await editOf('the_initiation');
    const count = edit.blocks.length;
    const at = firstParagraph(edit.blocks);
    edit.blocks[at] = {
      ...edit.blocks[at],
      type: 'paragraph',
      text: 'Welcome, {{first_name}}. Edited.',
    };

    await updateDocument('the_initiation', edit, revision, EDITOR);
    const document = (await documentFromApi('the_initiation')).data.document as {
      blocks: unknown[];
      renderStyle: string;
    };
    expect(document.blocks).toHaveLength(count);
    expect(document.renderStyle).toBe('cadence');
  });

  it('cannot delete a document a surface renders, and says which surfaces', async () => {
    for (const id of ['the_initiation', 'disclaimer', 'terms_of_use', 'the_mission']) {
      await expect(deleteDocument(id, EDITOR)).rejects.toMatchObject({
        status: 409,
        details: { reason: 'has_readers' },
      });
    }
    expect(db.current!.rows('appFoundationalDocument')).toHaveLength(7);
  });
});

describe('the acknowledgement gate', () => {
  it('editing the Disclaimer mints a new version and gates again someone who had agreed', async () => {
    const { edit, revision } = await editOf('disclaimer');
    const agreedTo = edit.version;
    db.current!.insert(
      'appAcknowledgement',
      { id: 'a1', userId: MEMBER, kind: 'disclaimer', documentVersion: agreedTo },
      { id: 'a2', userId: MEMBER, kind: 'terms', documentVersion: agreedTo },
      { id: 'a3', userId: MEMBER, kind: 'age_18', documentVersion: '18' }
    );
    expect((await getGateStatus(MEMBER)).complete).toBe(true);

    const at = firstParagraph(edit.blocks);
    edit.blocks[at] = { ...edit.blocks[at], type: 'paragraph', text: 'A reworded clause.' };
    const result = await updateDocument('disclaimer', edit, revision, EDITOR);

    expect(result.mintedVersion).toBe('1.2');
    expect((await documentFromApi('disclaimer')).data.document).toMatchObject({ version: '1.2' });
    const status = await getGateStatus(MEMBER);
    expect(status.complete).toBe(false);
    expect(status.outstanding).toEqual(['disclaimer']);
  });

  it('a change that leaves the words alone mints nothing and gates nobody again', async () => {
    const { edit, revision } = await editOf('terms_of_use');
    const result = await updateDocument(
      'terms_of_use',
      { ...edit, surface: 'terms_page' },
      revision,
      EDITOR
    );
    expect(result.mintedVersion).toBeNull();
    expect(result.document.version).toBe(edit.version);
  });

  it('restoring earlier words of the Terms is a new revision, at a new version', async () => {
    const { edit, revision } = await editOf('terms_of_use');
    const edited = await updateDocument(
      'terms_of_use',
      { ...edit, title: 'Terms, edited' },
      revision,
      EDITOR
    );
    expect(edited.mintedVersion).toBe('1.2');

    const restored = await restoreDocumentRevision(
      'terms_of_use',
      1,
      edited.document.revision,
      EDITOR
    );

    expect(restored.document).toMatchObject({ title: edit.title, version: '1.3', revision: 3 });
  });
});

describe('journey', () => {
  it('a module title edit is what the API and the AI’s registered module say next', async () => {
    const before = await served(
      await getJourneyRoute(get('http://localhost/api/v1/app/content/journey-structure'))
    );
    const journeyModule = (await getJourneyAdminView()).structure!.modules[2];

    await updateModule(
      journeyModule.id,
      {
        displayNumber: journeyModule.displayNumber,
        title: 'Boundaries, edited',
        subtitle: journeyModule.subtitle,
        chartTitle: journeyModule.chartTitle,
        phases: journeyModule.phases.map((phase) => ({ ...phase })) as never,
        phaseTiers: journeyModule.phaseTiers as never,
        produces: journeyModule.produces as never,
      },
      journeyModule.revision,
      EDITOR
    );
    const after = await served(
      await getJourneyRoute(get('http://localhost/api/v1/app/content/journey-structure'))
    );

    expect(JSON.stringify(after.data)).toContain('Boundaries, edited');
    expect(after.etag).not.toBe(before.etag);
    expect(getRegisteredModule(moduleSlugFromId(journeyModule.id))?.name).toBe(
      'Boundaries, edited'
    );
  });

  it('a tier intent edit is served next, and clearing a module subtitle removes it', async () => {
    const structure = (await getJourneyAdminView()).structure!;
    const tier = structure.tiers[1];
    await updateTier(
      tier.id,
      { label: tier.label, intent: 'A new intent.' },
      tier.revision,
      EDITOR
    );
    const journeyModule = structure.modules.find((entry) => entry.subtitle !== null)!;
    await updateModule(
      journeyModule.id,
      {
        displayNumber: journeyModule.displayNumber,
        title: journeyModule.title,
        subtitle: null,
        chartTitle: journeyModule.chartTitle,
        phases: journeyModule.phases.map((phase) => ({ ...phase })) as never,
        phaseTiers: journeyModule.phaseTiers as never,
        produces: journeyModule.produces as never,
      },
      journeyModule.revision,
      EDITOR
    );

    const after = (await getJourneyAdminView()).structure!;
    expect(after.tiers[1]).toMatchObject({ intent: 'A new intent.', revision: 2 });
    expect(after.modules.find((entry) => entry.id === journeyModule.id)?.subtitle).toBeNull();
  });
});

describe('discovery questions', () => {
  it('a question edit is served next, under a new ETag', async () => {
    const before = await served(
      await getQuestionsRoute(get('http://localhost/api/v1/app/content/discovery-questions'))
    );
    const question = (await getQuestionsAdminView()).set!.questions[2];

    await updateQuestion(
      question.id,
      {
        text: 'A reworded question?',
        inputType: 'long_text',
        hint: null,
        conditionalFollowUp: null,
      },
      question.revision,
      EDITOR
    );
    const after = await served(
      await getQuestionsRoute(get('http://localhost/api/v1/app/content/discovery-questions'))
    );

    expect(JSON.stringify(after.data)).toContain('A reworded question?');
    expect(after.etag).not.toBe(before.etag);
  });
});

describe('resources', () => {
  async function libraryFromApi() {
    return served(await getResourcesRoute(get('http://localhost/api/v1/app/content/resources')));
  }

  it('an added and then edited resource is served next, under a new ETag each time', async () => {
    const empty = await libraryFromApi();
    await createResource(
      'a-video',
      {
        kind: 'video',
        title: 'A video',
        subtitle: 'For the start.',
        relatesTo: null,
        duration: '6:12',
        href: 'https://example.com/video',
      },
      EDITOR
    );
    const added = await libraryFromApi();
    await updateResource(
      'a-video',
      {
        kind: 'video',
        title: 'A video, retitled',
        subtitle: 'For the start.',
        relatesTo: null,
        duration: '6:12',
        href: 'https://example.com/video',
      },
      1,
      EDITOR
    );
    const edited = await libraryFromApi();

    expect(JSON.stringify(added.data)).toContain('A video');
    expect(JSON.stringify(edited.data)).toContain('A video, retitled');
    expect(new Set([empty.etag, added.etag, edited.etag]).size).toBe(3);
  });

  it('a retired resource leaves the library but still resolves a past suggestion’s chip', async () => {
    await createResource(
      'the-reading',
      {
        kind: 'article',
        title: 'An article',
        subtitle: 'Her words.',
        relatesTo: null,
        readingTime: '8 min',
        documentId: 'the_mission',
      },
      EDITOR
    );
    const provenance = {
      capabilityCalls: [
        { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: 'the-reading' } },
      ],
    };

    await setResourceRetired('the-reading', true, 1, EDITOR);

    const library = await libraryFromApi();
    expect(JSON.stringify(library.data)).not.toContain('the-reading');
    const chips = suggestionsFromProvenance(provenance, await loadLibraryForChips([provenance]));
    expect(chips).toEqual([expect.objectContaining({ id: 'the-reading', title: 'An article' })]);
    // Never deleted: the row and its history are both still there.
    expect(db.current!.rows('appResource').find((row) => row.id === 'the-reading')).toMatchObject({
      retired: true,
    });
  });

  it('her words must stay word for word what her document says', async () => {
    const words = (await getResourcesAdminView()).words.find((row) => row.key === 'default')!;
    expect(words.sourceCollection).toBe('foundational_documents');
    const edit = {
      quote: words.quote,
      paragraphs: [...words.paragraphs],
      source: { collection: 'foundational_documents' as const, id: words.sourceId },
    };

    await expect(
      updateWords('default', { ...edit, quote: 'Words she never wrote.' }, words.revision, EDITOR)
    ).rejects.toMatchObject({
      status: 400,
      details: { reason: 'not_verbatim', passages: ['Words she never wrote.'] },
    });
    // A shorter excerpt of the same passage is still hers, verbatim.
    const shorter = words.paragraphs[0].slice(0, 40);
    const saved = await updateWords(
      'default',
      { ...edit, paragraphs: [shorter] },
      words.revision,
      EDITOR
    );
    expect(saved.changed).toEqual(['paragraphs']);
  });

  it('an edit keeps the id, so a past suggestion resolves to the new words', async () => {
    await createResource(
      'kept-id',
      {
        kind: 'video',
        title: 'Before',
        subtitle: 'x',
        relatesTo: null,
        duration: '1:00',
        href: 'https://example.com/a',
      },
      EDITOR
    );
    await updateResource(
      'kept-id',
      {
        kind: 'video',
        title: 'After',
        subtitle: 'x',
        relatesTo: null,
        duration: '1:00',
        href: 'https://example.com/a',
      },
      1,
      EDITOR
    );
    const provenance = {
      capabilityCalls: [
        { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: 'kept-id' } },
      ],
    };
    const chips = suggestionsFromProvenance(provenance, await loadLibraryForChips([provenance]));
    expect(chips).toEqual([expect.objectContaining({ id: 'kept-id', title: 'After' })]);
  });
});
