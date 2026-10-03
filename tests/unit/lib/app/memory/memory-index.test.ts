/**
 * The memory index: what goes in, who can find it, and what takes it out
 * (f-memory t-129).
 *
 * ## The assertions that fail when the behaviour is wrong (`fp6`)
 *
 * Per person is the property, and it is mostly an absence: my search never
 * returns your words. So every case runs over two people who both said
 * something about their father, in their own seat conversations, and asserts
 * each person's search returns their own sentence and never the other's, over a
 * population where the other's sentence is indexed and nearer in meaning.
 *
 * ## What is faked, and what proves the rest
 *
 * The module is raw SQL over three tables. The fake below answers each of its
 * five statements by shape, reading the bound values in the order the SQL binds
 * them (rebuilt with `Prisma.sql`, so nested fragments flatten as Postgres
 * would see them), and a separate case pins the SQL's own per-person predicates
 * to the subject's id, so the fake can't be kinder than the query. The
 * embedder is a deterministic bag-of-words. What only Postgres can prove (the
 * cascades, the HNSW index, the CHECKs) is `npm run smoke:app-memory-index`.
 *
 * @see lib/app/memory/memory-index.ts
 */

import { Prisma } from '@prisma/client';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ME = 'user-me';
const THEM = 'user-them';
const ORG = 'install';
const SEAT = 'facilitation';
const DIM = 1536;

interface Conversation {
  id: string;
  userId: string | null;
  contextType: string | null;
  orgId: string;
}
interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  orgId: string;
  createdAt: Date;
}
interface Embedding {
  id: string;
  userId: string;
  messageId: string;
  embedding: number[];
  embeddingModel: string;
  orgId: string;
  createdAt: Date;
}

const world = vi.hoisted(() => ({
  conversations: [] as Conversation[],
  messages: [] as Message[],
  embeddings: [] as Embedding[],
  model: 'embed-small',
  dimension: 1536,
  embedFails: false,
  sql: [] as Array<{ text: string; values: unknown[] }>,
}));

/** One slot per word: two texts are near when they share words. */
function bag(text: string, dimension = DIM): number[] {
  const vector = Array<number>(dimension).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % dimension;
    vector[h] += 1;
  }
  return vector;
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 1 : 1 - dot / Math.sqrt(na * nb);
}

function parseVector(literal: unknown): number[] {
  return String(literal).slice(1, -1).split(',').map(Number);
}

const { embedText, getActiveEmbeddingModelSummary } = vi.hoisted(() => ({
  embedText: vi.fn(),
  getActiveEmbeddingModelSummary: vi.fn(),
}));
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

function sqlOf(
  strings: TemplateStringsArray,
  values: unknown[]
): { text: string; values: unknown[] } {
  const built = Prisma.sql(strings, ...(values as Prisma.Sql[]));
  const entry = { text: built.text, values: built.values };
  world.sql.push(entry);
  return entry;
}

function conversationOf(message: Message): Conversation | undefined {
  return world.conversations.find((c) => c.id === message.conversationId);
}

function isIndexable(message: Message, min: unknown): boolean {
  return (
    message.role === 'user' &&
    conversationOf(message)?.contextType === SEAT &&
    message.content.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '').length >= Number(min)
  );
}

