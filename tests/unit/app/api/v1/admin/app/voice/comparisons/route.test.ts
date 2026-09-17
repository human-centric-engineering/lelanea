/**
 * GET / POST /api/v1/admin/app/voice/comparisons
 *
 * The POST is the unusual one: it is the only route in this feature that
 * **spends money**. Queueing a comparison puts two evaluation runs in front of
 * the maintenance worker, which drains every case through a real provider twice
 * over, with a judge call each. So the guard matters here for a reason beyond
 * the usual one — an ordinary user is not merely reading something they should
 * not, they are billing the install.
 *
 * The other property worth pinning is that the refusals reach the caller intact.
 * `assertArmsComparable` produces messages naming the arm and the remedy, and
 * they are the whole value of the guard: a route that caught them and answered
 * "could not queue" would turn a diagnosis somebody can act on into one they
 * cannot.
 *
 * `/pre-pr`'s `check:missing-tests` named this route as an outright gap on t-28.
 *
 * @see app/api/v1/admin/app/voice/comparisons/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const { listVoiceComparisons, queueVoiceComparison, routeLog } = vi.hoisted(() => ({
  listVoiceComparisons: vi.fn(),
  queueVoiceComparison: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/voice/comparison-admin', () => ({ listVoiceComparisons }));
vi.mock('@/lib/app/voice/comparison', () => ({ queueVoiceComparison }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));

import { auth } from '@/lib/auth/config';
import { ValidationError } from '@/lib/api/errors';
import { GET, POST } from '@/app/api/v1/admin/app/voice/comparisons/route';

const ENDPOINT = 'https://lelanea.com/api/v1/admin/app/voice/comparisons';

function getRequest(): NextRequest {
  return new Request(ENDPOINT) as unknown as NextRequest;
}

function postRequest(): NextRequest {
  return new Request(ENDPOINT, { method: 'POST' }) as unknown as NextRequest;
}

const QUEUED = {
  comparisonId: 'cmu4paqmt0000oc5new0nizu5',
  goldenSetVersion: '1.0',
  caseCount: 5,
  arms: [
    {
      arm: 'fingerprint',
      agentSlug: 'lelanea-guide',
      fingerprintVersion: '1.0',
      evaluationRunId: 'run-1',
    },
    {
      arm: 'bare',
      agentSlug: 'voice-control-bare',
      fingerprintVersion: null,
      evaluationRunId: 'run-2',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  listVoiceComparisons.mockResolvedValue([]);
  queueVoiceComparison.mockResolvedValue(QUEUED);
});

describe('the guard', () => {
  it('answers 401 to nobody, and reads nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(listVoiceComparisons).not.toHaveBeenCalled();
  });

  it('answers 403 to a signed-in non-admin, and queues nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

    const response = await POST(postRequest());

    // Not merely a read they should not have: a queued comparison drains every
    // case through a real provider twice, with a judge call each.
    expect(response.status).toBe(403);
    expect(queueVoiceComparison).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('returns the comparisons the reader built', async () => {
    listVoiceComparisons.mockResolvedValue([{ id: 'cmp-a', arms: [] }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string }[] };
    expect(body.data).toEqual([{ id: 'cmp-a', arms: [] }]);
  });
});

describe('POST', () => {
  it('queues on behalf of the calling admin and answers 201', async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(201);
    // The run rows carry this id, which is what makes the comparison visible in
    // the platform's own run list and what the judge is driven as.
    expect(queueVoiceComparison).toHaveBeenCalledWith(mockAdminUser().user.id);

    const body = (await response.json()) as { data: typeof QUEUED };
    expect(body.data.comparisonId).toBe(QUEUED.comparisonId);
  });

  it('hands the guard’s refusal to the caller verbatim', async () => {
    // The whole value of `assertArmsComparable` is in its wording — which arm,
    // and what to do about it. A route that flattened this to "could not queue"
    // would leave an operator with a diagnosis they cannot act on (`HB10`).
    queueVoiceComparison.mockRejectedValue(
      // A sentinel rather than the guard's real wording: the route's job is to
      // pass the message through, which any distinctive string proves.
      new ValidationError('FIXTURE REFUSAL: the arm and the remedy, in the guard’s own words.')
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain('FIXTURE REFUSAL');
  });
});
