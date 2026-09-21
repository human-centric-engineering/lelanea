/**
 * The member notes routes — the envelope, and whose notes they are
 * (f-slots t-73).
 *
 * What the read and the correction actually DO is
 * `tests/unit/lib/app/slots/notes.test.ts`, against a Prisma fake with
 * Daybreak's value engine running for real — and the query surface (t-79) is
 * `route-query.test.ts`, which runs this route over that same fake. This file is the layer above: who
 * may call, whose id reaches the store, what a refusal looks like on the wire,
 * and what does not reach the log.
 *
 * The store is a small stateful fake keyed by person, so the answer depends on
 * which id got there — a route that read an id out of the request would return
 * the wrong person's notes rather than the same ones.
 *
 * @see app/api/v1/app/notes/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser, mockUnauthenticatedUser } from '@/tests/helpers/auth';

/** The member the helpers sign in as. */
const ME = 'cmjbv4i3x00003wsloputgwul';
/** Somebody else, with notes of their own. */
const THEM = 'cmu7other0000000000000000';

const { store, notes, routeLog } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    notes: {
      getNotes: vi.fn(async (userId: string) => ({
        notes: store.has(userId)
          ? [{ slotSlug: 'life_work', group: 'life_areas', value: store.get(userId) }]
          : [],
        groups: store.has(userId) ? [{ key: 'life_areas', title: 'Life areas', count: 1 }] : [],
        own: 0,
        total: store.has(userId) ? 1 : 0,
        matched: store.has(userId) ? 1 : 0,
      })),
      correctNote: vi.fn(async ({ slotSlug }: { slotSlug: string }) => ({ slotSlug, version: 2 })),
    },
    routeLog: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      // Returns itself, so an entry's fields are read off one spy whatever
      // context the route layers on; the context itself is asserted below.
      withContext: vi.fn(function (this: unknown) {
        return this;
      }),
    },
  };
});

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/app/slots/notes', () => notes);

import { auth } from '@/lib/auth/config';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { GET, POST } from '@/app/api/v1/app/notes/route';

function read(): NextRequest {
  return new NextRequest('https://lelanea.com/api/v1/app/notes');
}

function correct(body: unknown): NextRequest {
  return new NextRequest('https://lelanea.com/api/v1/app/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  store.set(ME, 'mine');
  store.set(THEM, 'theirs');
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

describe('GET /api/v1/app/notes', () => {
  it('answers the caller’s own notes, uncached', async () => {
    const response = await GET(read());

    expect(response.status).toBe(200);
    // A note can land mid-turn, and the panel re-reads to see it.
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as { data: { total: number } };
    expect(body).toMatchObject({ success: true, data: { total: 1 } });
    expect(JSON.stringify(body)).toContain('mine');
    // The other person's row exists in the same store, so this is the id being
    // carried rather than there being nothing else to find.
    expect(JSON.stringify(body)).not.toContain('theirs');
    // No query string, so no query: the whole record, in the default order.
    expect(notes.getNotes).toHaveBeenCalledWith(ME, {});
  });

  it('is closed to a caller with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await GET(read());

    expect(response.status).toBe(401);
    expect(notes.getNotes).not.toHaveBeenCalled();
  });

  it('counts what it answered without naming any of it', async () => {
    await GET(read());

    const [, fields] = routeLog.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields).toMatchObject({ userId: ME, notes: 1 });
    // A minted slug is model-authored free text drawn from what the person
    // said, and durable app logs are not erasure-covered — `capture.ts` gives
    // the same reasoning for its own log line.
    expect(Object.keys(fields)).not.toContain('slotSlug');
    expect(JSON.stringify(fields)).not.toContain('mine');
  });
});

describe('POST /api/v1/app/notes', () => {
  it('corrects under the caller’s own id', async () => {
    const response = await POST(correct({ slotSlug: 'life_work', value: 'it is going fine' }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { slotSlug: 'life_work', version: 2 },
    });
    expect(notes.correctNote).toHaveBeenCalledWith({
      userId: ME,
      slotSlug: 'life_work',
      value: 'it is going fine',
    });
  });

  it('refuses a body that names a subject', async () => {
    // The schema is strict, so `userId` is a validation failure rather than a
    // field quietly dropped — someone who thought they were correcting another
    // person's note is told they were not.
    const response = await POST(
      correct({ slotSlug: 'life_work', value: 'theirs now', userId: THEM })
    );

    expect(response.status).toBe(400);
    expect(notes.correctNote).not.toHaveBeenCalled();
  });

  it('refuses an empty correction', async () => {
    const response = await POST(correct({ slotSlug: 'life_work', value: '   ' }));

    expect(response.status).toBe(400);
    expect(notes.correctNote).not.toHaveBeenCalled();
  });

  it('is closed to a caller with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await POST(correct({ slotSlug: 'life_work', value: 'anything' }));

    expect(response.status).toBe(401);
    expect(notes.correctNote).not.toHaveBeenCalled();
  });

  it('passes a hidden-or-absent refusal through as a 404', async () => {
    notes.correctNote.mockRejectedValueOnce(
      new NotFoundError('There is no note under that heading to correct.')
    );

    const response = await POST(correct({ slotSlug: 'development_stage', value: 'stage four' }));

    expect(response.status).toBe(404);
  });

  it('passes a refusal’s own message through, because it names the remedy', async () => {
    notes.correctNote.mockRejectedValueOnce(
      new ConflictError('Ask her about it instead.', { reason: 'kept_out_of_the_record' })
    );

    const response = await POST(correct({ slotSlug: 'life_physical_health', value: 'anything' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      error: {
        message: 'Ask her about it instead.',
        details: { reason: 'kept_out_of_the_record' },
      },
    });
  });

  it('records that a correction happened without recording what it said', async () => {
    await POST(correct({ slotSlug: 'life_work', value: 'something private' }));

    const [, fields] = routeLog.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields).toMatchObject({ userId: ME, version: 2 });
    expect(JSON.stringify(fields)).not.toContain('something private');
    expect(JSON.stringify(fields)).not.toContain('life_work');
  });
});
