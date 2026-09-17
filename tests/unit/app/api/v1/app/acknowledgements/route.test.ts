/**
 * GET + POST /api/v1/app/acknowledgements — the gate's API.
 *
 * The ledger module is REAL down to the Prisma stub, so the status a POST
 * answers with is computed from what the stub holds, not from a mock of the
 * module — a route that recorded one kind and then reported it outstanding
 * would fail here. The content loader is real too: the versions asserted are
 * read from the authored collection.
 *
 * FORK NOTE — `lib/app/content` is read for real so the versions in the
 * response are the ones the gate would actually require; a fork with its own
 * collection sees its own version here and nothing else changes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));

const { create, findUnique, findMany } = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({
  prisma: { appAcknowledgement: { create, findUnique, findMany } },
}));

import { GET, POST } from '@/app/api/v1/app/acknowledgements/route';
import { auth } from '@/lib/auth/config';
import { API_KEY_SESSION_ID_PREFIX } from '@/lib/auth/api-keys';
import { AGE_18_VERSION } from '@/lib/app/gateway/acknowledgements';
import { getFoundationalCollectionMeta } from '@/lib/app/content';

const COLLECTION_VERSION = getFoundationalCollectionMeta().version;
const AT = new Date('2026-09-14T10:00:00.000Z');

interface StatusBody {
  success: boolean;
  data: {
    complete: boolean;
    outstanding: string[];
    kinds: { kind: string; requiredVersion: string; satisfied: boolean }[];
  };
  error?: { code: string; message: string };
}

function createRequest(body?: unknown, method = 'GET'): NextRequest {
  return {
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    url: 'http://localhost:3000/api/v1/app/acknowledgements',
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  } as unknown as NextRequest;
}

function createSession(sessionId = 'session_test') {
  const now = new Date();
  return {
    session: {
      id: sessionId,
      userId: 'user_test',
      token: 'token',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: 'user_test',
      name: 'Test Member',
      email: 'member@example.com',
      emailVerified: true,
      image: null,
      role: 'USER' as const,
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** A minimal in-memory ledger so a POST changes what the next read reports. */
function stubLedger(initial: { kind: string; documentVersion: string }[] = []) {
  const rows = initial.map((r) => ({ ...r, acknowledgedAt: AT }));
  findMany.mockImplementation(() => Promise.resolve(rows));
  create.mockImplementation(({ data }: { data: { kind: string; documentVersion: string } }) => {
    if (rows.some((r) => r.kind === data.kind && r.documentVersion === data.documentVersion)) {
      // The shape Prisma's unique violation has, as far as the module reads it.
      return Promise.reject(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      );
    }
    const row = { id: `ack-${rows.length + 1}`, ...data, acknowledgedAt: AT };
    rows.push(row);
    return Promise.resolve(row);
  });
  findUnique.mockImplementation(
    ({
      where,
    }: {
      where: { userId_kind_documentVersion: { kind: string; documentVersion: string } };
    }) => {
      const key = where.userId_kind_documentVersion;
      const hit = rows.find(
        (r) => r.kind === key.kind && r.documentVersion === key.documentVersion
      );
      return Promise.resolve(hit ? { id: 'ack-existing', ...hit } : null);
    }
  );
  return rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(createSession());
  stubLedger();
});

describe('ownership (Sunrise 0.12.0 authorization seam)', () => {
  // `withAuth` now asks every route how it decides WHOSE rows it reads, and a
  // route that declared nothing answers 500 (`OwnershipDecisionMissingError`)
  // for any caller the default policy narrows — which is every non-admin. The
  // session above is a plain USER, so these two cases are exactly the caller
  // that would have been refused. Both verbs are declared `'self'`.
  it("GET answers a non-admin member 200, not 'made no ownership decision'", async () => {
    const response = await GET(createRequest());
    const body = (await response.json()) as StatusBody;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeUndefined();
  });

  it("POST answers a non-admin member 201, not 'made no ownership decision'", async () => {
    const response = await POST(createRequest({ kind: 'disclaimer' }, 'POST'));
    const body = (await response.json()) as StatusBody;

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.error).toBeUndefined();
  });
});

