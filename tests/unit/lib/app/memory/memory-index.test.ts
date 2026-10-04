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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';
import { redactedString } from '@/lib/security/redact';

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
interface SlotValueRow {
  id: string;
  userId: string;
  slotSlug: string;
  version: number;
  value: string;
  reasoningNote: string;
  sourceType: string;
  supersededAt: Date | null;
  capturedAt: Date;
  orgId: string;
}
interface Definition {
  slug: string;
  visibility: string;
  sensitivity: string;
}
interface Embedding {
  id: string;
  userId: string;
  messageId: string | null;
  slotValueId: string | null;
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
  turns: [] as Array<{ userId: string; turnId: string; userMessageId: string | null }>,
  slotValues: [] as SlotValueRow[],
  /** Daybreak's definitions and ours: the fake reads their union, as the SQL does. */
  frameworkDefinitions: [] as Definition[],
  appDefinitions: [] as Definition[],
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

const REMOVED = 'removed_by_person';
/** What `fill_slot` stores for a special-category capture: the words never land. */
const MASKED = redactedString('special_category');

/** `noteQualifies()`, in JS: the live, visible head of a note with something in it. */
function noteQualifies(v: SlotValueRow): boolean {
  const flagged = (d: Definition) =>
    d.slug === v.slotSlug && (d.visibility === 'hidden' || d.sensitivity === 'special_category');
  return (
    v.supersededAt === null &&
    v.sourceType !== REMOVED &&
    v.value !== MASKED &&
    v.value.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '').length >= 12 &&
    !world.frameworkDefinitions.some(flagged) &&
    !world.appDefinitions.some(flagged)
  );
}

/** What `unsearchableSlugs()` asks either tier for: hidden, or special-category. */
function flaggedDefinition(d: Definition): boolean {
  return d.visibility === 'hidden' || d.sensitivity === 'special_category';
}

function slotValue(id: string): SlotValueRow | undefined {
  return world.slotValues.find((v) => v.id === id);
}

/** Drop note vectors matching `drop`, returning how many went. */
function dropNoteVectors(drop: (e: Embedding, v: SlotValueRow) => boolean): number {
  const before = world.embeddings.length;
  world.embeddings = world.embeddings.filter((e) => {
    const v = e.slotValueId ? slotValue(e.slotValueId) : undefined;
    return !(v && drop(e, v));
  });
  return before - world.embeddings.length;
}

