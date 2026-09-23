/**
 * The knowledge mirror (f-content-seeds t-90): her words about the work, put
 * into the knowledge base and kept in step with the rows.
 *
 * Asserted against a stateful in-memory stand-in for the tables the reconcile
 * reads and writes, with the platform's upload / re-chunk / delete replaced by
 * fakes that write into the same store. That is what lets a case say "after the
 * write, her sentence is findable; after the row is removed, it is not" rather
 * than "some method was called" (`fp6`). A unit test here has no database
 * (`B9`), so the fake search is a substring match over the fake chunks. It
 * proves the wiring. Retrieval by meaning was checked against the dev database
 * at build: the PR body has the query and its hits.
 *
 * @see lib/app/content/knowledge-mirror.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import type { seededDocumentRows as SeededDocumentRows } from '@/tests/helpers/app/foundational-documents';

type FoundationalRow = ReturnType<typeof SeededDocumentRows>[number];

// ---------------------------------------------------------------------------
// The in-memory store
// ---------------------------------------------------------------------------

interface KnowledgeDocument {
  id: string;
  name: string;
  fileName: string;
  fileHash: string;
  status: string;
  chunkCount: number;
  metadata: Record<string, unknown> | null;
  uploadedBy: string;
  chunks: string[];
}

const store = vi.hoisted(() => ({
  foundational: [] as FoundationalRow[],
  documents: [] as KnowledgeDocument[],
  designations: [] as {
    documentId: string;
    sourceKey: string | null;
    designatedBy: string | null;
  }[],
  documentTags: [] as { documentId: string; tagId: string }[],
  tags: [] as { id: string; slug: string }[],
  users: [{ id: 'service-user' }] as { id: string }[],
  nextId: 1,
  /** Set to make the next upload fail the way an embedding outage does. */
  failNextUpload: false,
}));

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const tagSlug = (tagId: string) => store.tags.find((tag) => tag.id === tagId)?.slug;

vi.mock('@/lib/db/client', () => {
  const inList = (value: string, filter?: { in?: string[] }) =>
    !filter?.in || filter.in.includes(value);
  return {
    prisma: {
      appFoundationalDocument: {
        findMany: vi.fn(async () =>
          [...store.foundational].sort((a, b) => Number(a.position) - Number(b.position))
        ),
      },
      appKnowledgeDesignation: {
        findMany: vi.fn(async ({ where }: { where: { sourceKey: { startsWith: string } } }) =>
          store.designations.filter((row) => row.sourceKey?.startsWith(where.sourceKey.startsWith))
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { documentId: string } }) =>
            store.designations.find((row) => row.documentId === where.documentId) ?? null
        ),
        create: vi.fn(
          async ({
            data,
          }: {
            data: { documentId: string; sourceKey: string; designatedBy: null };
          }) => {
            // The primary key.
            if (store.designations.some((row) => row.documentId === data.documentId)) {
              throw new Error('Unique constraint failed on documentId');
            }
            store.designations.push({ ...data });
            return data;
          }
        ),
      },
      aiKnowledgeDocument: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          store.documents.filter((document) => where.id.in.includes(document.id))
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Partial<KnowledgeDocument> }) => {
            const document = store.documents.find((row) => row.id === where.id)!;
            Object.assign(document, data);
            return document;
          }
        ),
        deleteMany: vi.fn(
          async ({ where }: { where: { fileHash: string; fileName: string; status: string } }) => {
            const before = store.documents.length;
            store.documents = store.documents.filter(
              (row) =>
                !(
                  row.fileHash === where.fileHash &&
                  row.fileName === where.fileName &&
                  row.status === where.status
                )
            );
            return { count: before - store.documents.length };
          }
        ),
      },
      aiKnowledgeDocumentTag: {
        findMany: vi.fn(
          async ({ where }: { where: { documentId: string; tag: { slug: { in: string[] } } } }) =>
            store.documentTags
              .filter(
                (row) =>
                  row.documentId === where.documentId &&
                  inList(tagSlug(row.tagId) ?? '', where.tag.slug)
              )
              .map((row) => ({ tag: { slug: tagSlug(row.tagId) } }))
        ),
        createMany: vi.fn(async ({ data }: { data: { documentId: string; tagId: string }[] }) => {
          for (const row of data) {
            if (
              !store.documentTags.some(
                (existing) => existing.documentId === row.documentId && existing.tagId === row.tagId
              )
            ) {
              store.documentTags.push(row);
            }
          }
          return { count: data.length };
        }),
      },
      knowledgeTag: {
        findMany: vi.fn(async ({ where }: { where: { slug: { in: string[] } } }) =>
          store.tags.filter((tag) => where.slug.in.includes(tag.slug))
        ),
      },
      user: {
        findFirst: vi.fn(async () => store.users[0] ?? null),
      },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    },
  };
});