const prismaFake = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, values: v } = sqlOf(strings, values);
    if (text.includes('LEFT JOIN app_memory_embedding')) {
      // backfill: [orgId, seat, min, given-up ids, limit]
      const [orgId, seat, min, given, limit] = v;
      expect(seat).toBe(SEAT);
      return world.messages
        .filter((m) => m.orgId === orgId && conversationOf(m)?.userId && isIndexable(m, min))
        .filter((m) => !(given as string[]).includes(m.id))
        .filter((m) => !world.embeddings.some((e) => e.messageId === m.id))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, Number(limit))
        .map((m) => ({ id: m.id, userId: conversationOf(m)?.userId }));
    }
    if (text.includes('<=>')) {
      // search: [vec, userId, userId, orgId, model, max, vec, max, vec, limit]
      const query = parseVector(v[0]);
      const [, userE, userC, orgId, model, max] = v;
      const limit = Number(v[9]);
      return world.embeddings
        .filter((e) => e.userId === userE && e.orgId === orgId && e.embeddingModel === model)
        .map((e) => ({ e, m: world.messages.find((m) => m.id === e.messageId) }))
        .filter(({ m }) => m && conversationOf(m)?.userId === userC)
        .map(({ e, m }) => ({
          messageId: e.messageId,
          conversationId: m!.conversationId,
          content: m!.content,
          createdAt: m!.createdAt,
          distance: cosineDistance(e.embedding, query),
        }))
        .filter((row) => max === null || row.distance < Number(max))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit);
    }
    // the indexable read: [messageId, userId, seat, min]
    const [messageId, userId, , min] = v;
    return world.messages
      .filter((m) => m.id === messageId && conversationOf(m)?.userId === userId)
      .filter((m) => isIndexable(m, min))
      .map((m) => ({ content: m.content, conversationId: m.conversationId }));
  }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    // insert: [vec, model, provider, dimension, messageId, userId]
    const { values: v } = sqlOf(strings, values);
    const [vec, model, , , messageId, userId] = v;
    const message = world.messages.find((m) => m.id === messageId);
    if (!message || conversationOf(message)?.userId !== userId) return 0;
    if (world.embeddings.some((e) => e.messageId === messageId)) return 0;
    world.embeddings.push({
      id: `emb-${world.embeddings.length + 1}`,
      userId: String(userId),
      messageId: String(messageId),
      embedding: parseVector(vec),
      embeddingModel: String(model),
      orgId: message.orgId,
      createdAt: new Date(),
    });
    return 1;
  }),
  appMemoryEmbedding: {
    findFirst: vi.fn(async ({ where }: { where: { messageId: string; userId: string } }) => {
      const row = world.embeddings.find(
        (e) => e.messageId === where.messageId && e.userId === where.userId
      );
      return row ? { id: row.id } : null;
    }),
    deleteMany: vi.fn(
      async ({ where }: { where: { userId: string; messageId: { in: string[] } } }) => {
        const before = world.embeddings.length;
        world.embeddings = world.embeddings.filter(
          (e) => !(e.userId === where.userId && where.messageId.in.includes(e.messageId))
        );
        return { count: before - world.embeddings.length };
      }
    ),
    findMany: vi.fn(async ({ where }: { where: { userId?: string; orgId?: string } }) =>
      world.embeddings
        .filter((e) => (where.userId ? e.userId === where.userId : e.orgId === where.orgId))
        .map((e) => ({
          sourceKind: 'message',
          messageId: e.messageId,
          embeddingModel: e.embeddingModel,
          createdAt: e.createdAt,
        }))
    ),
  },
};

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/orchestration/knowledge/embedder', () => ({
  embedText,
  getActiveEmbeddingModelSummary,
}));
vi.mock('@/lib/logging', () => ({
  logger: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const {
  indexMessage,
  queueMessageIndex,
  backfillMemoryIndex,
  searchMemory,
  forgetMemory,
  listMemoryEntriesForSubject,
  MAX_SEARCH_RESULTS,
  MAX_BACKFILL_ATTEMPTS,
  __resetMemoryIndexForTests,
} = await import('@/lib/app/memory/memory-index');

let clock = 0;
function said(
  id: string,
  content: string,
  {
    owner = ME,
    role = 'user',
    contextType = SEAT,
  }: { owner?: string; role?: string; contextType?: string | null } = {}
): Message {
  const conversationId = `conv-${owner}-${contextType ?? 'none'}`;
  if (!world.conversations.some((c) => c.id === conversationId)) {
    world.conversations.push({ id: conversationId, userId: owner, contextType, orgId: ORG });
  }
  const message: Message = {
    id,
    conversationId,
    role,
    content,
    orgId: ORG,
    createdAt: new Date(++clock * 1000),
  };
  world.messages.push(message);
  return message;
}

const MY_FATHER = 'my father taught me to sail on the lake';
const THEIR_FATHER = 'my father and I never spoke about the lake or about sail boats';

beforeEach(() => {
  world.conversations = [];
  world.messages = [];
  world.embeddings = [];
  world.model = 'embed-small';
  world.dimension = DIM;
  world.embedFails = false;
  world.sql = [];
  clock = 0;
  vi.clearAllMocks();
  __resetMemoryIndexForTests();
  getActiveEmbeddingModelSummary.mockResolvedValue(null);
  embedText.mockReset();
  embedText.mockImplementation(async (text: string) => {
    if (world.embedFails) throw new Error('no embedding provider');
    return {
      embedding: bag(text, world.dimension),
      model: world.model,
      provider: 'fake',
      dimensions: world.dimension,
      inputTokens: 1,
      costUsd: 0,
    };
  });
});

describe('indexing a message', () => {
  it('embeds the person’s own message, costed to them and the conversation', async () => {
    const m = said('m1', MY_FATHER);
    expect(await indexMessage({ userId: ME }, m.id)).toBe('indexed');

    expect(world.embeddings).toEqual([
      expect.objectContaining({ userId: ME, messageId: 'm1', embeddingModel: 'embed-small' }),
    ]);
    expect(embedText).toHaveBeenCalledWith(MY_FATHER, 'document', {
      userId: ME,
      conversationId: m.conversationId,
      metadata: { kind: 'memory_embedding', messageId: 'm1' },
    });
  });

  it('writes nothing for someone else’s message, and leaves their own index alone', async () => {
    said('theirs', THEIR_FATHER, { owner: THEM });
    expect(await indexMessage({ userId: THEM }, 'theirs')).toBe('indexed');

    // Indexed already, but not as mine: my call neither embeds it nor claims it.
    expect(await indexMessage({ userId: ME }, 'theirs')).toBe('skipped');
    expect(world.embeddings).toHaveLength(1);
    expect(world.embeddings[0]).toMatchObject({ userId: THEM, messageId: 'theirs' });
  });

  it('skips a reply, a message outside the seats, and one too short to mean anything', async () => {
    said('reply', 'that sounds like a lovely memory of him', { role: 'assistant' });
    said('elsewhere', MY_FATHER, { contextType: 'admin_chat' });
    said('short', '  ok thanks  ');
    said('kept', MY_FATHER);

    for (const id of ['reply', 'elsewhere', 'short']) {
      expect(await indexMessage({ userId: ME }, id)).toBe('skipped');
    }
    expect(await indexMessage({ userId: ME }, 'kept')).toBe('indexed');
    expect(world.embeddings.map((e) => e.messageId)).toEqual(['kept']);
    expect(embedText).toHaveBeenCalledTimes(1);
  });

  it('tags the embedding with the turn it came from, so the turn’s cost counts it', async () => {
    said('m1', MY_FATHER);
    await indexMessage({ userId: ME }, 'm1', { turnId: 'turn-7' });
    expect(embedText).toHaveBeenCalledWith(MY_FATHER, 'document', {
      userId: ME,
      conversationId: 'conv-user-me-facilitation',
      metadata: { kind: 'memory_embedding', messageId: 'm1', turnId: 'turn-7' },
    });
  });

  it('spends nothing while the active model answers in a size the index cannot hold', async () => {
    said('m1', MY_FATHER);
    getActiveEmbeddingModelSummary.mockResolvedValue({ modelId: 'big', dimensions: 3072 });
    expect(await indexMessage({ userId: ME }, 'm1')).toBe('skipped');
    expect(embedText).not.toHaveBeenCalled();

    getActiveEmbeddingModelSummary.mockResolvedValue({ modelId: 'small', dimensions: 1536 });
    expect(await indexMessage({ userId: ME }, 'm1')).toBe('indexed');
  });

  it('does not embed a message twice', async () => {
    said('m1', MY_FATHER);
    await indexMessage({ userId: ME }, 'm1');
    expect(await indexMessage({ userId: ME }, 'm1')).toBe('already_indexed');
    expect(embedText).toHaveBeenCalledTimes(1);
    expect(world.embeddings).toHaveLength(1);
  });

  it('pays once for a vector it cannot store, then never uses that model again', async () => {
    // No active model: the platform's fallback, whose size only its answer tells.
    said('m1', MY_FATHER);
    said('m2', THEIR_FATHER);
    world.dimension = 768;
    expect(await indexMessage({ userId: ME }, 'm1')).toBe('skipped');
    expect(prismaFake.$executeRaw).not.toHaveBeenCalled();
    expect(world.embeddings).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);

    expect(await indexMessage({ userId: ME }, 'm2')).toBe('skipped');
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 0 });
    expect(embedText).toHaveBeenCalledTimes(1);

    // A different active model is asked afresh.
    world.dimension = DIM;
    getActiveEmbeddingModelSummary.mockResolvedValue({ modelId: 'small', dimensions: DIM });
    expect(await indexMessage({ userId: ME }, 'm2')).toBe('indexed');
  });

  it('never fails the turn: a queued index that throws is logged and dropped', async () => {
    said('m1', MY_FATHER);
    world.embedFails = true;
    expect(() => queueMessageIndex({ userId: ME }, 'm1')).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ messageId: 'm1' });
    expect(world.embeddings).toEqual([]);
  });
});

