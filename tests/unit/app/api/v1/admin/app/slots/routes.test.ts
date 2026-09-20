/**
 * The slot-definition editor's routes (f-slots t-71): admin-only,
 * Zod-validated, and every write that changed something goes to the admin audit
 * log — the only place "who reworded this, and from what" is kept.
 *
 * The lock, the change rule, the history append and the upload planner are the
 * store's and are proved in `tests/unit/lib/app/slots/definitions-admin.test.ts`.
 * What is proved here is the wiring: the guard, what the schemas refuse, that
 * the slug is not writable, and that a no-op write writes no audit entry.
 *
 * @see app/api/v1/admin/app/slots/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const admin = vi.hoisted(() => ({
  getSlotTaxonomyAdminView: vi.fn(),
  listSlotDefinitionHistory: vi.fn(),
  createSlotDefinition: vi.fn(),
  updateSlotDefinition: vi.fn(),
  setSlotDefinitionActive: vi.fn(),
  previewTaxonomyUpload: vi.fn(),
  applyTaxonomyUpload: vi.fn(),
  // The real one — a pure predicate over the plan, and the thing the upload
  // route's "audit only if it wrote" decision turns on.
  planWritesNothing: (plan: { creates: unknown[]; updates: unknown[]; retirements: unknown[] }) =>
    plan.creates.length + plan.updates.length + plan.retirements.length === 0,
  logAdminAction: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/slots/definitions-admin', () => admin);
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({
  logAdminAction: admin.logAdminAction,
}));

import { ConflictError } from '@/lib/api/errors';
import { auth } from '@/lib/auth/config';
import { GET, POST as addDefinition } from '@/app/api/v1/admin/app/slots/route';
import { PUT as putDefinition } from '@/app/api/v1/admin/app/slots/[slug]/route';
import { PUT as putActive } from '@/app/api/v1/admin/app/slots/[slug]/active/route';
import { GET as getHistory } from '@/app/api/v1/admin/app/slots/[slug]/history/route';
import { POST as previewUpload } from '@/app/api/v1/admin/app/slots/upload/preview/route';
import { POST as applyUpload } from '@/app/api/v1/admin/app/slots/upload/route';

const BASE = 'https://lelanea.com/api/v1/admin/app/slots';

/** The authored half of a definition — what `PUT` sends, minus the version. */
const UPDATE_BODY = {
  group: 'life_areas',
  description: 'How their body stands right now, in their own words.',
  visibility: 'open',
  dataType: 'text',
  sensitivity: 'special_category',
  priorityWeight: 70,
};

const DEFINITION = {
  slug: 'life_physical_health',
  ...UPDATE_BODY,
  mode: 'targeted',
  isActive: true,
  version: 4,
};

const EMPTY_PLAN = {
  mode: 'merge',
  creates: [],
  updates: [],
  retirements: [],
  unchanged: [],
  skippedRetired: [],
  absentFromFile: [],
};

const SYNCED = { status: 'synced', provided: 1, created: 0, updated: 1, deactivated: 0 };

function req(method: string, path: string, body?: unknown): NextRequest {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function body(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  admin.getSlotTaxonomyAdminView.mockResolvedValue({
    definitions: [DEFINITION],
    groups: ['life_areas'],
    seeded: true,
  });
  admin.listSlotDefinitionHistory.mockResolvedValue([]);
  admin.createSlotDefinition.mockResolvedValue({ definition: DEFINITION, sync: SYNCED });
  admin.updateSlotDefinition.mockResolvedValue({
    definition: DEFINITION,
    changed: ['description'],
    changes: { description: { from: 'Before.', to: 'After.' } },
    sync: SYNCED,
  });
  admin.setSlotDefinitionActive.mockResolvedValue({
    definition: { ...DEFINITION, isActive: false },
    changed: ['isActive'],
    changes: { isActive: { from: true, to: false } },
    sync: SYNCED,
  });
  admin.previewTaxonomyUpload.mockResolvedValue(EMPTY_PLAN);
  admin.applyTaxonomyUpload.mockResolvedValue({ plan: EMPTY_PLAN, sync: SYNCED });
});

