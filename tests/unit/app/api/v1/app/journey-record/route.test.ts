/**
 * The journey record's routes: the envelope, whose record it is, what a
 * refusal looks like on the wire, and what never reaches the log
 * (f-journey-record t-145).
 *
 * What the store does is `tests/unit/lib/app/journey-record/record.test.ts`.
 * Here the store is a small stateful fake keyed by person, so the answer
 * depends on which id reached it: a route that read a subject out of the
 * request would get the wrong person's record rather than the same one.
 *
 * @see app/api/v1/app/journey-record/route.ts
 * @see app/api/v1/app/journey-record/[id]/route.ts
 * @see app/api/v1/app/journey-record/export/route.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser, mockUnauthenticatedUser } from '@/tests/helpers/auth';

/** The member the helpers sign in as. */
const ME = 'cmjbv4i3x00003wsloputgwul';
const THEM = 'cmu7other0000000000000000';
const MY_ENTRY = 'cmmine00000000000000000000';
const THEIR_ENTRY = 'cmtheirs000000000000000000';

const { owners, record, routeLog } = vi.hoisted(() => {
  /** Entry id → owner. */
  const owners = new Map<string, string>();
  const notFound = async () => {
    const { NotFoundError } = await import('@/lib/api/errors');
    return new NotFoundError('Entry not found');
  };
  return {
    owners,
    record: {
      getJourneyRecord: vi.fn(async (userId: string) => {
        const entries = [...owners].filter(([, owner]) => owner === userId);
        return {
          entries: entries.map(([id]) => ({ id, body: `${userId}'s words` })),
          matched: entries.length,
          total: entries.length,
          drafts: 0,
          totals: {
            synopses: 0,
            own: entries.length,
            outcomes: { action: 0, insight: 0, tension: 0 },
          },
          modules: [],
        };
      }),
      createOwnEntry: vi.fn(
        async (userId: string, entry: { body: string; withheldFromAgent?: boolean }) => {
          owners.set('cmnew000000000000000000000', userId);
          return {
            id: 'cmnew000000000000000000000',
            body: entry.body,
            withheldFromAgent: entry.withheldFromAgent ?? false,
          };
        }
      ),
      editOwnEntry: vi.fn(async (userId: string, id: string, edit: { body?: string }) => {
        if (owners.get(id) !== userId) throw await notFound();
        return { id, body: edit.body };
      }),
      removeJourneyEntry: vi.fn(async (userId: string, id: string) => {
        if (owners.get(id) !== userId) throw await notFound();
        owners.delete(id);
        return { id, kind: 'own' };
      }),
      exportJourneyRecordMarkdown: vi.fn(async (userId: string) => ({
        markdown: `# Your journey\n\n${userId}'s words\n`,
        entries: 1,
      })),
    },
    routeLog: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      withContext: vi.fn(function (this: unknown) {
        return this;
      }),
    },
  };
});

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/app/journey-record/record', () => record);

import { auth } from '@/lib/auth/config';
import { GET, POST } from '@/app/api/v1/app/journey-record/route';
import { DELETE, PATCH } from '@/app/api/v1/app/journey-record/[id]/route';
import { GET as EXPORT } from '@/app/api/v1/app/journey-record/export/route';

const BASE = 'https://lelanea.com/api/v1/app/journey-record';

