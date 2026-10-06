/**
 * The conversation read route — the envelope around the transcript (§10 t-64).
 *
 * The read itself is `tests/unit/lib/app/conversation/transcript.test.ts`.
 * This is who may ask, which seats, caching, and that another person's
 * conversation is unreachable by construction: the read is keyed on the
 * session's id and takes no subject from the request.
 *
 * @see app/api/v1/app/conversation/route.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser, mockUnauthenticatedUser } from '@/tests/helpers/auth';

const ME = 'cmjbv4i3x00003wsloputgwul';
const OTHER = 'cmu7other0000000000000000';

const { store, readTranscript, routeLog, openingDue, arriveSessionQuietly } = vi.hoisted(() => ({
  openingDue: vi.fn(),
  arriveSessionQuietly: vi.fn(),
  store: new Map<string, { seat: string; conversationId: string | null; entries: unknown[] }>(),
  readTranscript: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/app/conversation/transcript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/conversation/transcript')>();
  return { ...actual, readTranscript };
});

vi.mock('@/lib/app/conversation/opening', () => ({ openingDue }));
vi.mock('@/lib/app/sessions/store', () => ({ arriveSessionQuietly }));

import { auth } from '@/lib/auth/config';
import { GET } from '@/app/api/v1/app/conversation/route';

function request(path = '/api/v1/app/conversation'): NextRequest {
  return new NextRequest(`https://lelanea.com${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  // A transcript keyed on (person, seat) — the only way to reach a row is to
  // be the person it belongs to.
  readTranscript.mockImplementation(async (session: { user: { id: string } }, seat: string) => {
    return store.get(`${session.user.id}:${seat}`) ?? { seat, conversationId: null, entries: [] };
  });
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
  openingDue.mockResolvedValue(false);
  arriveSessionQuietly.mockResolvedValue({
    session: { id: 'ses-1', ordinal: 1, startedAt: new Date(), closedAt: null },
    opened: false,
  });
});

describe('GET /api/v1/app/conversation', () => {
  it('answers the caller’s facilitator conversation by default, uncached', async () => {
    store.set(`${ME}:facilitator`, {
      seat: 'facilitator',
      conversationId: 'c-mine',
      entries: [{ kind: 'user', id: 'u1', text: 'hi', at: 'now', turnId: 't1' }],
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(readTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: ME }) }),
      'facilitator'
    );
    expect(await response.json()).toMatchObject({
      success: true,
      data: { conversationId: 'c-mine', entries: [{ id: 'u1' }] },
    });
  });

  it('is empty with 200 when nothing has been said yet', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { conversationId: null, entries: [] },
    });
  });

  it('reads the onboarding seat when asked, and refuses a seat this leaf does not seed', async () => {
    await GET(request('/api/v1/app/conversation?seat=onboarding'));
    expect(readTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: ME }) }),
      'onboarding'
    );

    const refused = await GET(request('/api/v1/app/conversation?seat=synopsis'));
    expect(refused.status).toBe(400);
    expect(readTranscript).toHaveBeenCalledTimes(1);
  });

  it('cannot reach another person’s conversation, having shown that person has one', async () => {
    store.set(`${OTHER}:facilitator`, {
      seat: 'facilitator',
      conversationId: 'c-theirs',
      entries: [{ kind: 'user', id: 'theirs', text: 'private', at: 'now', turnId: 't' }],
    });
    // The population: the other person's row exists in the store.
    expect(store.get(`${OTHER}:facilitator`)?.entries).toHaveLength(1);

    // There is no parameter that names a subject; the only id used is the
    // session's. Whatever the query says, the read is for ME.
    const response = await GET(request(`/api/v1/app/conversation?userId=${OTHER}`));
    const body = await response.json();

    expect(readTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: ME }) }),
      'facilitator'
    );
    expect(body.data.conversationId).toBeNull();
    expect(JSON.stringify(body)).not.toContain('private');
  });

  it('refuses an unauthenticated request', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(readTranscript).not.toHaveBeenCalled();
  });

  it('never logs the words, only the count', async () => {
    store.set(`${ME}:facilitator`, {
      seat: 'facilitator',
      conversationId: 'c-mine',
      entries: [{ kind: 'user', id: 'u1', text: 'my marriage', at: 'now', turnId: 't1' }],
    });
    await GET(request());
    expect(JSON.stringify(routeLog.info.mock.calls)).not.toContain('my marriage');
    expect(routeLog.info).toHaveBeenCalledWith(
      'Own conversation read',
      expect.objectContaining({ entries: 1, resumed: true })
    );
  });
});

describe('the opening flag (t-122)', () => {
  it('says the opening is owed on an empty facilitator transcript the opening rules allow', async () => {
    openingDue.mockResolvedValue(true);
    const body = await (await GET(request())).json();
    expect(body.data.opening).toBe(true);
    expect(openingDue).toHaveBeenCalledWith(expect.objectContaining({ id: ME }));
  });

  it('is false when the opening rules say no', async () => {
    const body = await (await GET(request())).json();
    expect(body.data.opening).toBe(false);
  });

  it('is false once anything is in the transcript, without asking', async () => {
    openingDue.mockResolvedValue(true);
    store.set(`${ME}:facilitator`, {
      seat: 'facilitator',
      conversationId: 'c-mine',
      entries: [{ kind: 'reply', id: 'r1', text: 'Hello', at: 'now', turnId: 'o' }],
    });
    const body = await (await GET(request())).json();
    expect(body.data.opening).toBe(false);
    expect(openingDue).not.toHaveBeenCalled();
  });

  it('is absent on the onboarding seat: the opening is the facilitator’s', async () => {
    openingDue.mockResolvedValue(true);
    const body = await (await GET(request('/api/v1/app/conversation?seat=onboarding'))).json();
    expect(body.data).not.toHaveProperty('opening');
    expect(openingDue).not.toHaveBeenCalled();
  });
});

describe('arriving (f-recap t-141)', () => {
  it.each(['facilitator', 'onboarding'])(
    'opens or resumes the caller’s session on the %s seat',
    async (seat) => {
      await GET(request(`/api/v1/app/conversation?seat=${seat}`));

      expect(arriveSessionQuietly).toHaveBeenCalledTimes(1);
      expect(arriveSessionQuietly).toHaveBeenCalledWith(ME);
      expect(arriveSessionQuietly).not.toHaveBeenCalledWith(OTHER);
    }
  );

  it('has arrived before the opening is decided', async () => {
    const order: string[] = [];
    arriveSessionQuietly.mockImplementationOnce(async () => {
      // Settles after the transcript read has had its turn.
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('arrived');
      return null;
    });
    openingDue.mockImplementationOnce(async () => {
      order.push('opening');
      return false;
    });

    await GET(request());

    expect(order).toEqual(['arrived', 'opening']);
  });

  it('still answers the conversation when the session could not be written', async () => {
    arriveSessionQuietly.mockResolvedValueOnce(null);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(routeLog.info).toHaveBeenCalledWith(
      'Own conversation read',
      expect.objectContaining({ sessionOpened: false })
    );
  });

  it('logs when this read began a session', async () => {
    arriveSessionQuietly.mockResolvedValueOnce({
      session: { id: 'ses-2', ordinal: 2, startedAt: new Date(), closedAt: null },
      opened: true,
    });

    await GET(request());

    expect(routeLog.info).toHaveBeenCalledWith(
      'Own conversation read',
      expect.objectContaining({ sessionOpened: true })
    );
  });
});