const prismaFake = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, values: v } = sqlOf(strings, values);
    if (text.includes('e."slotValueId" = v.id') && text.includes('LEFT JOIN')) {
      // note backfill: [orgId, ...qualifies(4), given-up ids, limit]
      const [orgId] = v;
      const given = v.at(-2) as string[];
      const limit = Number(v.at(-1));
      return world.slotValues
        .filter((row) => row.orgId === orgId && noteQualifies(row))
        .filter((row) => !given.includes(row.id))
        .filter((row) => !world.embeddings.some((e) => e.slotValueId === row.id))
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
        .slice(0, limit)
        .map((row) => ({ id: row.id, userId: row.userId, slotSlug: row.slotSlug }));
    }
    if (text.includes('JOIN framework_slot_value v ON v.id = e."slotValueId"')) {
      // note search: [vec, userId, userId, orgId, model, ...qualifies(4), max, vec, max, vec, limit]
      const query = parseVector(v[0]);
      const [, userE, userV, orgId, model] = v;
      const max = v[9];
      const limit = Number(v.at(-1));
      return world.embeddings
        .filter((e) => e.userId === userE && e.orgId === orgId && e.embeddingModel === model)
        .map((e) => ({ e, row: e.slotValueId ? slotValue(e.slotValueId) : undefined }))
        .filter(({ row }) => row && row.userId === userV && noteQualifies(row))
        .map(({ e, row }) => ({
          slotValueId: row!.id,
          slotSlug: row!.slotSlug,
          value: row!.value,
          capturedAt: row!.capturedAt,
          distance: cosineDistance(e.embedding, query),
        }))
        .filter((r) => max === null || r.distance < Number(max))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit);
    }
    if (text.includes('SELECT v.id, v.value')) {
      // note head: [userId, slotSlug, ...qualifies(4)]
      const [userId, slotSlug] = v;
      return world.slotValues
        .filter((row) => row.userId === userId && row.slotSlug === slotSlug && noteQualifies(row))
        .map((row) => ({ id: row.id, value: row.value }));
    }
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
      // search: [vec, userId, userId, orgId, model, max, vec, max, excluded, vec, limit]
      const query = parseVector(v[0]);
      const [, userE, userC, orgId, model, max] = v;
      const excluded = v[8] as string[];
      const limit = Number(v[10]);
      return world.embeddings
        .filter((e) => e.userId === userE && e.orgId === orgId && e.embeddingModel === model)
        .map((e) => ({ e, m: world.messages.find((m) => m.id === e.messageId) }))
        .filter(({ m }) => m && conversationOf(m)?.userId === userC)
        .filter(({ e }) => e.messageId !== null && !excluded.includes(e.messageId))
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
    const { text, values: v } = sqlOf(strings, values);
    if (text.includes('INSERT') && text.includes('"slotValueId"')) {
      // note insert: [vec, model, provider, dimension, slotValueId, userId, ...qualifies(4)]
      const [vec, model, , , slotValueId, userId] = v;
      const row = slotValue(String(slotValueId));
      if (!row || row.userId !== userId || !noteQualifies(row)) return 0;
      if (world.embeddings.some((e) => e.slotValueId === row.id)) return 0;
      world.embeddings.push({
        id: `emb-${world.embeddings.length + 1}`,
        userId: row.userId,
        messageId: null,
        slotValueId: row.id,
        embedding: parseVector(vec),
        embeddingModel: String(model),
        orgId: row.orgId,
        createdAt: new Date(),
      });
      return 1;
    }
    if (text.includes('NOT (')) {
      // prune: [orgId, ...qualifies(4)]
      return dropNoteVectors((e, row) => e.orgId === v[0] && !noteQualifies(row));
    }
    if (text.includes('v."sourceType" =')) {
      // forgetWipedNotes: [userId, userId, removed]
      const [userE, userV, removed] = v;
      return dropNoteVectors(
        (e, row) => e.userId === userE && row.userId === userV && row.sourceType === removed
      );
    }
    if (text.includes('DELETE FROM app_memory_embedding')) {
      // superseded versions: [userId, userId, slotSlug]
      expect(text).toContain('v."supersededAt" IS NOT NULL');
      const [userE, userV, slug] = v;
      return dropNoteVectors(
        (e, row) =>
          e.userId === userE &&
          row.userId === userV &&
          row.slotSlug === slug &&
          row.supersededAt !== null
      );
    }
    // message insert: [vec, model, provider, dimension, messageId, userId]
    const [vec, model, , , messageId, userId] = v;
    const message = world.messages.find((m) => m.id === messageId);
    if (!message || conversationOf(message)?.userId !== userId) return 0;
    if (world.embeddings.some((e) => e.messageId === messageId)) return 0;
    world.embeddings.push({
      id: `emb-${world.embeddings.length + 1}`,
      userId: String(userId),
      messageId: String(messageId),
      slotValueId: null,
      embedding: parseVector(vec),
      embeddingModel: String(model),
      orgId: message.orgId,
      createdAt: new Date(),
    });
    return 1;
  }),
  slotDefinition: {
    findMany: vi.fn(async () => world.frameworkDefinitions.filter(flaggedDefinition)),
  },
  appSlotDefinition: {
    findMany: vi.fn(async () => world.appDefinitions.filter(flaggedDefinition)),
  },
  appTurn: {
    findUnique: vi.fn(
      async ({ where }: { where: { userId_turnId: { userId: string; turnId: string } } }) =>
        world.turns.find(
          (t) => t.userId === where.userId_turnId.userId && t.turnId === where.userId_turnId.turnId
        ) ?? null
    ),
  },
  appMemoryEmbedding: {
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: { messageId?: string; slotValueId?: string; userId: string };
      }) => {
        const row = world.embeddings.find(
          (e) =>
            e.userId === where.userId &&
            (where.messageId !== undefined
              ? e.messageId === where.messageId
              : e.slotValueId === where.slotValueId)
        );
        return row ? { id: row.id } : null;
      }
    ),
    deleteMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          userId: string;
          OR: [{ messageId: { in: string[] } }, { slotValueId: { in: string[] } }];
        };
      }) => {
        const [messages, notes] = where.OR;
        const before = world.embeddings.length;
        world.embeddings = world.embeddings.filter(
          (e) =>
            !(
              e.userId === where.userId &&
              ((e.messageId !== null && messages.messageId.in.includes(e.messageId)) ||
                (e.slotValueId !== null && notes.slotValueId.in.includes(e.slotValueId)))
            )
        );
        return { count: before - world.embeddings.length };
      }
    ),
    findMany: vi.fn(async ({ where }: { where: { userId?: string; orgId?: string } }) =>
      world.embeddings
        .filter((e) => (where.userId ? e.userId === where.userId : e.orgId === where.orgId))
        .map((e) => ({
          sourceKind: e.messageId !== null ? 'message' : 'note',
          messageId: e.messageId,
          slotValueId: e.slotValueId,
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
  indexNote,
  queueNoteIndex,
  forgetWipedNotes,
  queueMessageIndex,
  backfillMemoryIndex,
  searchMemory,
  forgetMemory,
  listMemoryEntriesForSubject,
  MAX_SEARCH_RESULTS,
  MAX_BACKFILL_ATTEMPTS,
  __resetMemoryIndexForTests,
} = await import('@/lib/app/memory/memory-index');
const { SearchPersonMemoryCapability, spokenDate } =
  await import('@/lib/app/memory/search-capability');

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

/**
 * Append a version of a note, as Daybreak's `appendSlotValue` does: the
 * previous head is stamped superseded and stays.
 */
function noted(
  slotSlug: string,
  value: string,
  {
    owner = ME,
    reasoningNote = 'They said so plainly.',
  }: { owner?: string; reasoningNote?: string } = {}
): SlotValueRow {
  const chain = world.slotValues.filter((v) => v.userId === owner && v.slotSlug === slotSlug);
  const at = new Date(++clock * 1000);
  for (const previous of chain) previous.supersededAt ??= at;
  const row: SlotValueRow = {
    id: `sv-${owner}-${slotSlug}-${chain.length + 1}`,
    userId: owner,
    slotSlug,
    version: chain.length + 1,
    value,
    reasoningNote,
    sourceType: 'direct',
    supersededAt: null,
    capturedAt: at,
    orgId: ORG,
  };
  world.slotValues.push(row);
  return row;
}

/** Wipe a version in place, as `wipe.ts` does: the row stays, its words go. */
function wipe(row: SlotValueRow): void {
  row.value = 'This note was removed.';
  row.reasoningNote = 'The person removed this note in Lelañea’s notes.';
  row.sourceType = REMOVED;
}

function vectorsOf(owner: string): string[] {
  return world.embeddings
    .filter((e) => e.userId === owner)
    .map((e) => e.slotValueId ?? e.messageId ?? '')
    .sort();
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
  world.turns = [];
  world.slotValues = [];
  world.frameworkDefinitions = [];
  world.appDefinitions = [];
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
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 0, forgotten: 0 });
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

    expect(await backfillMemoryIndex()).toEqual({ indexed: 2, failed: 0, forgotten: 0 });
    expect(world.embeddings.map((e) => [e.messageId, e.userId]).sort()).toEqual([
      ['mine', ME],
      ['theirs', THEM],
    ]);
    // Run again: nothing left to take.
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 0, forgotten: 0 });
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
    expect(await backfillMemoryIndex()).toEqual({ indexed: 2, failed: 1, forgotten: 0 });
    expect(world.embeddings.map((e) => e.messageId).sort()).toEqual(['older', 'oldest']);

    // Each later run fails on it alone, which proves nothing about it: no blame.
    embedText.mockClear();
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 1, forgotten: 0 });
    expect(embedText).toHaveBeenCalledTimes(1);

    // Blamed only when a message after it in the run embeds (an older one, the
    // run being newest first); given up on at the limit.
    for (let run = 2; run <= MAX_BACKFILL_ATTEMPTS; run++) {
      said(`older-${run}`, `a different thing said long ago, number ${run}`).createdAt = new Date(
        run
      );
      expect(await backfillMemoryIndex()).toEqual({ indexed: 1, failed: 1, forgotten: 0 });
    }
    embedText.mockClear();
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 0, forgotten: 0 });
    expect(embedText).not.toHaveBeenCalled();
  });

  it('blames no message for an outage, however long, and takes them all once it ends', async () => {
    said('a', MY_FATHER);
    said('b', THEIR_FATHER);
    said('c', 'I started a new job in the city this spring');
    world.embedFails = true;
    for (let run = 0; run < MAX_BACKFILL_ATTEMPTS * 3; run++) {
      expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 2, forgotten: 0 });
    }
    world.embedFails = false;
    expect(await backfillMemoryIndex()).toEqual({ indexed: 3, failed: 0, forgotten: 0 });
  });

  it('does nothing, and spends nothing, while the model is the wrong size', async () => {
    said('m1', MY_FATHER);
    getActiveEmbeddingModelSummary.mockResolvedValue({ modelId: 'big', dimensions: 3072 });
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 0, forgotten: 0 });
    expect(embedText).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stops at the second failure in a row rather than failing the whole batch the same way', async () => {
    said('a', MY_FATHER);
    said('b', THEIR_FATHER);
    said('c', 'I started a new job in the city this spring');
    world.embedFails = true;
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 2, forgotten: 0 });
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

  it('leaves out the messages it is told to, and charges the query where it is told to', async () => {
    const hits = await searchMemory({ userId: ME }, 'father lake sail', {
      limit: 5,
      excludeMessageIds: ['mine'],
      attribution: { agentId: 'agent-1', conversationId: 'conv-x', metadata: { turnId: 't-9' } },
    });
    expect(hits.map((hit) => hit.sourceId)).toEqual(['mine-other']);
    expect(embedText).toHaveBeenLastCalledWith('father lake sail', 'query', {
      userId: ME,
      agentId: 'agent-1',
      conversationId: 'conv-x',
      metadata: { turnId: 't-9', kind: 'memory_search' },
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

describe('the AI’s search tool (t-130)', () => {
  const tool = new SearchPersonMemoryCapability();
  const onSeat = (
    userId: string | null,
    seat = 'facilitator',
    turnId = 'turn-1'
  ): CapabilityContext => ({
    userId,
    agentId: 'agent-guide',
    conversationId: `conv-${userId}-${SEAT}`,
    costLogMetadata: { turnId, seat },
  });

  beforeEach(async () => {
    said('mine', MY_FATHER);
    said('mine-job', 'I started a new job in the city this spring');
    said('theirs', THEIR_FATHER, { owner: THEM });
    await backfillMemoryIndex();
    expect(world.embeddings).toHaveLength(3);
  });

  it('finds the caller’s own words and never another person’s, even when theirs is nearer', async () => {
    // The query is THEIR sentence, word for word: the nearest vector in the
    // index is theirs, at distance zero, and it is still not mine to see.
    const result = await tool.execute({ query: THEIR_FATHER }, onSeat(ME));

    expect(result.success).toBe(true);
    expect(result.data?.results.map((item) => item.words)).toEqual([MY_FATHER]);
    expect(JSON.stringify(result.data)).not.toContain(THEIR_FATHER);

    const theirs = await tool.execute({ query: MY_FATHER }, onSeat(THEM));
    expect(theirs.data?.results.map((item) => item.words)).toEqual([THEIR_FATHER]);
  });

  it('searches the caller only: the person comes from the run, never the arguments', () => {
    expect(Object.keys(tool.functionDefinition.parameters.properties as object)).toEqual(['query']);
    // An extra key a model might add is dropped by the schema, not obeyed.
    const parsed = tool.validate({ query: 'father', userId: THEM });
    expect(parsed).toEqual({ query: 'father' });
  });

  it('labels each result as the person’s own words, with when they said them', async () => {
    const result = await tool.execute({ query: MY_FATHER }, onSeat(ME));
    const [item] = result.data?.results ?? [];
    const saidOn = world.messages.find((m) => m.id === 'mine')!.createdAt;

    expect(item.when).toBe(spokenDate(saidOn));
    expect(item.when).toBe('1 January 1970');
    expect(item.whose).toBe(
      'The person’s own words, said by them on 1 January 1970. Quote them only as theirs.'
    );
  });

  it('does not hand back the message the turn is answering', async () => {
    world.turns.push({ userId: ME, turnId: 'turn-now', userMessageId: 'mine' });
    const result = await tool.execute({ query: MY_FATHER }, onSeat(ME, 'facilitator', 'turn-now'));

    expect(result.data?.results.map((item) => item.words)).not.toContain(MY_FATHER);
  });

  it('charges the query to the person, the agent, the conversation and the turn', async () => {
    embedText.mockClear();
    await tool.execute({ query: 'father' }, onSeat(ME));

    expect(embedText).toHaveBeenCalledWith('father', 'query', {
      userId: ME,
      agentId: 'agent-guide',
      conversationId: `conv-${ME}-${SEAT}`,
      metadata: { turnId: 'turn-1', seat: 'facilitator', kind: 'memory_search' },
    });
  });

  it.each([
    ['the onboarding seat', onSeat(ME, 'onboarding'), 'wrong_seat'],
    ['no turn at all', { userId: ME, agentId: 'agent-guide' }, 'wrong_seat'],
    ['no person', onSeat(null), 'no_person'],
  ] as const)('refuses from %s, and searches nothing', async (_case, context, code) => {
    embedText.mockClear();
    const result = await tool.execute({ query: 'father' }, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(code);
    expect(embedText).not.toHaveBeenCalled();
  });

  it('answers, rather than throwing, when the search fails', async () => {
    world.embedFails = true;
    const result = await tool.execute({ query: 'father' }, onSeat(ME));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('search_failed');
    expect(result.error?.message).toMatch(/do not claim to remember/);
  });

  it('searches without excluding anything when the seat stamp carries no turn or conversation', async () => {
    embedText.mockClear();
    const result = await tool.execute(
      { query: MY_FATHER },
      { userId: ME, agentId: 'agent-guide', costLogMetadata: { seat: 'facilitator' } }
    );

    expect(result.data?.results.map((item) => item.words)).toContain(MY_FATHER);
    expect(embedText).toHaveBeenCalledWith(MY_FATHER, 'query', {
      userId: ME,
      agentId: 'agent-guide',
      metadata: { seat: 'facilitator', kind: 'memory_search' },
    });
  });

  it('keeps only the error code of a failed search on the audit row', () => {
    const failed = tool.redactProvenance(
      { query: MY_FATHER },
      { success: false, error: { code: 'search_failed', message: 'down' } }
    );
    expect(failed).toEqual({
      args: { query: '[redacted]' },
      resultPreview: '{"success":false,"error":"search_failed"}',
    });
    expect(tool.redactProvenance({ query: 'x' }, { success: true }).resultPreview).toBe(
      '{"success":true,"found":0}'
    );
    expect(tool.redactProvenance({ query: 'x' }, { success: false }).resultPreview).toBe(
      '{"success":false,"error":"unknown"}'
    );
  });

  it('keeps neither the query nor the words on the audit row', async () => {
    const result = await tool.execute({ query: MY_FATHER }, onSeat(ME));
    const redacted = tool.redactProvenance({ query: MY_FATHER }, result);

    expect(redacted.args).toEqual({ query: '[redacted]' });
    expect(redacted.resultPreview).toBe('{"success":true,"found":1}');
    expect(JSON.stringify(redacted)).not.toContain('father');
  });
});

describe('indexing a note (t-107)', () => {
  const FATHER_NOTE = 'Their father taught them to sail; he has been unwell since spring';
  const WORK_NOTE = 'Started a demanding new job at the hospital this year';

  it('embeds the head’s value, costed to the person, and never its reasoning note', async () => {
    const note = noted('family', FATHER_NOTE, { reasoningNote: 'SECRET REASONING about him' });

    expect(await indexNote({ userId: ME }, 'family', { turnId: 'turn-3' })).toBe('indexed');
    expect(world.embeddings).toEqual([
      expect.objectContaining({ userId: ME, slotValueId: note.id, messageId: null }),
    ]);
    expect(embedText).toHaveBeenCalledWith(FATHER_NOTE, 'document', {
      userId: ME,
      metadata: { kind: 'memory_embedding', slotValueId: note.id, turnId: 'turn-3' },
    });
    expect(JSON.stringify(embedText.mock.calls)).not.toContain('SECRET REASONING');
  });

  it('replaces the old version’s vector when the note is revised, and leaves a sibling’s', async () => {
    const first = noted('family', FATHER_NOTE);
    const sibling = noted('work', WORK_NOTE);
    await indexNote({ userId: ME }, 'family');
    await indexNote({ userId: ME }, 'work');
    expect(vectorsOf(ME)).toEqual([first.id, sibling.id].sort());

    const revised = noted('family', 'Their father is home again and recovering well now');
    expect(await indexNote({ userId: ME }, 'family')).toBe('indexed');

    expect(vectorsOf(ME)).toEqual([revised.id, sibling.id].sort());
  });

  it('keeps the newer version’s vector when a revision lands while an earlier index is embedding', async () => {
    noted('family', FATHER_NOTE);
    // Call A reads v1 as the head, then waits on a slow embedder.
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    embedText.mockImplementationOnce(async (text: string) => {
      await slow;
      return {
        embedding: bag(text),
        model: world.model,
        provider: 'fake',
        dimensions: DIM,
        inputTokens: 1,
        costUsd: 0,
      };
    });
    const a = indexNote({ userId: ME }, 'family');
    await vi.waitFor(() => expect(embedText).toHaveBeenCalledTimes(1));

    // The person corrects it, and call B indexes v2 to the end.
    const revised = noted('family', 'Their father is home again and recovering well now');
    expect(await indexNote({ userId: ME }, 'family')).toBe('indexed');

    // A resumes: v1 is superseded, so it stores nothing, and must remove nothing of v2's.
    release();
    expect(await a).toBe('skipped');
    expect(vectorsOf(ME)).toEqual([revised.id]);
  });

  it('does not embed a note twice', async () => {
    noted('family', FATHER_NOTE);
    await indexNote({ userId: ME }, 'family');
    embedText.mockClear();

    expect(await indexNote({ userId: ME }, 'family')).toBe('already_indexed');
    expect(embedText).not.toHaveBeenCalled();
  });

  it.each([
    [
      'hidden in Daybreak’s definition',
      () =>
        world.frameworkDefinitions.push({
          slug: 'family',
          visibility: 'hidden',
          sensitivity: 'standard',
        }),
    ],
    [
      'hidden in ours',
      () =>
        world.appDefinitions.push({
          slug: 'family',
          visibility: 'hidden',
          sensitivity: 'standard',
        }),
    ],
    [
      'special-category in Daybreak’s definition',
      () =>
        world.frameworkDefinitions.push({
          slug: 'family',
          visibility: 'open',
          sensitivity: 'special_category',
        }),
    ],
    [
      'special-category in ours',
      () =>
        world.appDefinitions.push({
          slug: 'family',
          visibility: 'open',
          sensitivity: 'special_category',
        }),
    ],
  ])('never embeds a note %s', async (_case, flag) => {
    noted('family', FATHER_NOTE);
    flag();

    expect(await indexNote({ userId: ME }, 'family')).toBe('skipped');
    expect(world.embeddings).toEqual([]);
    expect(embedText).not.toHaveBeenCalled();
  });

  it('embeds a masked value only in its stored form, which is the sentinel, so not at all', async () => {
    // What `fill_slot` stores for a special-category capture: the words never land.
    noted('beliefs', MASKED);

    expect(await indexNote({ userId: ME }, 'beliefs')).toBe('skipped');
    expect(embedText).not.toHaveBeenCalled();
  });

  it('embeds a heading the AI coined, which no definition hides', async () => {
    noted('sailing_with_dad', FATHER_NOTE);
    expect(await indexNote({ userId: ME }, 'sailing_with_dad')).toBe('indexed');
  });

  it('skips a removed note and one too short to mean anything', async () => {
    wipe(noted('family', FATHER_NOTE));
    noted('mood', 'tired');

    expect(await indexNote({ userId: ME }, 'family')).toBe('skipped');
    expect(await indexNote({ userId: ME }, 'mood')).toBe('skipped');
    expect(embedText).not.toHaveBeenCalled();
  });

  it('writes nothing for someone else’s note, and leaves their vector alone', async () => {
    const theirs = noted('family', FATHER_NOTE, { owner: THEM });
    await indexNote({ userId: THEM }, 'family');

    expect(await indexNote({ userId: ME }, 'family')).toBe('skipped');
    expect(vectorsOf(THEM)).toEqual([theirs.id]);
    expect(vectorsOf(ME)).toEqual([]);
  });

  it('never fails the write: a queued note index that throws is logged and dropped', async () => {
    noted('family', FATHER_NOTE);
    world.embedFails = true;
    queueNoteIndex({ userId: ME }, 'family');
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(JSON.stringify(warn.mock.calls)).not.toContain('family');
  });
});

describe('a wiped note (t-107)', () => {
  const NOTES = [
    ['family', 'Their father taught them to sail; he has been unwell since spring'],
    ['work', 'Started a demanding new job at the hospital this year'],
  ] as const;

  beforeEach(async () => {
    for (const owner of [ME, THEM]) {
      for (const [slug, value] of NOTES) {
        noted(slug, value, { owner });
        await indexNote({ userId: owner }, slug);
      }
    }
    // The population: four vectors, two each, before anything is wiped.
    expect(world.embeddings).toHaveLength(4);
  });

  it('loses its vector to forgetWipedNotes, while a sibling’s and the other person’s stay', async () => {
    const family = world.slotValues.find((v) => v.userId === ME && v.slotSlug === 'family')!;
    wipe(family);

    expect(await forgetWipedNotes(prismaFake as never, { userId: ME })).toBe(1);
    expect(vectorsOf(ME)).toEqual(['sv-user-me-work-1']);
    expect(vectorsOf(THEM)).toHaveLength(2);
    // Idempotent: a second call finds nothing more to drop.
    expect(await forgetWipedNotes(prismaFake as never, { userId: ME })).toBe(0);
  });

  it('is never found by a search, even before its vector is dropped', async () => {
    const family = world.slotValues.find((v) => v.userId === ME && v.slotSlug === 'family')!;
    wipe(family);

    const hits = await searchMemory({ userId: ME }, 'father sail unwell spring', { limit: 5 });
    expect(hits.map((hit) => hit.sourceId)).toEqual(['sv-user-me-work-1']);
  });

  it('is dropped by the backfill’s prune if a race left its vector behind', async () => {
    wipe(world.slotValues.find((v) => v.userId === ME && v.slotSlug === 'family')!);
    world.frameworkDefinitions.push({
      slug: 'work',
      visibility: 'hidden',
      sensitivity: 'standard',
    });

    // The wiped note, and the work note on both sides now that its slot is hidden.
    expect(await backfillMemoryIndex()).toEqual({ indexed: 0, failed: 0, forgotten: 3 });
    expect(vectorsOf(ME)).toEqual([]);
    expect(vectorsOf(THEM)).toEqual(['sv-user-them-family-1']);
  });
});

describe('notes in the backfill and the search (t-107)', () => {
  it('backfills a note written by a path that queued nothing, and not a superseded version', async () => {
    noted('family', 'Their father taught them to sail on the lake');
    const head = noted('family', 'Their father is recovering at home after the hospital');

    expect(await backfillMemoryIndex()).toEqual({ indexed: 1, failed: 0, forgotten: 0 });
    expect(vectorsOf(ME)).toEqual([head.id]);
  });

  it('returns the caller’s notes and words together, nearest first, never another person’s', async () => {
    said('mine', MY_FATHER);
    const mine = noted('family', 'Their father taught them to sail on the lake as a child');
    // Theirs is the query word for word: the nearest vector in the index.
    const QUERY = 'my father and the lake and the boats';
    noted('family', QUERY, { owner: THEM });
    await backfillMemoryIndex();
    expect(world.embeddings).toHaveLength(3);

    const hits = await searchMemory({ userId: ME }, QUERY, { limit: 5 });
    expect(hits.map((hit) => hit.sourceId).sort()).toEqual(['mine', mine.id].sort());
    expect(hits.map((hit) => hit.distance)).toEqual([...hits.map((h) => h.distance)].sort());
    expect(hits.find((hit) => hit.sourceKind === 'note')).toMatchObject({
      slotSlug: 'family',
      text: mine.value,
      notedAt: mine.capturedAt,
    });
  });

  it('binds the person to both the index row and the note version in the SQL itself', async () => {
    world.sql = [];
    await searchMemory({ userId: ME }, 'father', { limit: 5 });
    const notes = world.sql.find((q) => q.text.includes('JOIN framework_slot_value v'));
    expect(notes?.text).toMatch(/e\."userId" = \$2/);
    expect(notes?.text).toMatch(/v\."userId" = \$3/);
    expect(notes?.values.slice(1, 3)).toEqual([ME, ME]);
    // The live-head, visible-note predicate is in the query, not only in the fake.
    expect(notes?.text).toMatch(/v\."supersededAt" IS NULL/);
    expect(notes?.text).toMatch(/v\."sourceType" <> \$\d+/);
    expect(notes?.text).toMatch(/v\."slotSlug" <> ALL\(\$\d+::text\[\]\)/);
    expect(notes?.values).toEqual(expect.arrayContaining([REMOVED, MASKED]));
  });

  it('binds the slugs hidden or special-category in either tier, and no others', async () => {
    world.frameworkDefinitions.push(
      { slug: 'development_stage', visibility: 'hidden', sensitivity: 'sensitive' },
      { slug: 'life_work', visibility: 'open', sensitivity: 'standard' }
    );
    world.appDefinitions.push(
      { slug: 'beliefs', visibility: 'open', sensitivity: 'special_category' },
      { slug: 'development_stage', visibility: 'hidden', sensitivity: 'sensitive' }
    );
    world.sql = [];
    await searchMemory({ userId: ME }, 'father', { limit: 5 });

    const notes = world.sql.find((q) => q.text.includes('JOIN framework_slot_value v'));
    const slugs = notes?.values.find(Array.isArray) as string[];
    expect([...slugs].sort()).toEqual(['beliefs', 'development_stage']);
  });

  it('carries the same QUALIFIES lines in every note statement', () => {
    const source = readFileSync(join(process.cwd(), 'lib/app/memory/memory-index.ts'), 'utf8');
    const LINES = [
      'v."supersededAt" IS NULL',
      'AND v."sourceType" <> ${REMOVED_SOURCE_TYPE}',
      'AND v.value <> ${MASKED_VALUE}',
      "AND LENGTH(BTRIM(v.value, ' ' || chr(9) || chr(10) || chr(13))) >= ${MIN_INDEXED_CHARS}",
      'AND v."slotSlug" <> ALL(${unsearchable}::text[])',
    ];
    const markers = source.match(/-- QUALIFIES/g) ?? [];
    // The head read, the insert, the backfill, the prune (negated) and the search.
    expect(markers).toHaveLength(5);
    for (const line of LINES) {
      expect(source.split(line).length - 1, line).toBe(markers.length);
    }
  });

  it('labels a note for the AI as a note, never as the person’s words', async () => {
    const note = noted('family', 'Their father taught them to sail on the lake as a child');
    await backfillMemoryIndex();
    const tool = new SearchPersonMemoryCapability();

    const result = await tool.execute(
      { query: 'father sail lake child' },
      {
        userId: ME,
        agentId: 'agent-guide',
        costLogMetadata: { turnId: 'turn-1', seat: 'facilitator' },
      }
    );

    expect(result.data?.results).toEqual([
      {
        kind: 'note',
        words: note.value,
        when: '1 January 1970',
        whose:
          'A note kept about the person, written from what they shared, last updated on 1 January 1970. It is your understanding of them, not their words: never quote it as something they said.',
      },
    ]);
  });
});
