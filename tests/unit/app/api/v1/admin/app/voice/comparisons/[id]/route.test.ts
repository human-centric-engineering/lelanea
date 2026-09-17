/**
 * GET /api/v1/admin/app/voice/comparisons/:id?against=<id>
 *
 * A read, so the interesting part is not the guard — it is what the route does
 * with the second id. Three decisions are pinned here, and each of them is a
 * thing a caller can do by accident:
 *
 * - **`?against=` pointing at the comparison already in the path** is what a
 *   "compare with…" link does when somebody picks the row they are looking at.
 *   Answering that with a 400 would be technically defensible and useless; the
 *   route de-duplicates and renders one set of columns.
 * - **Both ids are validated as cuids**, the query one included. It reaches a
 *   `findMany({ where: { id: { in } } })`, so an unvalidated value is not a
 *   crash but a silently empty second column — which reads as a comparison
 *   whose other version answered nothing.
 * - **An id that does not exist is a 404**, never one column rendered as though
 *   it were the whole answer.
 *
 * `/pre-pr`'s `check:missing-tests` named this route as an outright gap on t-28.
 *
 * @see app/api/v1/admin/app/voice/comparisons/[id]/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const { getVoiceComparison, routeLog } = vi.hoisted(() => ({
  getVoiceComparison: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/voice/comparison-admin', () => ({ getVoiceComparison }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));

import { auth } from '@/lib/auth/config';
import { NotFoundError } from '@/lib/api/errors';
import { GET } from '@/app/api/v1/admin/app/voice/comparisons/[id]/route';

/** Real cuid shapes — `cuidSchema` rejects anything else. */
const ID = 'cmu4paqmt0000oc5new0nizu5';
const OTHER = 'cmu4paqmt0001oc5new0nizu6';

/**
 * A real `NextRequest`, not a cast `Request`.
 *
 * The handler reads `request.nextUrl.searchParams`, which only a `NextRequest`
 * has — a cast plain `Request` gives it `undefined` and every case 500s
 * identically, which is a failure that tells you nothing about the route.
 */
function request(id = ID, against?: string) {
  const query = against ? `?against=${encodeURIComponent(against)}` : '';
  const req = new NextRequest(
    `https://lelanea.com/api/v1/admin/app/voice/comparisons/${id}${query}`
  );
  return [req, { params: Promise.resolve({ id }) }] as const;
}

const DETAIL = { comparisons: [], columns: [], cases: [], mixedGoldenSets: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  getVoiceComparison.mockResolvedValue(DETAIL);
});

describe('the guard', () => {
  it('answers 401 to nobody, and reads nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await GET(...request());

    expect(response.status).toBe(401);
    expect(getVoiceComparison).not.toHaveBeenCalled();
  });

  it('answers 403 to a signed-in non-admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

    const response = await GET(...request());

    expect(response.status).toBe(403);
    expect(getVoiceComparison).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('reads one comparison when no second is named', async () => {
    const response = await GET(...request());

    expect(response.status).toBe(200);
    expect(getVoiceComparison).toHaveBeenCalledWith([ID]);
  });

  it('reads both when a second is named', async () => {
    await GET(...request(ID, OTHER));

    expect(getVoiceComparison).toHaveBeenCalledWith([ID, OTHER]);
  });

  it('de-duplicates `?against=` pointing at the comparison in the path', async () => {
    // What a "compare with…" link does when somebody picks the row they are
    // already looking at. One set of columns beats a 400.
    await GET(...request(ID, ID));

    expect(getVoiceComparison).toHaveBeenCalledWith([ID]);
  });

  it('refuses an `against` that is not a cuid before touching the reader', async () => {
    // Not a crash if it got through — `{ id: { in: [...] } }` simply matches
    // nothing, and the second column renders empty, which reads as a version
    // that answered nothing rather than as a bad request.
    const response = await GET(...request(ID, '../../etc/passwd'));

    expect(response.status).toBe(400);
    expect(getVoiceComparison).not.toHaveBeenCalled();
  });

  it('refuses a path id that is not a cuid', async () => {
    const response = await GET(...request('not-a-cuid'));

    expect(response.status).toBe(400);
    expect(getVoiceComparison).not.toHaveBeenCalled();
  });

  it('answers 404 for a comparison that is not there', async () => {
    getVoiceComparison.mockRejectedValue(new NotFoundError(`No such comparison: ${OTHER}`));

    const response = await GET(...request(ID, OTHER));

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { message: string } };
    // Names WHICH id was missing — with two in play, "not found" alone leaves
    // the reader guessing which half of their comparison is gone.
    expect(body.error.message).toContain(OTHER);
  });
});
