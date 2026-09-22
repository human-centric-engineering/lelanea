/**
 * The question store's read (f-content-seeds t-87): the discovery questions
 * from `app_question_set` and `app_discovery_question`.
 *
 * Prisma is a stub returning the rows the real seed builds. The write path is
 * covered through the real seed unit in
 * `tests/unit/prisma/seeds/app-lelanea/content-collections.test.ts`.
 *
 * @see lib/app/content/question-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setFindUnique } = vi.hoisted(() => ({ setFindUnique: vi.fn() }));

vi.mock('@/lib/db/client', () => ({
  prisma: { appQuestionSet: { findUnique: setFindUnique } },
}));

import { ContentNotSeededError } from '@/lib/app/content/document-view';
import { DISCOVERY_QUESTION_SET_ID, getDiscoveryQuestions } from '@/lib/app/content/question-store';
import { seededQuestionRows } from '@/tests/helpers/app/content-stores';

let rows: ReturnType<typeof seededQuestionRows>;

beforeEach(() => {
  vi.clearAllMocks();
  rows = seededQuestionRows();
  setFindUnique.mockResolvedValue({ ...rows.set, questions: rows.questions });
});

describe('getDiscoveryQuestions', () => {
  it('reads the one set by id, with its questions in number order', async () => {
    const set = await getDiscoveryQuestions();

    expect(setFindUnique).toHaveBeenCalledWith({
      where: { id: DISCOVERY_QUESTION_SET_ID },
      include: { questions: { orderBy: { number: 'asc' } } },
    });
    expect(set.questions).toHaveLength(30);
    expect(set.collection).toMatchObject({ module: 'module_00_onboarding', phase: 8, revision: 1 });
  });

  it('serves what the ROW says, not what the file says', async () => {
    setFindUnique.mockResolvedValue({
      ...rows.set,
      preamble: { style: 'italic', text: 'An edited preamble.' },
      revision: 2,
      questions: rows.questions.map((q) =>
        q.id === 'q05' ? { ...q, text: 'An edited fifth question.', hint: null, revision: 4 } : q
      ),
    });

    const set = await getDiscoveryQuestions();

    expect(set.preamble.text).toBe('An edited preamble.');
    expect(set.collection.revision).toBe(2);
    expect(set.questions[4]).toEqual({
      id: 'q05',
      number: 5,
      text: 'An edited fifth question.',
      inputType: 'long_text',
      revision: 4,
    });
  });

  it('throws ContentNotSeededError on an unseeded database rather than serving nothing', async () => {
    setFindUnique.mockResolvedValue(null);

    await expect(getDiscoveryQuestions()).rejects.toBeInstanceOf(ContentNotSeededError);
    await expect(getDiscoveryQuestions()).rejects.toThrow(/017-discovery-questions/);
  });

  it('throws on a stored input type outside the vocabulary', async () => {
    setFindUnique.mockResolvedValue({
      ...rows.set,
      questions: rows.questions.map((q) => (q.id === 'q01' ? { ...q, inputType: 'checkbox' } : q)),
    });

    await expect(getDiscoveryQuestions()).rejects.toThrow(/"q01" failed validation/);
  });
});
