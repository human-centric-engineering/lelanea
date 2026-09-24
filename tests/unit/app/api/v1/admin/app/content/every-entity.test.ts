/**
 * Every content entity through its routes (f-content-seeds t-91): save,
 * history, restore, create, remove, retire and reorder, for each collection,
 * against the real services and the in-memory database. The companion
 * `routes.test.ts` covers the guard, the envelope and the import; this covers
 * what each entity's handler in `lib/app/content/admin/registry.ts` does, and
 * the refusals each service owes (a stale lock, a missing item, the default
 * words, a kind change, a retired id reused).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';
import { mockAdminUser } from '@/tests/helpers/auth';

const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
const audit = vi.hoisted(() => ({ logAdminAction: vi.fn() }));

vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy({}, { get: (_target, key) => db.current?.client[key as string] }),
}));
vi.mock('@/lib/app/content/knowledge-mirror', () => ({
  reconcileKnowledgeMirror: vi.fn(async () => ({ status: 'reconciled', failed: [] })),
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => audit);

import { auth } from '@/lib/auth/config';
import { GET as getCollection } from '@/app/api/v1/admin/app/content/[collection]/route';
import { PUT as reorder } from '@/app/api/v1/admin/app/content/[collection]/order/route';
import { POST as create } from '@/app/api/v1/admin/app/content/[collection]/[entity]/route';
import {
  PUT as save,
  DELETE as remove,
} from '@/app/api/v1/admin/app/content/[collection]/[entity]/[id]/route';
import { GET as history } from '@/app/api/v1/admin/app/content/[collection]/[entity]/[id]/history/route';
import { POST as restore } from '@/app/api/v1/admin/app/content/[collection]/[entity]/[id]/restore/route';
import { PUT as retired } from '@/app/api/v1/admin/app/content/[collection]/[entity]/[id]/retired/route';
import { seedFoundationalDocuments } from '@/lib/app/content/document-store';
import { seedJourneyStructure } from '@/lib/app/content/journey-store';
import { seedDiscoveryQuestions } from '@/lib/app/content/question-store';
import { seedResources } from '@/lib/app/content/resource-store';
import { buildFoundationalSeed } from '@/lib/app/content/seed-input/foundational-seed';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import type { DocumentsAdminView } from '@/lib/app/content/admin/documents';
import type { JourneyAdminView } from '@/lib/app/content/admin/journey';
import type { QuestionsAdminView } from '@/lib/app/content/admin/questions';
import type { ResourcesAdminView } from '@/lib/app/content/admin/resources';

const BASE = 'https://lelanea.com/api/v1/admin/app/content';

function req(method: string, path: string, body?: unknown): NextRequest {
  const request = new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return Object.assign(request, { nextUrl: new URL(request.url) }) as unknown as NextRequest;
}

type Json = {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
};
async function call(response: Promise<Response>): Promise<{ status: number } & Json> {
  const settled = await response;
  return { status: settled.status, ...((await settled.json()) as Json) };
}

const item = (collection: string, entity: string, id: string) => ({
  params: Promise.resolve({ collection, entity, id }),
});
const entity = (collection: string, name: string) => ({
  params: Promise.resolve({ collection, entity: name }),
});
const collectionParams = (collection: string) => ({ params: Promise.resolve({ collection }) });

async function view<T>(collection: string): Promise<T> {
  return (await call(getCollection(req('GET', `/${collection}`), collectionParams(collection))))
    .data as T;
}

async function historyOf(collection: string, name: string, id: string) {
  const body = await call(
    history(req('GET', `/${collection}/${name}/${id}/history`), item(collection, name, id))
  );
  return body.data?.revisions as {
    revision: number;
    origin: string;
    editorEmail: string | null;
    changedFields: string[];
  }[];
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  db.current = createContentDbFake();
  const client = db.current.client as unknown as PrismaClient;
  await seedFoundationalDocuments(buildFoundationalSeed(), client);
  await seedJourneyStructure(buildJourneySeed(), client);
  await seedDiscoveryQuestions(buildQuestionSeed(), client);
  await seedResources(buildResourcesSeed(), client);
  db.current.insert('user', { id: mockAdminUser().user.id, email: 'admin@example.com' });
});

describe('documents', () => {
  it('saves the collection row, carrying a new locale to every document, and refuses a stale one', async () => {
    const { collection } = await view<DocumentsAdminView>('documents');
    const body = {
      title: collection!.title,
      version: collection!.version,
      locale: 'en-GB',
      updatedAt: collection!.updatedAt,
    };

    const saved = await call(
      save(
        req('PUT', '/documents/collection/x', body),
        item('documents', 'collection', collection!.id)
      )
    );
    expect(saved.data?.changed).toEqual(['locale']);
    const after = await view<DocumentsAdminView>('documents');
    expect(new Set(after.documents.map((document) => document.locale))).toEqual(new Set(['en-GB']));
    expect(after.documents[0].revision).toBe(2);

    const stale = await call(
      save(
        req('PUT', '/documents/collection/x', { ...body, title: 'Other' }),
        item('documents', 'collection', collection!.id)
      )
    );
    expect(stale.status).toBe(409);
    expect(stale.error?.details).toMatchObject({ reason: 'revision_moved' });

    const unchanged = await call(
      save(
        req('PUT', '/documents/collection/x', { ...body, updatedAt: after.collection!.updatedAt }),
        item('documents', 'collection', collection!.id)
      )
    );
    expect(unchanged.data?.changed).toEqual([]);
  });

  it('reorders, records each move, and refuses an order that leaves one out', async () => {
    const { documents } = await view<DocumentsAdminView>('documents');
    const order = documents.map((document) => ({ id: document.id, revision: document.revision }));
    const swapped = [order[1], order[0], ...order.slice(2)];

    const moved = await call(
      reorder(req('PUT', '/documents/order', { order: swapped }), collectionParams('documents'))
    );
    expect(moved.data).toEqual({ moved: 2 });
    const after = await view<DocumentsAdminView>('documents');
    expect(after.documents.slice(0, 2).map((document) => document.id)).toEqual([
      documents[1].id,
      documents[0].id,
    ]);
    expect((await historyOf('documents', 'document', documents[0].id))[0]).toMatchObject({
      changedFields: ['position'],
    });

    const short = await call(
      reorder(
        req('PUT', '/documents/order', { order: swapped.slice(1) }),
        collectionParams('documents')
      )
    );
    expect(short.status).toBe(400);
  });

  it('lists a document’s history with who made each revision, and 404s an unknown one', async () => {
    const { documents } = await view<DocumentsAdminView>('documents');
    const mission = documents.find((document) => document.id === 'the_mission')!;
    const {
      id: _id,
      position: _p,
      readers: _r,
      lockedSections: _l,
      sections: _s,
      blockCount: _b,
      revision,
      requiresAcknowledgement: _a,
      locale: _loc,
      ...fields
    } = mission;
    await call(
      save(
        req('PUT', '/documents/document/the_mission', { ...fields, title: 'Edited', revision }),
        item('documents', 'document', 'the_mission')
      )
    );

    const revisions = await historyOf('documents', 'document', 'the_mission');
    expect(revisions.map((entry) => [entry.revision, entry.origin, entry.editorEmail])).toEqual([
      [2, 'admin', 'admin@example.com'],
      [1, 'seed', null],
    ]);
    const missing = await call(
      history(req('GET', '/documents/document/nope/history'), item('documents', 'document', 'nope'))
    );
    expect(missing.status).toBe(404);
  });
});

describe('journey', () => {
  it('saves the journey row, and refuses a stale lock', async () => {
    const journey = await view<JourneyAdminView>('journey');
    const meta = journey.structure!.collection;
    const body = {
      title: 'A new title',
      subtitle: meta.subtitle,
      version: meta.version,
      locale: meta.locale,
      updatedAt: journey.updatedAt,
    };
    const saved = await call(
      save(req('PUT', '/journey/journey/x', body), item('journey', 'journey', meta.id))
    );
    expect(saved.data?.changed).toEqual(['title']);
    expect((await view<JourneyAdminView>('journey')).structure!.collection.title).toBe(
      'A new title'
    );

    const stale = await call(
      save(req('PUT', '/journey/journey/x', body), item('journey', 'journey', meta.id))
    );
    expect(stale.status).toBe(409);
  });

  it('restores a module to its seeded words, as a new revision', async () => {
    const module0 = (await view<JourneyAdminView>('journey')).structure!.modules[1];
    const { id, number: _n, tier: _t, revision, ...fields } = module0;
    await call(
      save(
        req('PUT', `/journey/module/${id}`, { ...fields, title: 'Changed', revision }),
        item('journey', 'module', id)
      )
    );

    const restored = await call(
      restore(
        req('POST', `/journey/module/${id}/restore`, { revision: 1, revisionRead: 2 }),
        item('journey', 'module', id)
      )
    );
    expect(restored.data).toMatchObject({ changed: ['title'], revision: 3 });
    expect((await view<JourneyAdminView>('journey')).structure!.modules[1].title).toBe(
      module0.title
    );
    expect((await historyOf('journey', 'module', id)).map((entry) => entry.revision)).toEqual([
      3, 2, 1,
    ]);

    const noSuch = await call(
      restore(
        req('POST', `/journey/module/${id}/restore`, { revision: 9, revisionRead: 3 }),
        item('journey', 'module', id)
      )
    );
    expect(noSuch.status).toBe(404);
  });

  it('refuses a module whose phase groupings name a phase it does not have', async () => {
    const module0 = (await view<JourneyAdminView>('journey')).structure!.modules.find(
      (entry) => entry.phases.length > 0
    )!;
    const { id, number: _n, tier: _t, revision, ...fields } = module0;
    const body = {
      ...fields,
      phaseTiers: [{ id: 'orientation', label: 'O', order: 1, phases: [99] }],
      revision,
    };
    const response = await call(
      save(req('PUT', `/journey/module/${id}`, body), item('journey', 'module', id))
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(
      (await view<JourneyAdminView>('journey')).structure!.modules.find((entry) => entry.id === id)
        ?.revision
    ).toBe(revision);
  });
});

describe('questions', () => {
  it('saves and restores the set’s framing, and moves it to another module', async () => {
    const set = (await view<QuestionsAdminView>('questions')).set!;
    const body = {
      title: set.collection.title,
      chartTitle: set.collection.chartTitle,
      moduleId: 'module_01_values',
      phase: set.collection.phase,
      preamble: { ...set.preamble, text: 'A new preamble.' },
      pacing: set.pacing,
      version: set.collection.version,
      locale: set.collection.locale,
      revision: set.collection.revision,
    };
    const saved = await call(
      save(
        req('PUT', `/questions/set/${set.collection.id}`, body),
        item('questions', 'set', set.collection.id)
      )
    );
    expect(saved.data?.changed).toEqual(['preamble', 'moduleId']);

    const nowhere = await call(
      save(
        req('PUT', `/questions/set/${set.collection.id}`, {
          ...body,
          moduleId: 'module_99_none',
          revision: 2,
        }),
        item('questions', 'set', set.collection.id)
      )
    );
    expect(nowhere.status).toBe(400);

    const restored = await call(
      restore(
        req('POST', `/questions/set/${set.collection.id}/restore`, {
          revision: 1,
          revisionRead: 2,
        }),
        item('questions', 'set', set.collection.id)
      )
    );
    expect(restored.data?.changed).toEqual(['preamble']);
    const after = (await view<QuestionsAdminView>('questions')).set!;
    expect(after.preamble.text).toBe(set.preamble.text);
    expect(after.collection.module).toBe('module_01_values');
    expect(
      (await historyOf('questions', 'set', set.collection.id)).map((entry) => entry.revision)
    ).toEqual([3, 2, 1]);
  });

  it('adds a question at the end with the next id, reorders, and restores one’s words', async () => {
    const added = await call(
      create(
        req('POST', '/questions/question', {
          text: 'One more?',
          inputType: 'long_text',
          hint: 'Take your time.',
          conditionalFollowUp: { ifYes: 'Why?', ifNo: 'Why not?' },
        }),
        entity('questions', 'question')
      )
    );
    expect(added.status).toBe(201);
    expect(added.data).toMatchObject({ id: 'q31', number: 31 });

    const questions = (await view<QuestionsAdminView>('questions')).set!.questions;
    const order = questions.map((question) => ({ id: question.id, revision: question.revision }));
    const moved = await call(
      reorder(
        req('PUT', '/questions/order', { order: [order.at(-1)!, ...order.slice(0, -1)] }),
        collectionParams('questions')
      )
    );
    expect(moved.data?.moved).toBe(31);
    const reordered = (await view<QuestionsAdminView>('questions')).set!.questions;
    expect(reordered[0]).toMatchObject({ id: 'q31', number: 1, hint: 'Take your time.' });

    const q01 = reordered.find((question) => question.id === 'q01')!;
    await call(
      save(
        req('PUT', '/questions/question/q01', {
          text: 'Reworded?',
          inputType: 'long_text',
          hint: null,
          conditionalFollowUp: null,
          revision: q01.revision,
        }),
        item('questions', 'question', 'q01')
      )
    );
    const restored = await call(
      restore(
        req('POST', '/questions/question/q01/restore', {
          revision: 1,
          revisionRead: q01.revision + 1,
        }),
        item('questions', 'question', 'q01')
      )
    );
    expect(restored.data?.changed).toEqual(['text']);
    expect(
      (await view<QuestionsAdminView>('questions')).set!.questions.find(
        (question) => question.id === 'q01'
      )
    ).toMatchObject({ text: questions[0].text, number: 2 });
    expect((await historyOf('questions', 'question', 'q01'))[0].revision).toBe(4);

    const stale = await call(
      reorder(req('PUT', '/questions/order', { order }), collectionParams('questions'))
    );
    expect(stale.status).toBe(409);
  });
});

describe('resources', () => {
  const video = {
    kind: 'video',
    title: 'A video',
    subtitle: 'For the start.',
    relatesTo: 'module_01_values',
    duration: '6:12',
    href: 'https://example.com/f',
  };

  it('adds, edits, retires, restores and reorders videos, with every refusal named', async () => {
    expect(
      (
        await call(
          create(
            req('POST', '/resources/resource', { id: 'f-one', ...video }),
            entity('resources', 'resource')
          )
        )
      ).status
    ).toBe(201);
    expect(
      (
        await call(
          create(
            req('POST', '/resources/resource', { id: 'f-two', ...video, title: 'Two' }),
            entity('resources', 'resource')
          )
        )
      ).status
    ).toBe(201);
    const clash = await call(
      create(
        req('POST', '/resources/resource', { id: 'f-one', ...video }),
        entity('resources', 'resource')
      )
    );
    expect(clash.error?.details).toMatchObject({ reason: 'exists' });
    const badKey = await call(
      create(
        req('POST', '/resources/resource', {
          id: 'f-bad',
          ...video,
          relatesTo: 'module_99_nowhere',
        }),
        entity('resources', 'resource')
      )
    );
    expect(badKey.status).toBe(400);

    const asReading = await call(
      save(
        req('PUT', '/resources/resource/f-one', {
          kind: 'article',
          title: 'x',
          subtitle: 'y',
          relatesTo: null,
          readingTime: '5 min',
          href: 'https://example.com/r',
          revision: 1,
        }),
        item('resources', 'resource', 'f-one')
      )
    );
    expect(asReading.status).toBe(400);

    await call(
      save(
        req('PUT', '/resources/resource/f-one', { ...video, title: 'Retitled', revision: 1 }),
        item('resources', 'resource', 'f-one')
      )
    );
    const restoredWords = await call(
      restore(
        req('POST', '/resources/resource/f-one/restore', { revision: 1, revisionRead: 2 }),
        item('resources', 'resource', 'f-one')
      )
    );
    expect(restoredWords.data?.changed).toEqual(['title']);

    const moved = await call(
      reorder(
        req('PUT', '/resources/order', {
          kind: 'video',
          order: [
            { id: 'f-two', revision: 1 },
            { id: 'f-one', revision: 3 },
          ],
        }),
        collectionParams('resources')
      )
    );
    expect(moved.data?.moved).toBe(2);

    const retire = await call(
      remove(
        req('DELETE', '/resources/resource/f-two?revision=2'),
        item('resources', 'resource', 'f-two')
      )
    );
    expect(retire.data).toMatchObject({ retired: true });
    const reused = await call(
      create(
        req('POST', '/resources/resource', { id: 'f-two', ...video }),
        entity('resources', 'resource')
      )
    );
    expect(reused.error?.details).toMatchObject({ reason: 'retired' });

    const back = await call(
      retired(
        req('PUT', '/resources/resource/f-two/retired', { retired: false, revision: 3 }),
        item('resources', 'resource', 'f-two')
      )
    );
    expect(back.data).toMatchObject({
      retired: false,
      changed: expect.arrayContaining(['retired', 'position']),
    });
    const again = await call(
      retired(
        req('PUT', '/resources/resource/f-two/retired', { retired: false, revision: 4 }),
        item('resources', 'resource', 'f-two')
      )
    );
    expect(again.data?.changed).toEqual([]);
    expect(audit.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_content.resources.resource.unretire' })
    );

    const library = await view<ResourcesAdminView>('resources');
    expect(
      library.resources.filter((row) => !row.retired).map((row) => [row.id, row.position])
    ).toEqual([
      ['f-one', 0],
      ['f-two', 1],
    ]);
    expect(
      (await historyOf('resources', 'resource', 'f-two')).map((entry) => entry.revision)
    ).toEqual([4, 3, 2, 1]);
  });

  it('adds, edits, restores and removes a key’s words, but never the default’s', async () => {
    const words = {
      quote: 'Welcome, {{first_name}}.',
      paragraphs: ['Welcome to Lelañea.'],
      source: { collection: 'foundational_documents', id: 'the_initiation' },
    };
    const added = await call(
      create(
        req('POST', '/resources/words', { key: 'journey', ...words }),
        entity('resources', 'words')
      )
    );
    expect(added.status).toBe(201);
    const twice = await call(
      create(
        req('POST', '/resources/words', { key: 'journey', ...words }),
        entity('resources', 'words')
      )
    );
    expect(twice.status).toBe(409);
    const unknown = await call(
      create(
        req('POST', '/resources/words', { key: 'module_99_nope', ...words }),
        entity('resources', 'words')
      )
    );
    expect(unknown.status).toBe(400);

    await call(
      save(
        req('PUT', '/resources/words/journey', {
          ...words,
          paragraphs: ['Welcome to Lelañea.', 'Welcome, {{first_name}}.'],
          revision: 1,
        }),
        item('resources', 'words', 'journey')
      )
    );
    const restored = await call(
      restore(
        req('POST', '/resources/words/journey/restore', { revision: 1, revisionRead: 2 }),
        item('resources', 'words', 'journey')
      )
    );
    expect(restored.data?.changed).toEqual(['paragraphs']);
    expect(
      (await historyOf('resources', 'words', 'journey')).map((entry) => entry.revision)
    ).toEqual([3, 2, 1]);

    const gone = await call(
      remove(
        req('DELETE', '/resources/words/journey?revision=3'),
        item('resources', 'words', 'journey')
      )
    );
    expect(gone.status).toBe(200);
    expect((await view<ResourcesAdminView>('resources')).words.map((row) => row.key)).not.toContain(
      'journey'
    );

    const fallback = await call(
      remove(
        req('DELETE', '/resources/words/default?revision=1'),
        item('resources', 'words', 'default')
      )
    );
    expect(fallback.status).toBe(409);
    expect(fallback.error?.details).toMatchObject({ reason: 'has_readers' });
  });

  it('saves the library row and its sign-off, and refuses a stale one', async () => {
    const { collection } = await view<ResourcesAdminView>('resources');
    const body = {
      title: collection!.title,
      version: collection!.version,
      locale: collection!.locale,
      provenance: { ...collection!.provenance, status: 'signed_off' },
      updatedAt: collection!.updatedAt,
    };
    const saved = await call(
      save(
        req('PUT', '/resources/collection/x', body),
        item('resources', 'collection', collection!.id)
      )
    );
    expect(saved.data?.changed).toEqual(['provenance']);
    const stale = await call(
      save(
        req('PUT', '/resources/collection/x', body),
        item('resources', 'collection', collection!.id)
      )
    );
    expect(stale.status).toBe(409);
  });
});

describe('what an entity does not offer', () => {
  it.each([
    [
      'POST a document',
      () => create(req('POST', '/documents/document', {}), entity('documents', 'document')),
    ],
    [
      'retire a question',
      () =>
        retired(
          req('PUT', '/questions/question/q01/retired', { retired: true, revision: 1 }),
          item('questions', 'question', 'q01')
        ),
    ],
    [
      'reorder the journey',
      () => reorder(req('PUT', '/journey/order', { order: [] }), collectionParams('journey')),
    ],
    [
      'an unknown entity',
      () => save(req('PUT', '/journey/chapter/x', {}), item('journey', 'chapter', 'x')),
    ],
    [
      'an id no row could have',
      () => save(req('PUT', '/journey/tier/bad%20id', {}), item('journey', 'tier', 'bad id')),
    ],
  ])('404s %s', async (_what, run) => {
    expect((await call(run())).status).toBe(404);
  });
});

describe('a body that is not JSON', () => {
  function raw(method: string, path: string): NextRequest {
    const request = new Request(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    return Object.assign(request, { nextUrl: new URL(request.url) }) as unknown as NextRequest;
  }

  it.each([
    [
      'a save',
      () => save(raw('PUT', '/journey/tier/foundations'), item('journey', 'tier', 'foundations')),
    ],
    [
      'a restore',
      () =>
        restore(
          raw('POST', '/journey/tier/foundations/restore'),
          item('journey', 'tier', 'foundations')
        ),
    ],
    [
      'a retirement',
      () =>
        retired(raw('PUT', '/resources/resource/x/retired'), item('resources', 'resource', 'x')),
    ],
    ['a create', () => create(raw('POST', '/questions/question'), entity('questions', 'question'))],
    ['a reorder', () => reorder(raw('PUT', '/questions/order'), collectionParams('questions'))],
  ])('is a 400 for %s, in the standard envelope', async (_what, run) => {
    const response = await call(run());
    expect(response.status).toBe(400);
    expect(response.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('routes an entity does not fill', () => {
  it('404s the history and restore of a row with no history', async () => {
    const h = await call(
      history(req('GET', '/journey/journey/x/history'), item('journey', 'journey', 'x'))
    );
    const r = await call(
      restore(
        req('POST', '/documents/collection/x/restore', { revision: 1, revisionRead: 1 }),
        item('documents', 'collection', 'x')
      )
    );
    expect([h.status, r.status]).toEqual([404, 404]);
  });

  it('audits nothing for a reorder that moves nothing', async () => {
    const { documents } = await view<DocumentsAdminView>('documents');
    const order = documents.map((document) => ({ id: document.id, revision: document.revision }));
    const response = await call(
      reorder(req('PUT', '/documents/order', { order }), collectionParams('documents'))
    );
    expect(response.data).toEqual({ moved: 0 });
    expect(audit.logAdminAction).not.toHaveBeenCalled();
  });
});

describe('imports through the route', () => {
  it('a journey file that changes the journey, a tier and a module writes each as a revision, and audits them', async () => {
    const { POST: applyImport } =
      await import('@/app/api/v1/admin/app/content/[collection]/import/route');
    const { GET: exportFile } =
      await import('@/app/api/v1/admin/app/content/[collection]/export/route');
    const file = (await (
      await exportFile(req('GET', '/journey/export'), collectionParams('journey'))
    ).json()) as {
      app: { journeyTitle: string };
      tiers: { intent: string }[];
      modules: { title: string; subtitle?: string }[];
    };
    file.app.journeyTitle = 'Imported journey';
    file.tiers[0].intent = 'Imported intent.';
    file.modules[3].title = 'Imported title';
    delete file.modules[3].subtitle;

    const response = await call(
      applyImport(req('POST', '/journey/import', { file }), collectionParams('journey'))
    );

    expect(response.status).toBe(200);
    const structure = (await view<JourneyAdminView>('journey')).structure!;
    expect(structure.collection.title).toBe('Imported journey');
    expect(structure.tiers[0]).toMatchObject({ intent: 'Imported intent.', revision: 2 });
    expect(structure.modules[3]).toMatchObject({
      title: 'Imported title',
      subtitle: null,
      revision: 2,
    });
    expect(audit.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_content.journey.import' })
    );

    const again = await call(
      applyImport(req('POST', '/journey/import', { file }), collectionParams('journey'))
    );
    expect(again.data).toMatchObject({ plan: { writesNothing: true } });
  });

  it('a resources file that adds one video and drops another names both in the audit', async () => {
    const { POST: applyImport } =
      await import('@/app/api/v1/admin/app/content/[collection]/import/route');
    await call(
      create(
        req('POST', '/resources/resource', {
          id: 'leaving',
          kind: 'video',
          title: 'L',
          subtitle: 'l',
          relatesTo: null,
          duration: '1:00',
          href: 'https://example.com/l',
        }),
        entity('resources', 'resource')
      )
    );
    const { GET: exportFile } =
      await import('@/app/api/v1/admin/app/content/[collection]/export/route');
    const file = (await (
      await exportFile(req('GET', '/resources/export'), collectionParams('resources'))
    ).json()) as { videos: Record<string, unknown>[] };
    file.videos = [
      {
        id: 'arriving',
        title: 'A',
        subtitle: 'a',
        relatesTo: null,
        duration: '2:00',
        href: 'https://example.com/a',
      },
    ];
    audit.logAdminAction.mockClear();

    await call(
      applyImport(req('POST', '/resources/import', { file }), collectionParams('resources'))
    );

    expect(audit.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          sections: expect.arrayContaining([
            expect.objectContaining({
              entity: 'resource',
              created: ['arriving'],
              removed: ['leaving'],
              removalKind: 'retire',
            }),
          ]),
        },
      })
    );
  });
});

describe('the journey row', () => {
  it('a save that changes nothing writes nothing', async () => {
    const journey = await view<JourneyAdminView>('journey');
    const meta = journey.structure!.collection;
    const body = {
      title: meta.title,
      subtitle: meta.subtitle,
      version: meta.version,
      locale: meta.locale,
      updatedAt: journey.updatedAt,
    };
    const response = await call(
      save(req('PUT', '/journey/journey/x', body), item('journey', 'journey', meta.id))
    );
    expect(response.data?.changed).toEqual([]);
    expect(audit.logAdminAction).not.toHaveBeenCalled();
  });
});