describe('the guard', () => {
  const calls: [string, () => Promise<Response>][] = [
    ['GET the taxonomy', () => GET(req('GET', ''))],
    ['POST a definition', () => addDefinition(req('POST', '', { slug: 'a_slot', ...UPDATE_BODY }))],
    [
      'PUT a definition',
      () =>
        putDefinition(req('PUT', '/a_slot', { ...UPDATE_BODY, version: 1 }), slugParams('a_slot')),
    ],
    [
      'PUT its retirement',
      () =>
        putActive(
          req('PUT', '/a_slot/active', { version: 1, isActive: false }),
          slugParams('a_slot')
        ),
    ],
    ['GET its history', () => getHistory(req('GET', '/a_slot/history'), slugParams('a_slot'))],
    [
      'POST an upload preview',
      () => previewUpload(req('POST', '/upload/preview', { mode: 'merge', file: {} })),
    ],
    ['POST an upload', () => applyUpload(req('POST', '/upload', { mode: 'merge', file: {} }))],
  ];

  it.each(calls)('refuses %s to a signed-out visitor', async (_label, call) => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());
    expect((await call()).status).toBe(401);
  });

  it.each(calls)('refuses %s to a signed-in non-admin', async (_label, call) => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
    expect((await call()).status).toBe(403);
  });

  it('reaches the store for none of them when refused', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
    for (const [, call] of calls) await call();

    for (const [name, fn] of Object.entries(admin)) {
      if (typeof fn === 'function' && 'mock' in fn) {
        expect(fn, `${name} was called`).not.toHaveBeenCalled();
      }
    }
  });
});

describe('GET the taxonomy', () => {
  it('returns the view as it stands', async () => {
    const response = await GET(req('GET', ''));

    expect(response.status).toBe(200);
    expect((await body(response)).data).toMatchObject({ seeded: true, groups: ['life_areas'] });
  });
});

describe('POST a definition', () => {
  it('creates it, answers 201, and audits the addition', async () => {
    const response = await addDefinition(req('POST', '', { slug: 'life_work', ...UPDATE_BODY }));

    expect(response.status).toBe(201);
    expect(admin.createSlotDefinition).toHaveBeenCalledWith(
      { slug: 'life_work', ...UPDATE_BODY },
      'cmjbv4i3x00003wsloputgwul'
    );
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_slot_definition.create',
        entityId: 'app_slot_definition:life_physical_health',
      })
    );
  });

  it.each([
    ['a slug that is not slug-shaped', { slug: 'Life Work', ...UPDATE_BODY }],
    ['no slug at all', { ...UPDATE_BODY }],
    [
      'a visibility outside the vocabulary',
      { slug: 'a_slot', ...UPDATE_BODY, visibility: 'maybe' },
    ],
    ['a priority weight past 100', { slug: 'a_slot', ...UPDATE_BODY, priorityWeight: 101 }],
    ['an empty description', { slug: 'a_slot', ...UPDATE_BODY, description: '   ' }],
    [
      'a mode, which is never an admin’s to choose',
      { slug: 'a_slot', ...UPDATE_BODY, mode: 'open' },
    ],
    [
      'an isActive, which belongs to the retire route',
      { slug: 'a_slot', ...UPDATE_BODY, isActive: false },
    ],
  ])('refuses 400 for %s, writing nothing', async (_label, payload) => {
    const response = await addDefinition(req('POST', '', payload));

    expect(response.status).toBe(400);
    expect(admin.createSlotDefinition).not.toHaveBeenCalled();
    expect(admin.logAdminAction).not.toHaveBeenCalled();
  });
});

