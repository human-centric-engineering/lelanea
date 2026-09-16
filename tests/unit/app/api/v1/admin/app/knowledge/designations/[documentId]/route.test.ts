/**
 * GET / PATCH /api/v1/admin/app/knowledge/designations/:documentId
 *
 * The write that decides whether an agent may quote a document. So: the guard
 * (401, 403), the id validation, the 404 — and the two properties nobody would
 * notice from the screen.
 *
 * **It is audited.** Re-designating `voice` → `knowledge` widens what an agent
 * can retrieve and quote, which is the same class of act as granting a tag, and
 * `logAdminAction` is where every other such change in this install is recorded.
 * A route that wrote without auditing would look identical to an operator.
 *
 * **The licensing NOTE never leaves the row.** It is free text an admin typed
 * and may name a third party. The log line carries `licensed: boolean` and the
 * audit metadata carries `licensingChanged: boolean` — the operational fact is
 * that it changed, not what it says. Asserted here by searching the whole
 * serialised payload for the text, because an assertion listing the keys that
 * SHOULD be there would still pass if the note arrived under a new one.
 *
 * `/pre-pr`'s `check:missing-tests` named this route as an outright gap on t-25.
 *
 * @see app/api/v1/admin/app/knowledge/designations/[documentId]/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const { getDesignation, setDesignation, logAdminAction, routeLog } = vi.hoisted(() => ({
  getDesignation: vi.fn(),
  setDesignation: vi.fn(),
  logAdminAction: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/voice/designation-admin', () => ({ getDesignation, setDesignation }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));

import { auth } from '@/lib/auth/config';
import { GET, PATCH } from '@/app/api/v1/admin/app/knowledge/designations/[documentId]/route';

/** A real cuid shape — `cuidSchema` rejects anything else. */
const DOC_ID = 'cmtso8tdu000p0bgmhn1v7lao';

/** The text that must never appear in a log line or an audit entry. */
const NOTE = 'Permission from Jane Roe, email of 3 Sept, personal use only.';

function patchRequest(body: unknown, id = DOC_ID) {
  const req = new Request(`https://lelanea.com/api/v1/admin/app/knowledge/designations/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return [req, { params: Promise.resolve({ documentId: id }) }] as const;
}

function getRequest(id = DOC_ID) {
  const req = new Request(
    `https://lelanea.com/api/v1/admin/app/knowledge/designations/${id}`
  ) as unknown as NextRequest;
  return [req, { params: Promise.resolve({ documentId: id }) }] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  getDesignation.mockResolvedValue({
    purpose: 'knowledge',
    sensitivity: 'public',
    licensing: null,
  });
  setDesignation.mockResolvedValue({
    purpose: 'voice',
    sensitivity: 'public',
    licensing: NOTE,
  });
});

describe('the guard', () => {
  it('answers 401 to nobody, and reads nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await GET(...getRequest());

    expect(response.status).toBe(401);
    expect(getDesignation).not.toHaveBeenCalled();
  });

  it('answers 403 to a signed-in non-admin, and writes nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

    const response = await PATCH(...patchRequest({ purpose: 'voice' }));

    // An ordinary user deciding what the agent may quote is the whole risk.
    expect(response.status).toBe(403);
    expect(setDesignation).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('returns the designation with the consequence computed server-side', async () => {
    const response = await GET(...getRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { designation: { purpose: string; quotable: boolean } };
    };
    // `quotable` is the server's to compute — a client deriving it would be a
    // second implementation of the rule the agent actually obeys.
    expect(body.data.designation).toMatchObject({ purpose: 'knowledge', quotable: true });
  });

  it('answers 404 for a document that is not there', async () => {
    getDesignation.mockResolvedValue(null);

    const response = await GET(...getRequest());

    expect(response.status).toBe(404);
  });

  it('refuses an id that is not a cuid before touching the service', async () => {
    const response = await GET(...getRequest('../../etc/passwd'));

    expect(response.status).toBe(400);
    expect(getDesignation).not.toHaveBeenCalled();
  });
});

describe('PATCH', () => {
  it('passes the validated body through and answers with the new designation', async () => {
    const response = await PATCH(...patchRequest({ purpose: 'voice' }));

    expect(response.status).toBe(200);
    expect(setDesignation).toHaveBeenCalledWith(
      DOC_ID,
      { purpose: 'voice' },
      'cmjbv4i3x00003wsloputgwul'
    );

    const body = (await response.json()) as { data: { designation: { quotable: boolean } } };
    // `voice` is off the tool path, so the answer the operator sees flips too.
    expect(body.data.designation.quotable).toBe(false);
  });

  it('rejects a body that says nothing, without writing', async () => {
    const response = await PATCH(...patchRequest({}));

    expect(response.status).toBe(400);
    expect(setDesignation).not.toHaveBeenCalled();
  });

  it('records the change in the admin audit log', async () => {
    await PATCH(...patchRequest({ purpose: 'voice' }));

    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect(logAdminAction.mock.calls[0]?.[0]).toMatchObject({
      action: 'app_knowledge_designation.update',
      entityType: 'knowledge_document',
      entityId: DOC_ID,
      userId: 'cmjbv4i3x00003wsloputgwul',
    });
  });

  it('never puts the licensing note in the audit entry or the log line', async () => {
    await PATCH(...patchRequest({ purpose: 'voice', licensing: NOTE }));

    // Searched for in the whole serialised payload, not asserted key by key: a
    // key-list assertion still passes when the note arrives under a new name.
    const audited = JSON.stringify(logAdminAction.mock.calls[0]?.[0]);
    expect(audited).not.toContain(NOTE);
    expect(audited).not.toContain('Jane Roe');
    // What IS recorded: that it changed.
    expect(logAdminAction.mock.calls[0]?.[0]).toMatchObject({
      metadata: expect.objectContaining({ licensingChanged: true }),
    });

    const logged = JSON.stringify(routeLog.info.mock.calls);
    expect(logged).not.toContain(NOTE);
    expect(logged).not.toContain('Jane Roe');
    // The log line says a note exists, which is the operational fact.
    expect(routeLog.info).toHaveBeenCalledWith(
      'Designation set',
      expect.objectContaining({ licensed: true, quotable: false })
    );
  });

  it('reports licensingChanged false when the write did not mention it', async () => {
    // `undefined` means "leave it alone", and the audit entry must not claim a
    // note changed because the row happens to carry one.
    await PATCH(...patchRequest({ purpose: 'voice' }));

    expect(logAdminAction.mock.calls[0]?.[0]).toMatchObject({
      metadata: expect.objectContaining({ licensingChanged: false }),
    });
  });
});