vi.mock('@/lib/orchestration/knowledge/document-manager', () => {
  const chunk = (text: string) => text.split('\n\n').filter((part) => part.trim().length > 0);
  return {
    parseDocumentMetadata: (raw: unknown) => raw as Record<string, unknown> | null,
    uploadDocument: vi.fn(
      async (content: string, fileName: string, userId: string, _url?: string, name?: string) => {
        const fileHash = hash(content);
        // The platform's dedup: an identical READY document comes back as is.
        const same = store.documents.find(
          (row) => row.fileHash === fileHash && row.status === 'ready'
        );
        if (same) return same;
        const document: KnowledgeDocument = {
          id: `kd-${store.nextId++}`,
          name: name ?? fileName,
          fileName,
          fileHash,
          status: 'processing',
          chunkCount: 0,
          metadata: null,
          uploadedBy: userId,
          chunks: [],
        };
        store.documents.push(document);
        if (store.failNextUpload) {
          store.failNextUpload = false;
          document.status = 'failed';
          throw new Error('Embedding provider unavailable');
        }
        document.chunks = chunk(content);
        document.chunkCount = document.chunks.length;
        document.status = 'ready';
        document.metadata = { rawContent: content };
        return document;
      }
    ),
    rechunkDocument: vi.fn(async (documentId: string) => {
      const document = store.documents.find((row) => row.id === documentId)!;
      const raw = document.metadata?.rawContent;
      const content = typeof raw === 'string' ? raw : '';
      document.chunks = chunk(content);
      document.chunkCount = document.chunks.length;
      document.status = 'ready';
      return document;
    }),
    deleteDocument: vi.fn(async (documentId: string) => {
      store.documents = store.documents.filter((row) => row.id !== documentId);
      // The hand-written FKs cascade.
      store.designations = store.designations.filter((row) => row.documentId !== documentId);
      store.documentTags = store.documentTags.filter((row) => row.documentId !== documentId);
    }),
  };
});

vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  invalidateAllAgentAccess: vi.fn(),
}));
vi.mock('@/lib/orchestration/chat/context-builder', () => ({ clearContextCache: vi.fn() }));

