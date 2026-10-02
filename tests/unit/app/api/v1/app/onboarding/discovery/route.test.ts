/**
 * GET + POST /api/v1/app/onboarding/discovery — the caller's discovery answers
 * (f-onboarding t-104).
 *
 * The store is mocked: its reads and writes (the versioned slot value, the
 * provenance, the resume point) are proved in
 * `tests/unit/lib/app/onboarding/discovery-store.test.ts`. Here: who may call,
 * what is accepted against the caller's current set, and that every write is
 * keyed on the caller.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));

const store = vi.hoisted(() => ({
  answerDiscoveryQuestion: vi.fn(),
  getDiscoveryState: vi.fn(),
  leaveDiscovery: vi.fn(),
  skipDiscoveryQuestion: vi.fn(),
}));
vi.mock('@/lib/app/onboarding/discovery-store', () => store);

const slots = vi.hoisted(() => ({ getDiscoverySet: vi.fn() }));
vi.mock('@/lib/app/onboarding/discovery-slots', () => slots);

const gate = vi.hoisted(() => ({ hasPassedGate: vi.fn() }));
vi.mock('@/lib/app/gateway/gate', () => gate);

import { GET, POST } from '@/app/api/v1/app/onboarding/discovery/route';
import { auth } from '@/lib/auth/config';
import { API_KEY_SESSION_ID_PREFIX } from '@/lib/auth/api-keys';
import { MAX_ANSWER_LENGTH } from '@/lib/app/onboarding/discovery';

function createRequest(body?: unknown, method = 'POST'): NextRequest {
  return {
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    url: 'http://localhost:3000/api/v1/app/onboarding/discovery',
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

const Q01 = { id: 'q01', slotSlug: 'discovery_q01', core: false };
const Q02 = { id: 'q02', slotSlug: 'discovery_q02', core: true };
const Q04 = {
  id: 'q04',
  slotSlug: 'discovery_q04',
  core: false,
  conditionalFollowUp: { ifYes: 'Describe it.', ifNo: 'Imagine it.' },
};
const SET = {
  moduleSlug: 'onboarding',
  pacing: { rushDiscouraged: true, allowPartialCompletion: true, note: '' },
  questions: [Q01, Q02, Q04],
};
const WHOLE_SET = { ...SET, pacing: { ...SET.pacing, allowPartialCompletion: false } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(createSession());
  gate.hasPassedGate.mockResolvedValue(true);
  slots.getDiscoverySet.mockResolvedValue(SET);
  store.answerDiscoveryQuestion.mockResolvedValue({ outcome: 'written', version: 3 });
  store.skipDiscoveryQuestion.mockResolvedValue('recorded');
  store.leaveDiscovery.mockResolvedValue('recorded');
});

async function post(body: unknown) {
  const response = await POST(createRequest(body));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('POST answer', () => {
  it('writes the caller’s answer to a question in their set', async () => {
    const { status, body } = await post({ action: 'answer', questionId: 'q01', answer: ' Loud. ' });
    expect(status).toBe(200);
    expect(body.data).toEqual({
      action: 'answer',
      questionId: 'q01',
      outcome: 'written',
      version: 3,
    });
    expect(store.answerDiscoveryQuestion).toHaveBeenCalledWith('user_test', SET, Q01, {
      words: 'Loud.',
    });
  });

  it('passes the branch on a question that branches', async () => {
    await post({ action: 'answer', questionId: 'q04', answer: 'Calm.', branch: 'no' });
    expect(store.answerDiscoveryQuestion).toHaveBeenCalledWith('user_test', SET, Q04, {
      words: 'Calm.',
      branch: 'no',
    });
  });

  it.each([
    ['an unknown question id', { action: 'answer', questionId: 'q99', answer: 'x' }],
    ['an empty answer', { action: 'answer', questionId: 'q01', answer: '  ' }],
    [
      'an over-length answer',
      { action: 'answer', questionId: 'q01', answer: 'x'.repeat(MAX_ANSWER_LENGTH + 1) },
    ],
    ['a branching question with no branch', { action: 'answer', questionId: 'q04', answer: 'x' }],
    [
      'a branch on a question that does not branch',
      { action: 'answer', questionId: 'q01', answer: 'x', branch: 'yes' },
    ],
    ['no action', { questionId: 'q01', answer: 'x' }],
  ])('refuses %s with a 400 and writes nothing', async (_label, requestBody) => {
    const { status, body } = await post(requestBody);
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(store.answerDiscoveryQuestion).not.toHaveBeenCalled();
  });

  it('refuses a question the Core Set leaves out of the caller’s current set', async () => {
    slots.getDiscoverySet.mockResolvedValue({ ...SET, questions: [Q02] });
    const { status } = await post({ action: 'answer', questionId: 'q01', answer: 'x' });
    expect(status).toBe(400);
    expect(store.answerDiscoveryQuestion).not.toHaveBeenCalled();
  });

  it('is an error, not a success, when the words did not land', async () => {
    store.answerDiscoveryQuestion.mockRejectedValue(new Error('db down'));
    const { status } = await post({ action: 'answer', questionId: 'q01', answer: 'x' });
    expect(status).toBe(500);
  });
});

describe('POST skip and leave', () => {
  it('records a skip for the caller', async () => {
    const { status, body } = await post({ action: 'skip', questionId: 'q01' });
    expect(status).toBe(200);
    expect(body.data).toEqual({ action: 'skip', questionId: 'q01', recorded: true });
    expect(store.skipDiscoveryQuestion).toHaveBeenCalledWith('user_test', 'q01');
  });

  it('refuses to skip a core question', async () => {
    const { status } = await post({ action: 'skip', questionId: 'q02' });
    expect(status).toBe(400);
    expect(store.skipDiscoveryQuestion).not.toHaveBeenCalled();
  });

  it('refuses to skip an unknown question', async () => {
    const { status } = await post({ action: 'skip', questionId: 'q99' });
    expect(status).toBe(400);
    expect(store.skipDiscoveryQuestion).not.toHaveBeenCalled();
  });

  it('says a skip was not recorded, without failing, when there is no journey', async () => {
    store.skipDiscoveryQuestion.mockResolvedValue('failed');
    const { status, body } = await post({ action: 'skip', questionId: 'q01' });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ recorded: false });
  });

  it('records leaving for the caller', async () => {
    const { status, body } = await post({ action: 'leave' });
    expect(status).toBe(200);
    expect(body.data).toEqual({ action: 'leave', recorded: true });
    expect(store.leaveDiscovery).toHaveBeenCalledWith('user_test');
  });

  it.each([
    ['a skip', { action: 'skip', questionId: 'q01' }],
    ['a leave', { action: 'leave' }],
  ])('refuses %s when the set does not allow partial completion', async (_label, request) => {
    slots.getDiscoverySet.mockResolvedValue(WHOLE_SET);
    const { status } = await post(request);
    expect(status).toBe(400);
    expect(store.skipDiscoveryQuestion).not.toHaveBeenCalled();
    expect(store.leaveDiscovery).not.toHaveBeenCalled();
  });

  it('still accepts an answer when the set does not allow partial completion', async () => {
    slots.getDiscoverySet.mockResolvedValue(WHOLE_SET);
    const { status } = await post({ action: 'answer', questionId: 'q01', answer: 'x' });
    expect(status).toBe(200);
    expect(store.answerDiscoveryQuestion).toHaveBeenCalled();
  });
});

describe('who may call', () => {
  it('refuses a signed-out caller, writing nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const { status } = await post({ action: 'answer', questionId: 'q01', answer: 'x' });
    expect(status).toBe(401);
    expect(store.answerDiscoveryQuestion).not.toHaveBeenCalled();
  });

  it('refuses an API key: these are a person’s own answers', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(
      createSession(`${API_KEY_SESSION_ID_PREFIX}key_1`)
    );
    const { status } = await post({ action: 'answer', questionId: 'q01', answer: 'x' });
    expect(status).toBe(403);
    expect(store.answerDiscoveryQuestion).not.toHaveBeenCalled();
  });

  it.each([
    ['an answer', { action: 'answer', questionId: 'q01', answer: 'x' }],
    ['a skip', { action: 'skip', questionId: 'q01' }],
    ['a leave', { action: 'leave' }],
  ])('refuses %s from someone not past the gate, writing nothing (t-124)', async (_, body) => {
    gate.hasPassedGate.mockResolvedValue(false);
    const { status } = await post(body);
    expect(status).toBe(403);
    expect(gate.hasPassedGate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user_test', email: 'member@example.com', emailVerified: true })
    );
    expect(store.answerDiscoveryQuestion).not.toHaveBeenCalled();
    expect(store.skipDiscoveryQuestion).not.toHaveBeenCalled();
    expect(store.leaveDiscovery).not.toHaveBeenCalled();
  });

  it('lets someone past the gate write, asking the gate about the caller', async () => {
    const { status } = await post({ action: 'answer', questionId: 'q01', answer: 'x' });
    expect(status).toBe(200);
    expect(gate.hasPassedGate).toHaveBeenCalledWith(expect.objectContaining({ id: 'user_test' }));
    expect(store.answerDiscoveryQuestion).toHaveBeenCalled();
  });

  it('reads the GET without asking the gate: reading your own answers writes nothing', async () => {
    store.getDiscoveryState.mockResolvedValue({ position: { next: null, finished: true } });
    gate.hasPassedGate.mockResolvedValue(false);
    const response = await GET(createRequest(undefined, 'GET'));
    expect(response.status).toBe(200);
  });

  it('refuses a signed-out GET', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const response = await GET(createRequest(undefined, 'GET'));
    expect(response.status).toBe(401);
  });
});

describe('GET', () => {
  it('answers the caller’s state', async () => {
    const state = {
      set: SET,
      answers: { q01: { words: 'x' } },
      versions: { q01: 1 },
      position: { next: 'q02', skipped: [], finished: false },
      started: true,
    };
    store.getDiscoveryState.mockResolvedValue(state);
    const response = await GET(createRequest(undefined, 'GET'));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: unknown }).data).toEqual(state);
    expect(store.getDiscoveryState).toHaveBeenCalledWith('user_test');
  });

  it('is a 500, not an empty answer, when the state could not be read', async () => {
    store.getDiscoveryState.mockResolvedValue(null);
    const response = await GET(createRequest(undefined, 'GET'));
    expect(response.status).toBe(500);
  });
});