describe('GET /api/v1/app/acknowledgements', () => {
  it('is behind auth: 401 with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });

  it('refuses an API-key session with 403 — acknowledging is an identity act', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(
      createSession(`${API_KEY_SESSION_ID_PREFIX}abc`)
    );

    const response = await GET(createRequest());
    const body = (await response.json()) as StatusBody;

    expect(response.status).toBe(403);
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('reports every kind outstanding for a fresh account, against the current versions', async () => {
    const response = await GET(createRequest());
    const body = (await response.json()) as StatusBody;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.complete).toBe(false);
    expect(body.data.outstanding).toEqual(['disclaimer', 'terms', 'age_18']);
    expect(body.data.kinds.map((k) => k.requiredVersion)).toEqual([
      COLLECTION_VERSION,
      COLLECTION_VERSION,
      AGE_18_VERSION,
    ]);
    // Reads the CALLER's rows, not anyone else's.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_test' } })
    );
  });

  it('reports complete once every kind is satisfied', async () => {
    stubLedger([
      { kind: 'disclaimer', documentVersion: COLLECTION_VERSION },
      { kind: 'terms', documentVersion: COLLECTION_VERSION },
      { kind: 'age_18', documentVersion: AGE_18_VERSION },
    ]);

    const body = (await (await GET(createRequest())).json()) as StatusBody;

    expect(body.data.complete).toBe(true);
    expect(body.data.outstanding).toEqual([]);
  });
});

describe('POST /api/v1/app/acknowledgements', () => {
  it('is behind auth: 401 with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const response = await POST(createRequest({ kind: 'terms' }, 'POST'));
    expect(response.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an API-key session with 403 before reading the body', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(
      createSession(`${API_KEY_SESSION_ID_PREFIX}abc`)
    );

    const response = await POST(createRequest({ kind: 'terms' }, 'POST'));

    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('records one kind for the caller and answers 201 with the status AFTER the write', async () => {
    const response = await POST(createRequest({ kind: 'disclaimer' }, 'POST'));
    const body = (await response.json()) as StatusBody;

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user_test', kind: 'disclaimer', documentVersion: COLLECTION_VERSION },
      })
    );
    // Status before: all three outstanding. After: two.
    expect(body.data.outstanding).toEqual(['terms', 'age_18']);
    expect(body.data.kinds.find((k) => k.kind === 'disclaimer')?.satisfied).toBe(true);
    expect(body.data.complete).toBe(false);
  });

  it('completes the gate on the last kind', async () => {
    stubLedger([
      { kind: 'disclaimer', documentVersion: COLLECTION_VERSION },
      { kind: 'terms', documentVersion: COLLECTION_VERSION },
    ]);

    const body = (await (
      await POST(createRequest({ kind: 'age_18' }, 'POST'))
    ).json()) as StatusBody;

    expect(body.data.complete).toBe(true);
    expect(body.data.outstanding).toEqual([]);
  });

  it('is idempotent: a repeat answers 200 with the same status and writes nothing new', async () => {
    const rows = stubLedger([{ kind: 'terms', documentVersion: COLLECTION_VERSION }]);

    const response = await POST(createRequest({ kind: 'terms' }, 'POST'));
    const body = (await response.json()) as StatusBody;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(rows).toHaveLength(1);
    expect(body.data.kinds.find((k) => k.kind === 'terms')?.satisfied).toBe(true);
  });

  it('refuses a version the caller tries to name — strict body, 400', async () => {
    // The version is decided server-side from what is served; a body that
    // names one is refused outright rather than silently stripped, so a client
    // built on the wrong assumption finds out.
    const response = await POST(createRequest({ kind: 'terms', documentVersion: '0.1' }, 'POST'));
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('answers 400 on an unknown kind', async () => {
    const response = await POST(createRequest({ kind: 'privacy' }, 'POST'));
    const body = (await response.json()) as StatusBody;

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(create).not.toHaveBeenCalled();
  });

  it('answers 400 on a missing body', async () => {
    const response = await POST(createRequest(undefined, 'POST'));
    expect(response.status).toBe(400);
  });
});