describe('the backfill', () => {
  it('indexes each stored message under its own conversation’s owner', async () => {
    said('mine', MY_FATHER);
    said('theirs', THEIR_FATHER, { owner: THEM });
    said('reply', 'a reply that is long enough to count', { role: 'assistant' });

    expect(await backfillMemoryIndex()).toEqual({ indexed: 2, failed: 0 });
    expect(world.embeddings.map((e) => [e.messageId, e.userId]).sort()).toEqual([
      ['mine', ME],
      ['theirs', THEM],
    ]);
    // Run again: nothing left to take.
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 0 });
  });

  it('takes exactly the messages an index call takes: one predicate, written the same in both', async () => {
    said('m1', MY_FATHER);
    await backfillMemoryIndex();
    world.sql = [];
    said('m2', MY_FATHER);
    await indexMessage({ userId: ME }, 'm2');
    const indexable = (text: string) =>
      text
        .split('\n')
        .map((line) => line.trim().replace(/\$\d+/g, '$n'))
        .filter((line) => /^AND (m\.role|c\."contextType"|LENGTH\(BTRIM)/.test(line));
    const read = world.sql.find((q) => q.text.includes('SELECT m.content'));
    const backfill = (await (async () => {
      world.sql = [];
      await backfillMemoryIndex();
      return world.sql.find((q) => q.text.includes('LEFT JOIN app_memory_embedding'));
    })())!;
    expect(indexable(read!.text)).toHaveLength(3);
    expect(indexable(backfill.text)).toEqual(indexable(read!.text));
  });

  it('gives up on a message the embedder never takes, once others prove it is the message', async () => {
    said('oldest', 'I started a new job in the city this spring');
    said('older', MY_FATHER);
    said('poison', THEIR_FATHER);
    embedText.mockImplementation(async (text: string) => {
      if (text === THEIR_FATHER) throw new Error('maximum context length exceeded');
      return {
        embedding: bag(text),
        model: world.model,
        provider: 'fake',
        dimensions: DIM,
        inputTokens: 1,
        costUsd: 0,
      };
    });

    // It never holds the others back: the run tries past it.
    expect(await backfillMemoryIndex()).toEqual({ indexed: 2, failed: 1 });
    expect(world.embeddings.map((e) => e.messageId).sort()).toEqual(['older', 'oldest']);

    // Each later run fails on it alone, which proves nothing about it: no blame.
    embedText.mockClear();
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 1 });
    expect(embedText).toHaveBeenCalledTimes(1);

    // Blamed only when a message after it in the run embeds (an older one, the
    // run being newest first); given up on at the limit.
    for (let run = 2; run <= MAX_BACKFILL_ATTEMPTS; run++) {
      said(`older-${run}`, `a different thing said long ago, number ${run}`).createdAt = new Date(
        run
      );
      expect(await backfillMemoryIndex()).toEqual({ indexed: 1, failed: 1 });
    }
    embedText.mockClear();
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 0 });
    expect(embedText).not.toHaveBeenCalled();
  });

  it('blames no message for an outage, however long, and takes them all once it ends', async () => {
    said('a', MY_FATHER);
    said('b', THEIR_FATHER);
    said('c', 'I started a new job in the city this spring');
    world.embedFails = true;
    for (let run = 0; run < MAX_BACKFILL_ATTEMPTS * 3; run++) {
      expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 2 });
    }
    world.embedFails = false;
    expect(await backfillMemoryIndex()).toEqual({ indexed: 3, failed: 0 });
  });

  it('does nothing, and spends nothing, while the model is the wrong size', async () => {
    said('m1', MY_FATHER);
    getActiveEmbeddingModelSummary.mockResolvedValue({ modelId: 'big', dimensions: 3072 });
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 0 });
    expect(embedText).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stops at the second failure in a row rather than failing the whole batch the same way', async () => {
    said('a', MY_FATHER);
    said('b', THEIR_FATHER);
    said('c', 'I started a new job in the city this spring');
    world.embedFails = true;
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 2 });
    expect(embedText).toHaveBeenCalledTimes(2);
  });
});

