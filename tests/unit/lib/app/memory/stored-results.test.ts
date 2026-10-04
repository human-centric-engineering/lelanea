/**
 * Clearing what a memory search left in the conversation (t-130): every stored
 * `search_person_memory` result in the person's own conversations is
 * overwritten, the row kept so its call still has an answer, and nobody
 * else's conversation is touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { clearStoredSearchResults, CLEARED_SEARCH_RESULT } =
  await import('@/lib/app/memory/stored-results');

interface Row {
  id: string;
  ownerId: string;
  role: string;
  capabilitySlug: string | null;
  content: string;
  metadata: unknown;
}

let rows: Row[] = [];

const tx = {
  aiMessage: {
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: {
          role: string;
          capabilitySlug: string;
          conversation: { userId: string };
          NOT: { content: string };
        };
        data: { content: string; metadata: unknown };
      }) => {
        const hit = rows.filter(
          (row) =>
            row.role === where.role &&
            row.capabilitySlug === where.capabilitySlug &&
            row.ownerId === where.conversation.userId &&
            row.content !== where.NOT.content
        );
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      }
    ),
  },
};

const FOUND = JSON.stringify({
  success: true,
  data: { results: [{ words: 'my father taught me to sail' }] },
});

beforeEach(() => {
  rows = [
    {
      id: 'mine',
      ownerId: 'me',
      role: 'tool',
      capabilitySlug: 'search_person_memory',
      content: FOUND,
      metadata: { result: FOUND },
    },
    {
      id: 'mine-other-tool',
      ownerId: 'me',
      role: 'tool',
      capabilitySlug: 'search_knowledge_base',
      content: 'kb',
      metadata: { result: 'kb' },
    },
    {
      id: 'mine-said',
      ownerId: 'me',
      role: 'user',
      capabilitySlug: null,
      content: 'my father taught me to sail',
      metadata: null,
    },
    {
      id: 'theirs',
      ownerId: 'them',
      role: 'tool',
      capabilitySlug: 'search_person_memory',
      content: FOUND,
      metadata: { result: FOUND },
    },
  ];
});

describe('clearStoredSearchResults', () => {
  it('clears the person’s stored search results, and nothing else of theirs or anyone’s', async () => {
    expect(await clearStoredSearchResults(tx as never, { userId: 'me' })).toBe(1);

    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.mine).toMatchObject({ content: CLEARED_SEARCH_RESULT, metadata: {} });
    expect(JSON.stringify(byId.mine)).not.toContain('sail');
    expect(byId['mine-other-tool'].content).toBe('kb');
    expect(byId['mine-said'].content).toBe('my father taught me to sail');
    expect(byId.theirs.content).toBe(FOUND);
  });

  it('keeps the row, so the call that made it still has an answer, and changes nothing twice', async () => {
    await clearStoredSearchResults(tx as never, { userId: 'me' });
    expect(rows.map((row) => row.id)).toContain('mine');

    expect(await clearStoredSearchResults(tx as never, { userId: 'me' })).toBe(0);
  });

  it('tells the model what happened, and that nothing is to be repeated', () => {
    expect(JSON.parse(CLEARED_SEARCH_RESULT)).toMatchObject({
      success: true,
      data: { results: [] },
      cleared: expect.stringMatching(/never repeat/),
    });
  });
});
