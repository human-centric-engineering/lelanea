/**
 * The content admin routes (f-content-seeds t-91): the admin guard, the
 * standard error envelope for every refusal, the size cap on an import, the
 * audit on every write that changed something and on nothing else.
 *
 * The services under the routes are real and run against the in-memory
 * database (`content-db-fake.ts`); only the session and the audit logger are
 * stubbed, so a route that dispatched to the wrong service, or audited a
 * preview, fails here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';
import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

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
import { GET as exportCollection } from '@/app/api/v1/admin/app/content/[collection]/export/route';
import { POST as previewImport } from '@/app/api/v1/admin/app/content/[collection]/import/preview/route';
import { POST as applyImport } from '@/app/api/v1/admin/app/content/[collection]/import/route';
import {
  PUT as saveItem,
  DELETE as removeItem,
} from '@/app/api/v1/admin/app/content/[collection]/[entity]/[id]/route';
import { GET as getHistory } from '@/app/api/v1/admin/app/content/[collection]/[entity]/[id]/history/route';
import { POST as restoreItem } from '@/app/api/v1/admin/app/content/[collection]/[entity]/[id]/restore/route';
import { seedFoundationalDocuments } from '@/lib/app/content/document-store';
import { seedJourneyStructure } from '@/lib/app/content/journey-store';
import { seedDiscoveryQuestions } from '@/lib/app/content/question-store';
import { seedResources } from '@/lib/app/content/resource-store';
import { buildFoundationalSeed } from '@/lib/app/content/seed-input/foundational-seed';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import { MAX_IMPORT_BYTES } from '@/lib/app/content/admin/shared';

const BASE = 'https://lelanea.com/api/v1/admin/app/content';

function req(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  const request = new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return Object.assign(request, { nextUrl: new URL(request.url) }) as unknown as NextRequest;
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

async function envelope(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
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
});

describe('the guard', () => {
  it.each([
    ['nobody', mockUnauthenticatedUser(), 401],
    ['a member', mockAuthenticatedUser('USER'), 403],
  ])('refuses %s', async (_who, session, status) => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session);
    const responses = await Promise.all([
      getCollection(req('GET', '/documents'), params({ collection: 'documents' })),
      exportCollection(req('GET', '/documents/export'), params({ collection: 'documents' })),
      applyImport(
        req('POST', '/documents/import', { file: {} }),
        params({ collection: 'documents' })
      ),
      saveItem(
        req('PUT', '/documents/document/the_mission', {}),
        params({ collection: 'documents', entity: 'document', id: 'the_mission' })
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([status, status, status, status]);
  });
});

describe('reads', () => {
  it('serves each collection, and 404s one that does not exist', async () => {
    for (const collection of ['documents', 'journey', 'questions', 'resources']) {
      const response = await getCollection(req('GET', `/${collection}`), params({ collection }));
      expect(response.status).toBe(200);
      expect((await envelope(response)).data).toMatchObject({ seeded: true });
    }
    const missing = await getCollection(req('GET', '/values'), params({ collection: 'values' }));
    expect(missing.status).toBe(404);
    expect((await envelope(missing)).success).toBe(false);
  });

  it('exports an attachment in the seed file shape, uncached', async () => {
    const response = await exportCollection(
      req('GET', '/questions/export'),
      params({ collection: 'questions' })
    );
    expect(response.headers.get('Content-Disposition')).toMatch(
      /attachment; filename="lelanea-discovery-questions-\d{4}-\d{2}-\d{2}\.json"/
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const file = (await response.json()) as {
      questions: unknown[];
      content: { questionCount: number };
    };
    expect(file.questions).toHaveLength(30);
    expect(file.content.questionCount).toBe(30);
  });
});

describe('import', () => {
  async function exported(collection: string) {
    return (
      await exportCollection(req('GET', `/${collection}/export`), params({ collection }))
    ).json() as Promise<unknown>;
  }

  it('previews without writing or auditing', async () => {
    const before = db.current!.fingerprint();
    const response = await previewImport(
      req('POST', '/journey/import/preview', { file: await exported('journey') }),
      params({ collection: 'journey' })
    );
    expect(response.status).toBe(200);
    expect((await envelope(response)).data).toMatchObject({
      plan: { writesNothing: true, refusals: [] },
    });
    expect(db.current!.fingerprint()).toBe(before);
    expect(audit.logAdminAction).not.toHaveBeenCalled();
  });

  it('audits an apply that wrote, and not one that wrote nothing', async () => {
    const file = (await exported('questions')) as { questions: { id: string; text: string }[] };
    await applyImport(
      req('POST', '/questions/import', { file }),
      params({ collection: 'questions' })
    );
    expect(audit.logAdminAction).not.toHaveBeenCalled();

    file.questions[0].text = 'Imported wording?';
    const response = await applyImport(
      req('POST', '/questions/import', { file }),
      params({ collection: 'questions' })
    );
    expect(response.status).toBe(200);
    expect(audit.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_content.questions.import',
        userId: mockAdminUser().user.id,
        metadata: { sections: [expect.objectContaining({ entity: 'question', updated: ['q01'] })] },
      })
    );
  });

  it('refuses an oversize file with 413 FILE_TOO_LARGE before reading it', async () => {
    const response = await previewImport(
      req('POST', '/documents/import/preview', '{}', {
        'content-length': String(MAX_IMPORT_BYTES + 1),
      }),
      params({ collection: 'documents' })
    );
    expect(response.status).toBe(413);
    expect((await envelope(response)).error).toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('refuses an oversize body whose header lied', async () => {
    const huge = JSON.stringify({ file: { padding: 'x'.repeat(MAX_IMPORT_BYTES) } });
    const response = await applyImport(
      req('POST', '/documents/import', huge),
      params({ collection: 'documents' })
    );
    expect(response.status).toBe(413);
  });

  it('refuses bad JSON and a file of the wrong shape with the standard envelope', async () => {
    const badJson = await previewImport(
      req('POST', '/documents/import/preview', '{not json'),
      params({ collection: 'documents' })
    );
    expect(badJson.status).toBe(400);
    expect((await envelope(badJson)).error).toMatchObject({ code: 'VALIDATION_ERROR' });

    const wrongShape = await applyImport(
      req('POST', '/documents/import', { file: { documents: [] } }),
      params({ collection: 'documents' })
    );
    expect(wrongShape.status).toBe(400);
    const body = await envelope(wrongShape);
    expect(body.success).toBe(false);
    expect(body.error?.details?.errors).toEqual(expect.any(Array));
    expect(audit.logAdminAction).not.toHaveBeenCalled();
  });
});

describe('items', () => {
  it('saves, audits the change field by field, and serves the history with the editor', async () => {
    const view = (
      await envelope(await getCollection(req('GET', '/journey'), params({ collection: 'journey' })))
    ).data as {
      structure: { tiers: { id: string; label: string; revision: number }[] };
    };
    const tier = view.structure.tiers[0];
    const response = await saveItem(
      req('PUT', `/journey/tier/${tier.id}`, {
        revision: tier.revision,
        label: tier.label,
        intent: 'A new intent.',
      }),
      params({ collection: 'journey', entity: 'tier', id: tier.id })
    );
    expect((await envelope(response)).data).toMatchObject({ changed: ['intent'], revision: 2 });
    expect(audit.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_content.journey.tier.update',
        changes: { intent: expect.objectContaining({ to: 'A new intent.' }) },
      })
    );

    const history = await envelope(
      await getHistory(
        req('GET', `/journey/tier/${tier.id}/history`),
        params({ collection: 'journey', entity: 'tier', id: tier.id })
      )
    );
    expect(
      (history.data?.revisions as { revision: number; origin: string }[]).map((entry) => [
        entry.revision,
        entry.origin,
      ])
    ).toEqual([
      [2, 'admin'],
      [1, 'seed'],
    ]);

    const restored = await restoreItem(
      req('POST', `/journey/tier/${tier.id}/restore`, { revision: 1, revisionRead: 2 }),
      params({ collection: 'journey', entity: 'tier', id: tier.id })
    );
    expect((await envelope(restored)).data).toMatchObject({ changed: ['intent'], revision: 3 });
  });

  it('refuses a body that tries to write an id', async () => {
    const response = await saveItem(
      req('PUT', '/questions/question/q01', {
        revision: 1,
        id: 'q99',
        text: 'x',
        inputType: 'long_text',
        hint: null,
        conditionalFollowUp: null,
      }),
      params({ collection: 'questions', entity: 'question', id: 'q01' })
    );
    expect(response.status).toBe(400);
  });

  it('refuses to delete a document a surface renders, naming the readers, and audits nothing', async () => {
    const response = await removeItem(
      req('DELETE', '/documents/document/terms_of_use?revision=1'),
      params({ collection: 'documents', entity: 'document', id: 'terms_of_use' })
    );
    expect(response.status).toBe(409);
    const body = await envelope(response);
    expect(body.error?.details).toMatchObject({
      reason: 'has_readers',
      readers: expect.arrayContaining(['the acknowledgement gate (/app/begin)']),
    });
    expect(audit.logAdminAction).not.toHaveBeenCalled();
    expect(db.current!.rows('appFoundationalDocument')).toHaveLength(7);
  });

  it('refuses a document delete that does not say which revision it read', async () => {
    const response = await removeItem(
      req('DELETE', '/documents/document/terms_of_use'),
      params({ collection: 'documents', entity: 'document', id: 'terms_of_use' })
    );
    expect(response.status).toBe(400);
    expect(audit.logAdminAction).not.toHaveBeenCalled();
    expect(db.current!.rows('appFoundationalDocument')).toHaveLength(7);
  });

  it('removes a question with the revision read, and refuses one without it', async () => {
    const without = await removeItem(
      req('DELETE', '/questions/question/q30'),
      params({ collection: 'questions', entity: 'question', id: 'q30' })
    );
    expect(without.status).toBe(400);

    const response = await removeItem(
      req('DELETE', '/questions/question/q30?revision=1'),
      params({ collection: 'questions', entity: 'question', id: 'q30' })
    );
    expect(response.status).toBe(200);
    expect(db.current!.rows('appDiscoveryQuestion')).toHaveLength(29);
    expect(audit.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_content.questions.question.remove' })
    );
  });

  it('404s a module delete: the roster owns structure', async () => {
    const response = await removeItem(
      req('DELETE', '/journey/module/module_01_values?revision=1'),
      params({ collection: 'journey', entity: 'module', id: 'module_01_values' })
    );
    expect(response.status).toBe(404);
  });
});