describe('searching', () => {
  beforeEach(async () => {
    said('mine', MY_FATHER);
    said('mine-other', 'I started a new job in the city this spring');
    said('theirs', THEIR_FATHER, { owner: THEM });
    await backfillMemoryIndex();
    expect(world.embeddings).toHaveLength(3);
  });

  it('returns the person’s own words, nearest first, and never someone else’s', async () => {
    const hits = await searchMemory({ userId: ME }, 'father lake sail boats spoke', { limit: 5 });
    expect(hits.map((hit) => hit.sourceId)).toEqual(['mine', 'mine-other']);
    expect(hits[0]).toMatchObject({ sourceKind: 'message', text: MY_FATHER });

    // Theirs is the nearer match for this query, and it is still not mine to see.
    const theirs = await searchMemory({ userId: THEM }, 'father lake sail boats spoke', {
      limit: 5,
    });
    expect(theirs.map((hit) => hit.sourceId)).toEqual(['theirs']);
  });

  it('binds the person to both the index row and the conversation in the SQL itself', async () => {
    world.sql = [];
    await searchMemory({ userId: ME }, 'father', { limit: 5 });
    const search = world.sql.find((q) => q.text.includes('<=>'));
    expect(search?.text).toMatch(/e\."userId" = \$2/);
    expect(search?.text).toMatch(/c\."userId" = \$3/);
    expect(search?.values.slice(1, 3)).toEqual([ME, ME]);
  });

  it('compares only vectors made by the model that embedded the query', async () => {
    world.model = 'embed-large';
    expect(await searchMemory({ userId: ME }, 'father lake', { limit: 5 })).toEqual([]);
  });

  it('caps the limit, honours a distance cut-off, and costs the query to the person', async () => {
    const capped = await searchMemory({ userId: ME }, 'father', { limit: 500 });
    expect(world.sql.at(-1)?.values.at(-1)).toBe(MAX_SEARCH_RESULTS);
    expect(capped.length).toBeLessThanOrEqual(MAX_SEARCH_RESULTS);

    const near = await searchMemory({ userId: ME }, MY_FATHER, { limit: 5, maxDistance: 0.5 });
    expect(near.map((hit) => hit.sourceId)).toEqual(['mine']);

    expect(embedText).toHaveBeenLastCalledWith(MY_FATHER, 'query', {
      userId: ME,
      metadata: { kind: 'memory_search' },
    });
  });

  it('answers a blank query with nothing, and spends nothing on it', async () => {
    embedText.mockClear();
    expect(await searchMemory({ userId: ME }, '   ', { limit: 5 })).toEqual([]);
    expect(embedText).not.toHaveBeenCalled();
  });
});