import {
  deleteDocument,
  rechunkDocument,
  uploadDocument,
} from '@/lib/orchestration/knowledge/document-manager';
import { invalidateAllAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { clearContextCache } from '@/lib/orchestration/chat/context-builder';
import {
  foundationalSourceKey,
  isMirrored,
  reconcileKnowledgeMirror,
  renderMirrorText,
} from '@/lib/app/content/knowledge-mirror';
import { DESIGNATION_TAG_SLUGS } from '@/lib/app/voice/designation';
import { seededDocumentRows } from '@/tests/helpers/app/foundational-documents';

/** The fake `searchKnowledge`: which mirrored documents hold this sentence. */
function documentsHolding(sentence: string): string[] {
  return store.documents
    .filter((document) => document.chunks.some((chunk) => chunk.includes(sentence)))
    .map((document) => document.name);
}

function designationOf(sourceKey: string) {
  const row = store.designations.find((designation) => designation.sourceKey === sourceKey);
  if (!row) return null;
  return {
    documentId: row.documentId,
    slugs: store.documentTags
      .filter((tag) => tag.documentId === row.documentId)
      .map((tag) => tagSlug(tag.tagId))
      .sort(),
  };
}

/** A sentence of hers, from The Mission. */
const HER_SENTENCE =
  'This app exists because transformation should not belong exclusively to those who can afford private coaching.';

const MIRRORED_IDS = [
  'the_initiation',
  'the_heart_behind_lelanea',
  'the_mission',
  'about_the_creator',
  'the_lineage_of_lelanea',
];

beforeEach(() => {
  vi.clearAllMocks();
  store.foundational = seededDocumentRows().map((row) => structuredClone(row));
  store.documents = [];
  store.designations = [];
  store.documentTags = [];
  store.tags = DESIGNATION_TAG_SLUGS.map((slug, index) => ({ id: `tag-${index}`, slug }));
  store.users = [{ id: 'service-user' }];
  store.nextId = 1;
  store.failNextUpload = false;
});

describe('what is mirrored', () => {
  it('mirrors every non-legal document and neither legal one', () => {
    const rows = seededDocumentRows();
    // The population is the real seed, and it holds both kinds.
    expect(rows.filter((row) => row.category === 'legal').map((row) => row.id)).toEqual([
      'disclaimer',
      'terms_of_use',
    ]);

    const mirrored = rows.filter((row) => isMirrored({ category: row.category as 'legal' }));
    expect(mirrored.map((row) => row.id)).toEqual(MIRRORED_IDS);
  });

  it('renders the title, the subtitle and every block, without merge fields', () => {
    const text = renderMirrorText({
      title: 'The Initiation',
      subtitle: 'A welcome',
      blocks: [
        { type: 'paragraph', text: 'Welcome, {{first_name}}.', section: null },
        { type: 'paragraph', text: 'You, {{first_name}}, are far more.', section: null },
        { type: 'heading', text: 'Begin', level: 2, section: null },
        { type: 'list', style: 'unordered', items: ['one', 'two'], section: null },
      ],
    });

    expect(text).toBe(
      '# The Initiation\n\nA welcome\n\nWelcome.\n\nYou are far more.\n\n### Begin\n\n- one\n- two'
    );
  });

  it('leaves no merge field in any mirrored document of the real seed', () => {
    const initiation = seededDocumentRows().find((row) => row.id === 'the_initiation');
    // The population carries the field, so its absence below is not free.
    expect(JSON.stringify(initiation?.blocks)).toContain('{{first_name}}');

    for (const row of store.foundational) {
      const text = renderMirrorText(row as Parameters<typeof renderMirrorText>[0]);
      expect(text).not.toContain('{{');
    }
  });
});

describe('reconcileKnowledgeMirror', () => {
  it('makes her sentence findable after the write, and not after the row is removed', async () => {
    expect(documentsHolding(HER_SENTENCE)).toEqual([]);

    const first = await reconcileKnowledgeMirror();

    expect(first.created).toEqual(MIRRORED_IDS.map(foundationalSourceKey));
    expect(first.failed).toEqual([]);
    expect(documentsHolding(HER_SENTENCE)).toEqual(['The Mission']);

    // Remove the row; four others remain, so this is a removal and not an
    // unseeded database.
    store.foundational = store.foundational.filter((row) => row.id !== 'the_mission');
    const second = await reconcileKnowledgeMirror();

    expect(second.removed).toEqual([foundationalSourceKey('the_mission')]);
    expect(documentsHolding(HER_SENTENCE)).toEqual([]);
    expect(designationOf(foundationalSourceKey('the_mission'))).toBeNull();
    // The rest are untouched.
    expect(second.unchanged).toHaveLength(4);
  });

  it('designates each mirror knowledge/public, keyed to its row, and mirrors no legal text', async () => {
    await reconcileKnowledgeMirror();

    for (const id of MIRRORED_IDS) {
      expect(designationOf(foundationalSourceKey(id))?.slugs).toEqual([
        'purpose-knowledge',
        'sensitivity-public',
      ]);
    }
    expect(store.documents).toHaveLength(MIRRORED_IDS.length);
    expect(store.designations.map((row) => row.sourceKey)).not.toContain(
      foundationalSourceKey('disclaimer')
    );
    expect(store.designations.every((row) => row.designatedBy === null)).toBe(true);
  });

  it('writes nothing on a second run with unchanged text', async () => {
    await reconcileKnowledgeMirror();
    const snapshot = structuredClone(store.documents);
    vi.clearAllMocks();

    const second = await reconcileKnowledgeMirror();

    expect(second.unchanged).toHaveLength(MIRRORED_IDS.length);
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(rechunkDocument).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(store.documents).toEqual(snapshot);
    expect(invalidateAllAgentAccess).not.toHaveBeenCalled();
    expect(clearContextCache).not.toHaveBeenCalled();
  });

  it('re-ingests changed text into the same document, keeping an admin re-designation', async () => {
    await reconcileKnowledgeMirror();
    const key = foundationalSourceKey('the_mission');
    const before = designationOf(key)!;

    // An admin re-designates it `both` through the existing surface.
    const both = store.tags.find((tag) => tag.slug === 'purpose-both')!;
    store.documentTags = store.documentTags.filter(
      (row) => !(row.documentId === before.documentId && tagSlug(row.tagId)?.startsWith('purpose-'))
    );
    store.documentTags.push({ documentId: before.documentId, tagId: both.id });

    // And her words change.
    const mission = store.foundational.find((row) => row.id === 'the_mission')!;
    mission.blocks = [{ type: 'paragraph', text: 'A newly written sentence.', section: null }];

    const result = await reconcileKnowledgeMirror();

    expect(result.reingested).toEqual([key]);
    expect(rechunkDocument).toHaveBeenCalledWith(before.documentId);
    expect(designationOf(key)).toEqual({
      documentId: before.documentId,
      slugs: ['purpose-both', 'sensitivity-public'],
    });
    expect(documentsHolding('A newly written sentence.')).toEqual(['The Mission']);
    expect(documentsHolding(HER_SENTENCE)).toEqual([]);
    expect(invalidateAllAgentAccess).toHaveBeenCalled();
    expect(clearContextCache).toHaveBeenCalled();
  });

  it('returns without a removal pass when there are no foundational rows at all', async () => {
    await reconcileKnowledgeMirror();
    expect(store.documents).toHaveLength(MIRRORED_IDS.length);

    store.foundational = [];
    const result = await reconcileKnowledgeMirror();

    expect(result.status).toBe('not_seeded');
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(store.documents).toHaveLength(MIRRORED_IDS.length);
  });

  it('reports a failed upload, removes the failed row, and still mirrors the rest', async () => {
    store.failNextUpload = true;

    const result = await reconcileKnowledgeMirror();

    expect(result.failed).toEqual([
      {
        sourceKey: foundationalSourceKey('the_initiation'),
        error: 'Embedding provider unavailable',
      },
    ]);
    expect(result.created).toHaveLength(MIRRORED_IDS.length - 1);
    expect(store.documents.some((row) => row.status === 'failed')).toBe(false);

    // The next run is the retry.
    const retry = await reconcileKnowledgeMirror();
    expect(retry.created).toEqual([foundationalSourceKey('the_initiation')]);
  });

  it('leaves a document undesignated when the vocabulary is missing, and designates it once seeded', async () => {
    const vocabulary = store.tags;
    store.tags = [];

    const first = await reconcileKnowledgeMirror();

    expect(first.failed).toHaveLength(MIRRORED_IDS.length);
    expect(first.failed[0].error).toContain('npm run db:seed');
    expect(store.designations).toEqual([]);

    store.tags = vocabulary;
    const second = await reconcileKnowledgeMirror();

    // Uploaded last time and deduplicated now, so no second document.
    expect(second.failed).toEqual([]);
    expect(store.documents).toHaveLength(MIRRORED_IDS.length);
    expect(designationOf(foundationalSourceKey('the_mission'))?.slugs).toEqual([
      'purpose-knowledge',
      'sensitivity-public',
    ]);
  });

  it('leaves a designation an admin cleared as cleared', async () => {
    await reconcileKnowledgeMirror();
    const key = foundationalSourceKey('the_mission');
    const { documentId } = designationOf(key)!;
    // The admin sets purpose and sensitivity to none: `setDesignation` removes
    // both families' tags and leaves the row.
    expect(designationOf(key)?.slugs).toHaveLength(2);
    store.documentTags = store.documentTags.filter((row) => row.documentId !== documentId);
    vi.clearAllMocks();

    const result = await reconcileKnowledgeMirror();

    expect(result.unchanged).toContain(key);
    expect(designationOf(key)).toEqual({ documentId, slugs: [] });
    expect(invalidateAllAgentAccess).not.toHaveBeenCalled();
  });

  it('keeps a tag an admin set before the designation row existed', async () => {
    const vocabulary = store.tags;
    store.tags = vocabulary.filter((tag) => tag.slug !== 'sensitivity-public');
    await reconcileKnowledgeMirror();
    // Uploaded, undesignated. An admin marks the mission `voice` meanwhile.
    const mission = store.documents.find((row) => row.name === 'The Mission')!;
    const voice = vocabulary.find((tag) => tag.slug === 'purpose-voice')!;
    store.documentTags.push({ documentId: mission.id, tagId: voice.id });

    store.tags = vocabulary;
    await reconcileKnowledgeMirror();

    expect(designationOf(foundationalSourceKey('the_mission'))?.slugs).toEqual([
      'purpose-voice',
      'sensitivity-public',
    ]);
  });

  it('refuses to adopt an admin upload that holds the same text', async () => {
    // An admin uploaded exactly the mirror's text. The platform dedups to it.
    const mission = store.foundational.find((row) => row.id === 'the_mission')!;
    const text = renderMirrorText(mission as Parameters<typeof renderMirrorText>[0]);
    store.documents.push({
      id: 'admin-doc',
      name: 'Her mission, uploaded by hand',
      fileName: 'mission.md',
      fileHash: hash(text),
      status: 'ready',
      chunkCount: 1,
      metadata: { rawContent: text },
      uploadedBy: 'admin-1',
      chunks: [text],
    });
    store.designations.push({ documentId: 'admin-doc', sourceKey: null, designatedBy: 'admin-1' });

    const result = await reconcileKnowledgeMirror();

    expect(result.failed.map((failure) => failure.sourceKey)).toEqual([
      foundationalSourceKey('the_mission'),
    ]);
    expect(store.designations.find((row) => row.documentId === 'admin-doc')?.sourceKey).toBeNull();
    expect(result.created).toHaveLength(MIRRORED_IDS.length - 1);
  });

  it('refuses to adopt an admin upload with the same text that nobody designated', async () => {
    const mission = store.foundational.find((row) => row.id === 'the_mission')!;
    const text = renderMirrorText(mission as Parameters<typeof renderMirrorText>[0]);
    store.documents.push({
      id: 'admin-doc',
      name: 'Her mission, uploaded by hand',
      fileName: 'mission.md',
      fileHash: hash(text),
      status: 'ready',
      chunkCount: 1,
      metadata: { rawContent: text },
      uploadedBy: 'admin-1',
      chunks: [text],
    });

    const result = await reconcileKnowledgeMirror();

    expect(result.failed.map((failure) => failure.sourceKey)).toEqual([
      foundationalSourceKey('the_mission'),
    ]);
    expect(store.designations.some((row) => row.documentId === 'admin-doc')).toBe(false);
    expect(store.documentTags.some((row) => row.documentId === 'admin-doc')).toBe(false);
  });
});
