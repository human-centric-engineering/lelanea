/**
 * Keeping a synopsis and asking for another draft, on the wire
 * (f-journey-record t-147): the envelope, whose draft it is, what is refused
 * before the store is reached, the per-person sub-cap, and what never reaches
 * the log.
 *
 * What keeping and regenerating do is `keep.test.ts` and `regenerate.test.ts`.
 * Here both are a small stateful fake keyed by person, so the answer depends
 * on which id reached it: a route that read a subject out of the request would
 * get the wrong person's draft rather than the same one.
 *
 * @see app/api/v1/app/journey-record/[id]/keep/route.ts
 * @see app/api/v1/app/journey-record/[id]/regenerate/route.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  createMockAuthSession,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

/** The member the helpers sign in as. */
const ME = 'cmjbv4i3x00003wsloputgwul';
const THEM = 'cmu7other0000000000000000';
const MY_DRAFT = 'cmmine00000000000000000000';
const THEIR_DRAFT = 'cmtheirs000000000000000000';

const { owners, keep, regenerate, routeLog } = vi.hoisted(() => {
  /** Entry id → owner. */
  const owners = new Map<string, string>();
  const notFound = async () => {
    const { NotFoundError } = await import('@/lib/api/errors');
    return new NotFoundError('Entry not found');
  };
  return {
    owners,
    keep: {
      keepSynopsis: vi.fn(
        async (userId: string, id: string, input: { edit?: { body: string } }) => {
          if (owners.get(id) !== userId) throw await notFound();
          return {
            entry: { id, state: 'kept', body: input.edit?.body ?? 'as drafted' },
            notes: [{ slotSlug: 'life_work', outcome: 'confirmed' }],
            notesUnread: null,
          };
        }
      ),
    },
    regenerate: {
      regenerateSynopsis: vi.fn(async (userId: string, id: string) => {
        if (owners.get(id) !== userId) throw await notFound();
        return { id, state: 'draft', body: 'a new draft', regenerationsLeft: 2 };
      }),
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
vi.mock('@/lib/app/journey-record/keep', () => keep);
vi.mock('@/lib/app/journey-record/synopsis/regenerate', () => regenerate);

import { auth } from '@/lib/auth/config';
import { POST as KEEP } from '@/app/api/v1/app/journey-record/[id]/keep/route';
import { POST as REGENERATE } from '@/app/api/v1/app/journey-record/[id]/regenerate/route';
import {
  SYNOPSIS_CALLS_PER_MINUTE,
  synopsisCallKey,
  synopsisCallLimiter,
} from '@/lib/app/journey-record/rate-limit';
import { SYNOPSIS_STEER_MAX } from '@/lib/app/journey-record/entry';

const BASE = 'https://lelanea.com/api/v1/app/journey-record';

function request(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const keepUrl = (id: string) => `${BASE}/${id}/keep`;
const regenerateUrl = (id: string) => `${BASE}/${id}/regenerate`;

const EDIT = {
  summary: 'About my father and the shop',
  body: 'You talked about my father closing the shop.',
  outcomes: [{ kind: 'insight', text: 'The standard was never mine' }],
};
const CONFIRM = [{ slotSlug: 'life_work', version: 2 }];

/** Everything the route logged, as one string, to assert what never reaches it. */
function logged(): string {
  return JSON.stringify([routeLog.info.mock.calls, routeLog.withContext.mock.calls]);
}

function signInAs(userId: string): void {
  const session = createMockAuthSession();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    ...session,
    session: { ...session.session, userId },
    user: { ...session.user, id: userId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  owners.clear();
  owners.set(MY_DRAFT, ME);
  owners.set(THEIR_DRAFT, THEM);
  synopsisCallLimiter.reset(synopsisCallKey(ME));
  synopsisCallLimiter.reset(synopsisCallKey(THEM));
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

describe('POST /api/v1/app/journey-record/:id/keep', () => {
  it('keeps the caller’s own draft as written, and answers what it did to the notes', async () => {
    const response = await KEEP(request(keepUrl(MY_DRAFT), { confirm: CONFIRM }), params(MY_DRAFT));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { entry: { id: string; state: string }; notes: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.entry).toMatchObject({ id: MY_DRAFT, state: 'kept' });
    expect(body.data.notes).toEqual([{ slotSlug: 'life_work', outcome: 'confirmed' }]);
    expect(keep.keepSynopsis).toHaveBeenCalledWith(ME, MY_DRAFT, { confirm: CONFIRM });
  });

  it('passes an edit on, and never logs its words or a note’s slot', async () => {
    const response = await KEEP(
      request(keepUrl(MY_DRAFT), { confirm: CONFIRM, edit: EDIT }),
      params(MY_DRAFT)
    );

    expect(response.status).toBe(200);
    expect(keep.keepSynopsis).toHaveBeenCalledWith(ME, MY_DRAFT, { confirm: CONFIRM, edit: EDIT });
    expect(routeLog.info).toHaveBeenCalledWith(
      'Synopsis kept by the person it is about',
      expect.objectContaining({ edited: true, notes: ['confirmed'] })
    );
    const log = logged();
    expect(log).not.toContain('father');
    expect(log).not.toContain('standard');
    expect(log).not.toContain('life_work');
  });

  it('refuses a body with no confirm list, without reaching the store', async () => {
    const response = await KEEP(request(keepUrl(MY_DRAFT), {}), params(MY_DRAFT));

    expect(response.status).toBe(400);
    expect(keep.keepSynopsis).not.toHaveBeenCalled();
  });

  it.each([
    ['no summary', { body: EDIT.body, outcomes: [] }],
    ['a blank summary', { ...EDIT, summary: '   ' }],
    ['no body', { summary: EDIT.summary, outcomes: [] }],
    ['no outcomes', { summary: EDIT.summary, body: EDIT.body }],
    ['an outcome of an unknown kind', { ...EDIT, outcomes: [{ kind: 'decision', text: 'x' }] }],
  ])('refuses an edit with %s', async (_label, edit) => {
    const response = await KEEP(
      request(keepUrl(MY_DRAFT), { confirm: [], edit }),
      params(MY_DRAFT)
    );

    expect(response.status).toBe(400);
    expect(keep.keepSynopsis).not.toHaveBeenCalled();
  });

  it('refuses a malformed entry id', async () => {
    const response = await KEEP(
      request(keepUrl('not-an-id'), { confirm: [] }),
      params('not-an-id')
    );

    expect(response.status).toBe(400);
    expect(keep.keepSynopsis).not.toHaveBeenCalled();
  });

  it('refuses someone who is not signed in', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await KEEP(request(keepUrl(MY_DRAFT), { confirm: [] }), params(MY_DRAFT));

    expect(response.status).toBe(401);
    expect(keep.keepSynopsis).not.toHaveBeenCalled();
  });

  it('answers another person’s draft as not found, kept or edited, asked as the caller', async () => {
    // The population is real: the other person's draft keeps for them.
    signInAs(THEM);
    const theirs = await KEEP(request(keepUrl(THEIR_DRAFT), { confirm: [] }), params(THEIR_DRAFT));
    expect(theirs.status).toBe(200);

    signInAs(ME);
    const approve = await KEEP(request(keepUrl(THEIR_DRAFT), { confirm: [] }), params(THEIR_DRAFT));
    const edit = await KEEP(
      request(keepUrl(THEIR_DRAFT), { confirm: [], edit: EDIT }),
      params(THEIR_DRAFT)
    );

    expect(approve.status).toBe(404);
    expect(edit.status).toBe(404);
    expect(keep.keepSynopsis).toHaveBeenLastCalledWith(ME, THEIR_DRAFT, {
      confirm: [],
      edit: EDIT,
    });
  });

  it('never spends the sub-cap on an approve, even when it is exhausted', async () => {
    const check = vi.spyOn(synopsisCallLimiter, 'check');
    for (let i = 0; i < SYNOPSIS_CALLS_PER_MINUTE; i++) {
      synopsisCallLimiter.check(synopsisCallKey(ME));
    }
    check.mockClear();

    const response = await KEEP(request(keepUrl(MY_DRAFT), { confirm: [] }), params(MY_DRAFT));

    expect(response.status).toBe(200);
    expect(check).not.toHaveBeenCalled();
  });

  it('holds an edit to the person’s sub-cap, and answers 429 once it is spent', async () => {
    const check = vi.spyOn(synopsisCallLimiter, 'check');
    for (let i = 0; i < SYNOPSIS_CALLS_PER_MINUTE; i++) {
      const ok = await KEEP(
        request(keepUrl(MY_DRAFT), { confirm: [], edit: EDIT }),
        params(MY_DRAFT)
      );
      expect(ok.status).toBe(200);
    }

    const refused = await KEEP(
      request(keepUrl(MY_DRAFT), { confirm: [], edit: EDIT }),
      params(MY_DRAFT)
    );

    expect(refused.status).toBe(429);
    expect(check).toHaveBeenCalledWith(`journey-synopsis:${ME}`);
    expect(keep.keepSynopsis).toHaveBeenCalledTimes(SYNOPSIS_CALLS_PER_MINUTE);
  });
});

describe('POST /api/v1/app/journey-record/:id/regenerate', () => {
  it('redrafts the caller’s own draft, and never logs the steer', async () => {
    const response = await REGENERATE(
      request(regenerateUrl(MY_DRAFT), { steer: 'You missed the part about my father.' }),
      params(MY_DRAFT)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; regenerationsLeft: number } };
    expect(body.data).toMatchObject({ id: MY_DRAFT, regenerationsLeft: 2 });
    expect(regenerate.regenerateSynopsis).toHaveBeenCalledWith(
      ME,
      MY_DRAFT,
      'You missed the part about my father.'
    );
    expect(routeLog.info).toHaveBeenCalledWith(
      'Synopsis redrafted at the person’s request',
      expect.objectContaining({ steered: true })
    );
    expect(logged()).not.toContain('father');
  });

  it.each([
    ['no steer', {}],
    ['a blank steer', { steer: '   ' }],
  ])('passes no steer on for %s', async (_label, body) => {
    const response = await REGENERATE(request(regenerateUrl(MY_DRAFT), body), params(MY_DRAFT));

    expect(response.status).toBe(200);
    expect(regenerate.regenerateSynopsis).toHaveBeenCalledWith(ME, MY_DRAFT, null);
    expect(routeLog.info).toHaveBeenCalledWith(
      'Synopsis redrafted at the person’s request',
      expect.objectContaining({ steered: false })
    );
  });

  it('refuses a steer longer than the limit', async () => {
    const response = await REGENERATE(
      request(regenerateUrl(MY_DRAFT), { steer: 'x'.repeat(SYNOPSIS_STEER_MAX + 1) }),
      params(MY_DRAFT)
    );

    expect(response.status).toBe(400);
    expect(regenerate.regenerateSynopsis).not.toHaveBeenCalled();
  });

  it('refuses a malformed entry id', async () => {
    const response = await REGENERATE(request(regenerateUrl('nope'), {}), params('nope'));

    expect(response.status).toBe(400);
    expect(regenerate.regenerateSynopsis).not.toHaveBeenCalled();
  });

  it('refuses someone who is not signed in', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await REGENERATE(request(regenerateUrl(MY_DRAFT), {}), params(MY_DRAFT));

    expect(response.status).toBe(401);
    expect(regenerate.regenerateSynopsis).not.toHaveBeenCalled();
  });

  it('answers another person’s draft as not found, asked as the caller', async () => {
    signInAs(THEM);
    expect(
      (await REGENERATE(request(regenerateUrl(THEIR_DRAFT), {}), params(THEIR_DRAFT))).status
    ).toBe(200);

    signInAs(ME);
    const response = await REGENERATE(request(regenerateUrl(THEIR_DRAFT), {}), params(THEIR_DRAFT));

    expect(response.status).toBe(404);
    expect(regenerate.regenerateSynopsis).toHaveBeenLastCalledWith(ME, THEIR_DRAFT, null);
  });

  it('shares the person’s sub-cap with an edit, and answers 429 before reaching the store', async () => {
    const check = vi.spyOn(synopsisCallLimiter, 'check');
    for (let i = 0; i < SYNOPSIS_CALLS_PER_MINUTE - 1; i++) {
      await KEEP(request(keepUrl(MY_DRAFT), { confirm: [], edit: EDIT }), params(MY_DRAFT));
    }
    const last = await REGENERATE(request(regenerateUrl(MY_DRAFT), {}), params(MY_DRAFT));
    expect(last.status).toBe(200);

    const refused = await REGENERATE(request(regenerateUrl(MY_DRAFT), {}), params(MY_DRAFT));

    expect(refused.status).toBe(429);
    expect(check).toHaveBeenLastCalledWith(`journey-synopsis:${ME}`);
    expect(regenerate.regenerateSynopsis).toHaveBeenCalledTimes(1);
  });

  it('keeps one person’s spent sub-cap from refusing another', async () => {
    for (let i = 0; i < SYNOPSIS_CALLS_PER_MINUTE; i++) {
      synopsisCallLimiter.check(synopsisCallKey(THEM));
    }

    const response = await REGENERATE(request(regenerateUrl(MY_DRAFT), {}), params(MY_DRAFT));

    expect(response.status).toBe(200);
  });
});