describe('PUT a definition', () => {
  it('saves the wording at the version that was read, and audits from and to', async () => {
    const response = await putDefinition(
      req('PUT', '/life_physical_health', { ...UPDATE_BODY, version: 3 }),
      slugParams('life_physical_health')
    );

    expect(response.status).toBe(200);
    expect(admin.updateSlotDefinition).toHaveBeenCalledWith(
      'life_physical_health',
      UPDATE_BODY,
      3,
      'cmjbv4i3x00003wsloputgwul'
    );
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_slot_definition.update',
        changes: { description: { from: 'Before.', to: 'After.' } },
      })
    );
  });

  it('refuses a body carrying a slug rather than ignoring it', async () => {
    // An admin who thought they were renaming a slot has to be told they were
    // not — a rename is an add plus a retire, and silently dropping the field
    // would let them believe the old answers had followed.
    const response = await putDefinition(
      req('PUT', '/life_physical_health', { ...UPDATE_BODY, version: 3, slug: 'renamed' }),
      slugParams('life_physical_health')
    );

    expect(response.status).toBe(400);
    expect(admin.updateSlotDefinition).not.toHaveBeenCalled();
  });

  it('refuses 400 a version that is not a positive whole number', async () => {
    const response = await putDefinition(
      req('PUT', '/life_physical_health', { ...UPDATE_BODY, version: 0 }),
      slugParams('life_physical_health')
    );

    expect(response.status).toBe(400);
    expect(admin.updateSlotDefinition).not.toHaveBeenCalled();
  });

  it('refuses 400 a slug in the path that is not slug-shaped', async () => {
    const response = await putDefinition(
      req('PUT', '/Not A Slug', { ...UPDATE_BODY, version: 1 }),
      slugParams('Not A Slug')
    );

    expect(response.status).toBe(400);
    expect((await body(response)).error?.details).toMatchObject({ slug: expect.any(Array) });
    expect(admin.updateSlotDefinition).not.toHaveBeenCalled();
  });

  it('shows the store’s 409 to the page, message and reason intact', async () => {
    // The real error class, not a look-alike: what carries it to a 409 is
    // `handleAPIError` recognising an `APIError`, and a duck-typed object would
    // prove the assertion while a real store throw still 500'd.
    admin.updateSlotDefinition.mockRejectedValueOnce(
      new ConflictError('"life_physical_health" was changed by someone else since you opened it.', {
        reason: 'version_moved',
        currentVersion: 5,
      })
    );

    const response = await putDefinition(
      req('PUT', '/life_physical_health', { ...UPDATE_BODY, version: 3 }),
      slugParams('life_physical_health')
    );

    expect(response.status).toBe(409);
    const payload = await body(response);
    expect(payload.error?.message).toMatch(/changed by someone else/);
    expect(payload.error?.details).toMatchObject({ reason: 'version_moved', currentVersion: 5 });
    expect(admin.logAdminAction).not.toHaveBeenCalled();
  });

  it('writes no audit entry when the save changed nothing', async () => {
    // No revision, no version bump — an entry would report an edit the history
    // has no record of.
    admin.updateSlotDefinition.mockResolvedValueOnce({
      definition: DEFINITION,
      changed: [],
      changes: {},
      sync: { status: 'not_needed' },
    });

    const response = await putDefinition(
      req('PUT', '/life_physical_health', { ...UPDATE_BODY, version: 4 }),
      slugParams('life_physical_health')
    );

    expect(response.status).toBe(200);
    expect(admin.logAdminAction).not.toHaveBeenCalled();
  });
});

describe('PUT a retirement', () => {
  it('retires, and audits it under its own action', async () => {
    const response = await putActive(
      req('PUT', '/life_physical_health/active', { version: 4, isActive: false }),
      slugParams('life_physical_health')
    );

    expect(response.status).toBe(200);
    expect(admin.setSlotDefinitionActive).toHaveBeenCalledWith(
      'life_physical_health',
      false,
      4,
      'cmjbv4i3x00003wsloputgwul'
    );
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_slot_definition.retire' })
    );
  });

  it('restores under a different action, so the log tells the two apart', async () => {
    admin.setSlotDefinitionActive.mockResolvedValueOnce({
      definition: DEFINITION,
      changed: ['isActive'],
      changes: { isActive: { from: false, to: true } },
      sync: SYNCED,
    });

    await putActive(
      req('PUT', '/life_physical_health/active', { version: 4, isActive: true }),
      slugParams('life_physical_health')
    );

    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_slot_definition.restore' })
    );
  });

  it('writes no audit entry when it was already in that state', async () => {
    admin.setSlotDefinitionActive.mockResolvedValueOnce({
      definition: DEFINITION,
      changed: [],
      changes: {},
      sync: { status: 'not_needed' },
    });

    await putActive(
      req('PUT', '/life_physical_health/active', { version: 4, isActive: true }),
      slugParams('life_physical_health')
    );

    expect(admin.logAdminAction).not.toHaveBeenCalled();
  });

  it.each([
    ['no isActive', { version: 1 }],
    ['an isActive that is not a boolean', { version: 1, isActive: 'no' }],
    [
      'the authored fields, which this route does not take',
      { version: 1, isActive: false, ...UPDATE_BODY },
    ],
  ])('refuses 400 for %s', async (_label, payload) => {
    const response = await putActive(
      req('PUT', '/life_physical_health/active', payload),
      slugParams('life_physical_health')
    );

    expect(response.status).toBe(400);
    expect(admin.setSlotDefinitionActive).not.toHaveBeenCalled();
  });
});