function request(url: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Everything the route logged, as one string, to assert what never reaches it. */
function logged(): string {
  return JSON.stringify([routeLog.info.mock.calls, routeLog.withContext.mock.calls]);
}

beforeEach(() => {
  vi.clearAllMocks();
  owners.clear();
  owners.set(MY_ENTRY, ME);
  owners.set(THEIR_ENTRY, THEM);
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

describe('GET /api/v1/app/journey-record', () => {
  it('answers the caller’s own record, uncached', async () => {
    const response = await GET(request(BASE));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const text = await response.text();
    expect(text).toContain(MY_ENTRY);
    expect(text).not.toContain(THEIR_ENTRY);
    expect(record.getJourneyRecord).toHaveBeenCalledWith(ME, expect.anything());
  });

  it('passes the search and filters on, and never logs what was searched', async () => {
    await GET(request(`${BASE}?q=my+father&module=values&outcome=tension&drafts=true`));

    expect(record.getJourneyRecord).toHaveBeenCalledWith(ME, {
      q: 'my father',
      module: 'values',
      outcome: 'tension',
      drafts: true,
    });
    expect(routeLog.info).toHaveBeenCalledWith(
      'Own journey record read',
      expect.objectContaining({ searched: true, filtered: true })
    );
    // The logger's URL is overridden to the path; the search is nowhere.
    expect(logged()).not.toContain('father');
  });

  it('refuses a malformed filter', async () => {
    const response = await GET(request(`${BASE}?outcome=decision`));

    expect(response.status).toBe(400);
    expect(record.getJourneyRecord).not.toHaveBeenCalled();
  });

  it('refuses someone who is not signed in', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    expect((await GET(request(BASE))).status).toBe(401);
    expect(record.getJourneyRecord).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/app/journey-record', () => {
  it('writes an own entry under the caller’s id, and never logs the words', async () => {
    const response = await POST(
      request(BASE, 'POST', { body: 'Something about my father.', withheldFromAgent: true })
    );

    expect(response.status).toBe(201);
    expect(record.createOwnEntry).toHaveBeenCalledWith(ME, {
      body: 'Something about my father.',
      withheldFromAgent: true,
    });
    expect(logged()).not.toContain('father');
  });

  it('refuses an empty entry', async () => {
    const response = await POST(request(BASE, 'POST', { body: '   ' }));

    expect(response.status).toBe(400);
    expect(record.createOwnEntry).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/app/journey-record/:id', () => {
  it('changes the caller’s own entry, logging which fields and never their words', async () => {
    const response = await PATCH(
      request(`${BASE}/${MY_ENTRY}`, 'PATCH', { body: 'About my father, again.' }),
      params(MY_ENTRY)
    );

    expect(response.status).toBe(200);
    expect(record.editOwnEntry).toHaveBeenCalledWith(ME, MY_ENTRY, {
      body: 'About my father, again.',
    });
    expect(routeLog.info).toHaveBeenCalledWith(
      'Own journey entry changed',
      expect.objectContaining({ fields: ['body'] })
    );
    expect(logged()).not.toContain('father');
  });

  it('answers another person’s entry as not found', async () => {
    const response = await PATCH(
      request(`${BASE}/${THEIR_ENTRY}`, 'PATCH', { body: 'overwritten' }),
      params(THEIR_ENTRY)
    );

    expect(response.status).toBe(404);
  });

  it('refuses an edit that changes nothing, and an id that is not one', async () => {
    expect(
      (await PATCH(request(`${BASE}/${MY_ENTRY}`, 'PATCH', {}), params(MY_ENTRY))).status
    ).toBe(400);
    expect(
      (await PATCH(request(`${BASE}/not-an-id`, 'PATCH', { body: 'x' }), params('not-an-id')))
        .status
    ).toBe(400);
    expect(record.editOwnEntry).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/app/journey-record/:id', () => {
  it('removes the caller’s own entry', async () => {
    const response = await DELETE(request(`${BASE}/${MY_ENTRY}`, 'DELETE'), params(MY_ENTRY));

    expect(response.status).toBe(200);
    expect(owners.has(MY_ENTRY)).toBe(false);
  });

  it('answers another person’s entry as not found, and leaves it alone', async () => {
    const response = await DELETE(request(`${BASE}/${THEIR_ENTRY}`, 'DELETE'), params(THEIR_ENTRY));

    expect(response.status).toBe(404);
    expect(owners.get(THEIR_ENTRY)).toBe(THEM);
  });
});

describe('GET /api/v1/app/journey-record/export', () => {
  it('downloads the caller’s own record as Markdown that nothing should keep', async () => {
    const response = await EXPORT(request(`${BASE}/export`));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="lelanea-journey-\d{4}-\d{2}-\d{2}\.md"$/
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toContain(`${ME}'s words`);
    expect(record.exportJourneyRecordMarkdown).toHaveBeenCalledWith(ME);
  });
});
