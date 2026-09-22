/**
 * Parity: `/api/v1/app/content/discovery-questions` returns exactly the record
 * the question service serves (f-content-seeds t-87).
 *
 * No web page renders the questions yet: the API is the whole surface, and any
 * page built later calls `getDiscoveryQuestions()` directly, as the journey's
 * and the documents' pages call theirs. So parity here is between the route and
 * that service: the same record, with the set's `version`, a `revision` on the
 * set and on every question, and an ETag over exactly that record, all moving
 * together when a row changes.
 *
 * @see app/api/v1/app/content/discovery-questions/route.ts
 * @see lib/app/content/question-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/content/question-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeQuestionStore()
);

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/app/content/discovery-questions/route';
import { auth } from '@/lib/auth/config';
import { computeETag } from '@/lib/api/etag';
import { getDiscoveryQuestions } from '@/lib/app/content/question-store';
import type { DiscoveryQuestionSet } from '@/lib/app/content/question-view';
import { mockAuthenticatedUser } from '@/tests/helpers/auth';
import { fakeQuestionStore } from '@/tests/helpers/app/content-stores';

const store = fakeQuestionStore();

beforeEach(() => {
  store.reset();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

async function fromApi() {
  const response = await GET(
    new NextRequest('https://lelanea.com/api/v1/app/content/discovery-questions')
  );
  const body = (await response.json()) as { data: DiscoveryQuestionSet };
  return { etag: response.headers.get('ETag'), set: body.data };
}

async function fromService(): Promise<DiscoveryQuestionSet> {
  return JSON.parse(JSON.stringify(await getDiscoveryQuestions())) as DiscoveryQuestionSet;
}

describe('API and service parity, the discovery questions', () => {
  it('the API returns exactly the record the service serves', async () => {
    const api = await fromApi();

    expect(api.set).toEqual(await fromService());
    expect(api.set.questions.map((q) => q.number)).toEqual([...Array(30).keys()].map((n) => n + 1));
  });

  it('with its version, a revision on the set and every question, and an ETag over exactly that record', async () => {
    const api = await fromApi();

    expect(api.set.collection).toMatchObject({ version: '1.0', revision: 1 });
    expect(api.set.questions.every((q) => q.revision === 1)).toBe(true);
    expect(api.etag).toBe(computeETag(await getDiscoveryQuestions()));
  });

  it('moves together when a row changes: new record, new ETag', async () => {
    const before = await fromApi();

    store.editQuestion('q07', { text: 'An edited seventh question.' });

    const after = await fromApi();
    expect(after.etag).not.toBe(before.etag);
    expect(after.set).toEqual(await fromService());
    expect(after.set.questions[6]).toMatchObject({
      id: 'q07',
      text: 'An edited seventh question.',
      revision: 2,
    });
  });
});