describe('forgetting', () => {
  it('removes only the person’s vectors for those messages', async () => {
    said('mine', MY_FATHER);
    said('mine-kept', 'I started a new job in the city this spring');
    said('theirs', THEIR_FATHER, { owner: THEM });
    await backfillMemoryIndex();

    // Their id in my request removes nothing of theirs.
    expect(await forgetMemory({ userId: ME }, { messageIds: ['mine', 'theirs'] })).toBe(1);
    expect(world.embeddings.map((e) => e.messageId).sort()).toEqual(['mine-kept', 'theirs']);
    expect(await searchMemory({ userId: ME }, MY_FATHER, { limit: 5 })).not.toContainEqual(
      expect.objectContaining({ sourceId: 'mine' })
    );
  });

  it('does nothing for an empty list', async () => {
    expect(await forgetMemory({ userId: ME }, { messageIds: [] })).toBe(0);
    expect(prismaFake.appMemoryEmbedding.deleteMany).not.toHaveBeenCalled();
  });
});

describe('the subject-access list', () => {
  it('lists the person’s own entries, never the vector', async () => {
    said('mine', MY_FATHER);
    said('theirs', THEIR_FATHER, { owner: THEM });
    await backfillMemoryIndex();

    const entries = await listMemoryEntriesForSubject({ userId: ME });
    expect(entries).toEqual([
      expect.objectContaining({ sourceKind: 'message', messageId: 'mine' }),
    ]);
    expect(entries[0]).not.toHaveProperty('embedding');
  });
});