describe('GET a definition’s history', () => {
  it('returns the revisions under the slug that was asked for', async () => {
    admin.listSlotDefinitionHistory.mockResolvedValueOnce([{ version: 2 }, { version: 1 }]);

    const response = await getHistory(
      req('GET', '/life_physical_health/history'),
      slugParams('life_physical_health')
    );

    expect(response.status).toBe(200);
    expect(admin.listSlotDefinitionHistory).toHaveBeenCalledWith('life_physical_health');
    expect((await body(response)).data).toMatchObject({ slug: 'life_physical_health' });
  });
});

describe('uploading', () => {
  it('previews without writing', async () => {
    const file = { taxonomy: {}, groups: [], slots: [] };
    const response = await previewUpload(req('POST', '/upload/preview', { mode: 'merge', file }));

    expect(response.status).toBe(200);
    expect(admin.previewTaxonomyUpload).toHaveBeenCalledWith(file, 'merge');
    expect(admin.applyTaxonomyUpload).not.toHaveBeenCalled();
    // A preview is not a change, so it is not in the audit log either.
    expect(admin.logAdminAction).not.toHaveBeenCalled();
  });

  it('applies, and returns the plan that ran rather than the one previewed', async () => {
    const plan = { ...EMPTY_PLAN, creates: [{ slug: 'life_new' }], mode: 'replace' };
    admin.applyTaxonomyUpload.mockResolvedValueOnce({ plan, sync: SYNCED });

    const response = await applyUpload(
      req('POST', '/upload', { mode: 'replace', file: { slots: [] } })
    );

    expect(response.status).toBe(200);
    expect((await body(response)).data).toMatchObject({ plan });
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_slot_definition.upload',
        metadata: expect.objectContaining({ mode: 'replace', created: ['life_new'] }),
      })
    );
  });

  it('names every retirement in the audit entry rather than counting them', async () => {
    admin.applyTaxonomyUpload.mockResolvedValueOnce({
      plan: { ...EMPTY_PLAN, retirements: [{ slug: 'life_money' }], mode: 'replace' },
      sync: SYNCED,
    });

    await applyUpload(req('POST', '/upload', { mode: 'replace', file: { slots: [] } }));

    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ retired: ['life_money'] }),
      })
    );
  });

  it('writes no audit entry when a re-applied file wrote nothing', async () => {
    await applyUpload(req('POST', '/upload', { mode: 'merge', file: { slots: [] } }));

    expect(admin.applyTaxonomyUpload).toHaveBeenCalled();
    expect(admin.logAdminAction).not.toHaveBeenCalled();
  });

  it.each([
    ['a mode that is neither merge nor replace', { mode: 'wipe', file: {} }],
    ['no mode at all', { file: {} }],
    ['an extra key', { mode: 'merge', file: {}, force: true }],
  ])('refuses 400 for %s on both routes', async (_label, payload) => {
    expect((await previewUpload(req('POST', '/upload/preview', payload))).status).toBe(400);
    expect((await applyUpload(req('POST', '/upload', payload))).status).toBe(400);
    expect(admin.previewTaxonomyUpload).not.toHaveBeenCalled();
    expect(admin.applyTaxonomyUpload).not.toHaveBeenCalled();
  });
});
