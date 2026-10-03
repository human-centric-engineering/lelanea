/**
 * The per-person memory index: what a person says, embedded so it can be found
 * again by meaning, for that person only (f-memory t-129; product description
 * §5 "Data storage", §3.19, §12 "Deletion is real").
 *
 * A conversation happening now should be able to surface what the person said
 * eighteen months ago about their father. Nothing they say is embedded by the
 * platform: Sunrise embeds the AI's replies only (`message-embedder.ts`), and
 * the knowledge base has no per-person scope. This module is the index that
 * retrieval (t-130) searches.
 *
 * ## A stand-in for Daybreak's, so it is shaped to be swapped
 *
 * Owner ruling 1 (3 Oct 2026, journal on `f-memory`): the index belongs in
 * Daybreak (daybreak#287), and until it ships the leaf builds its own behind a
 * surface that mirrors the ask: {@link indexMessage} to add, {@link
 * searchMemory} to find, {@link forgetMemory} to remove. **Nothing outside this
 * file touches `app_memory_embedding`** (`index-boundary.test.ts` says so), so
 * the swap is a change here and a re-embed.
 *
 * ## Per person by construction
 *
 * Every read and write names the person, and every one joins the source back to
 * a conversation of theirs: an index call for someone else's message writes
 * nothing, and a search can only ever return the caller's own words. The
 * person always comes from the caller's context (the turn, the session), never
 * from anything a model or a request body says.
 *
 * ## An embedding goes with its source
 *
 * Owner ruling 2, at claim. The row holds no words, only the vector and the id
 * of the message it came from, with `ON DELETE CASCADE` foreign keys to the
 * message and to the person (`20261008100000_app_memory_embedding`). Deleting
 * a message, an exchange (t-127), a conversation, or the account takes the
 * vector with it, with no code on any of those paths.
 *
 * ## What is embedded
 *
 * The person's own messages in a seat conversation, on write from the turn path
 * (`turns.ts`), off the reply's path as Sunrise embeds replies, and a backfill
 * job for messages stored before (`lib/app/jobs.ts`). A message shorter than
 * {@link MIN_INDEXED_CHARS} is not embedded: "ok", "yes thanks" carry nothing
 * to find again, and a vector of them would come back near any short query.
 *
 * ## What it costs
 *
 * Each embedding is costed by the platform's embedder, attributed to the person
 * and the conversation, so it counts against their monthly ceiling the way
 * every other cost of their turn does (`metering.ts`, part `memory`).
 *
 * @see .context/app/memory.md
 */

import type { AppMemoryEmbedding } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { embedText, getActiveEmbeddingModelSummary } from '@/lib/orchestration/knowledge/embedder';
import { requireOrgId } from '@/lib/tenancy/context';
import { FACILITATION_SURFACE_CONTEXT_TYPE } from '@/lib/framework/facilitation/agents/surface';

/** Shorter than this, a message is not embedded. See the module header. */
export const MIN_INDEXED_CHARS = 12;

/** Longer than this, only the start is embedded, as Sunrise's embedder does. */
export const MAX_INDEXED_CHARS = 8000;

/** The column is `vector(1536)`; a provider answering in another size cannot be stored. */
export const MEMORY_EMBEDDING_DIMENSION = 1536;

/** The most results one search returns. */
export const MAX_SEARCH_RESULTS = 20;

/** The cost-log `kind` of an embedding made for the index. */
export const MEMORY_EMBEDDING_COST_KIND = 'memory_embedding';

/** The cost-log `kind` of a search query's embedding. */
export const MEMORY_SEARCH_COST_KIND = 'memory_search';

/** Whose memory: always from the caller's context. */
export interface MemorySubject {
  userId: string;
}

/** What {@link indexMessage} did, so a caller (the backfill) can count it. */
export type IndexOutcome = 'indexed' | 'already_indexed' | 'skipped';

/** One thing the person said, found by meaning. */
export interface MemoryHit {
  sourceKind: 'message';
  /** The `ai_message` id. */
  sourceId: string;
  conversationId: string;
  /** The person's words, read from the message itself. */
  text: string;
  saidAt: Date;
  /** Cosine distance to the query: 0 is identical, 2 is opposite. */
  distance: number;
}

interface IndexableMessage {
  content: string;
  conversationId: string;
}

/**
 * The person's message, when it is one this index takes: a user-role message
 * in a seat conversation of theirs. `null` for anyone else's, an assistant's,
 * or one outside the seats.
 */
async function readIndexableMessage(
  subject: MemorySubject,
  messageId: string
): Promise<IndexableMessage | null> {
  const rows = await prisma.$queryRaw<IndexableMessage[]>`
    SELECT m.content, m."conversationId"
      FROM ai_message m
      JOIN ai_conversation c ON c.id = m."conversationId"
     WHERE m.id = ${messageId}
       AND c."userId" = ${subject.userId}
       -- INDEXABLE: the same three lines as the backfill's (see its note).
       AND m.role = 'user'
       AND c."contextType" = ${FACILITATION_SURFACE_CONTEXT_TYPE}
       AND LENGTH(BTRIM(m.content, ' ' || chr(9) || chr(10) || chr(13))) >= ${MIN_INDEXED_CHARS}
  `;
  return rows[0] ?? null;
}

/**
 * Whether the active embedding model answers in the size the column holds.
 * Asked BEFORE embedding, because the embedder costs the call to the person
 * whether or not the vector can be stored: a model of another size would charge
 * every turn and store nothing. No active model means the platform's fallback,
 * which is 1536.
 */
async function embeddingFits(): Promise<boolean> {
  const active = await getActiveEmbeddingModelSummary();
  return active === null || active.dimensions === MEMORY_EMBEDDING_DIMENSION;
}

/** What the turn path knows about the message it hands over. */
export interface IndexOptions {
  /** The turn the message opened, so its embedding is counted in that turn's cost. */
  turnId?: string;
}

/**
 * Embed one of the person's messages and store the vector.
 *
 * Idempotent: a message already indexed is not embedded again, and two
 * concurrent calls for the same message store one row (`messageId` is unique).
 * The row's org is the message's own, and the INSERT re-checks that the message
 * is still the person's, so a message deleted while it was being embedded
 * stores nothing.
 *
 * Throws when the embedder does; {@link queueMessageIndex} is the caller that
 * must not.
 */
export async function indexMessage(
  subject: MemorySubject,
  messageId: string,
  options: IndexOptions = {}
): Promise<IndexOutcome> {
  const existing = await prisma.appMemoryEmbedding.findFirst({
    where: { messageId, userId: subject.userId },
    select: { id: true },
  });
  if (existing) return 'already_indexed';

  const message = await readIndexableMessage(subject, messageId);
  if (!message) return 'skipped';
  if (!(await embeddingFits())) return 'skipped';

  const text = message.content.slice(0, MAX_INDEXED_CHARS);
  const { embedding, model, provider, dimensions } = await embedText(text, 'document', {
    userId: subject.userId,
    conversationId: message.conversationId,
    // `turnId` is what the per-turn meter matches a cost row on (`metering.ts`).
    metadata: {
      kind: MEMORY_EMBEDDING_COST_KIND,
      messageId,
      ...(options.turnId ? { turnId: options.turnId } : {}),
    },
  });
  if (embedding.length !== MEMORY_EMBEDDING_DIMENSION) {
    throw new Error(
      `The embedding model answered in ${embedding.length} dimensions; the memory index stores ${MEMORY_EMBEDDING_DIMENSION}.`
    );
  }

  const inserted = await prisma.$executeRaw`
    INSERT INTO app_memory_embedding (
      id, "userId", "sourceKind", "messageId", embedding,
      "embeddingModel", "embeddingProvider", "embeddingDimension", "orgId"
    )
    SELECT gen_random_uuid()::text, c."userId", 'message'::app_memory_source_kind, m.id, ${toVector(embedding)}::vector,
           ${model}, ${provider}, ${dimensions}, m."orgId"
      FROM ai_message m
      JOIN ai_conversation c ON c.id = m."conversationId"
     WHERE m.id = ${messageId}
       AND c."userId" = ${subject.userId}
    ON CONFLICT ("messageId") DO NOTHING
  `;
  return inserted === 1 ? 'indexed' : 'skipped';
}

/**
 * Index a message without holding anyone up. For the turn path: the reply must
 * never wait on an embedding, and must never fail because one did. A miss here
 * is picked up by the backfill.
 */
export function queueMessageIndex(
  subject: MemorySubject,
  messageId: string,
  options: IndexOptions = {}
): void {
  void indexMessage(subject, messageId, options).catch((err: unknown) => {
    logger.warn('Memory index could not embed a message; the backfill will retry it', {
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** What one backfill run did. */
export interface MemoryBackfillResult {
  indexed: number;
  failed: number;
}

/** How many messages one backfill run takes on. */
export const MEMORY_BACKFILL_BATCH = 25;

/** After this many failed runs, a message is left out of the backfill. */
export const MAX_BACKFILL_ATTEMPTS = 3;

/**
 * Messages the backfill has failed on, and how often. A message the embedder
 * rejects every time (too long in tokens for its limit, say) would otherwise be
 * the newest unindexed message on every run, stop the run, and hold back every
 * older one for good. In process memory, like the job clock: a restart gives
 * each one another three tries, which costs a few calls and nothing else.
 */
const backfillFailures = new Map<string, number>();

/** For tests: forget every recorded failure. */
export function __resetBackfillFailuresForTests(): void {
  backfillFailures.clear();
}

/**
 * Embed the person's messages that were stored before the index existed, or
 * that the turn path missed. One org per call (the job runs per org), newest
 * first, a batch at a time.
 *
 * **Stops at the first failure.** A failure is almost always the embedder (no
 * provider, a provider down), and every other message in the batch would fail
 * the same way and log the same warning. The next run starts again. A message
 * that fails {@link MAX_BACKFILL_ATTEMPTS} runs is left out after that, so one
 * the embedder will never take cannot hold back the rest.
 *
 * Does nothing while the active embedding model answers in a size the column
 * cannot hold: every call would be charged and nothing stored.
 */
export async function backfillMemoryIndex(
  batchSize: number = MEMORY_BACKFILL_BATCH
): Promise<MemoryBackfillResult> {
  const orgId = requireOrgId();
  if (!(await embeddingFits())) {
    logger.warn(
      'Memory backfill skipped: the active embedding model is not the size the index stores',
      {
        dimension: MEMORY_EMBEDDING_DIMENSION,
      }
    );
    return { indexed: 0, failed: 0 };
  }
  const given = [...backfillFailures]
    .filter(([, attempts]) => attempts >= MAX_BACKFILL_ATTEMPTS)
    .map(([id]) => id);
  const missing = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT m.id, c."userId"
      FROM ai_message m
      JOIN ai_conversation c ON c.id = m."conversationId"
      LEFT JOIN app_memory_embedding e ON e."messageId" = m.id
     WHERE m."orgId" = ${orgId}
       AND c."userId" IS NOT NULL
       -- INDEXABLE: the same three lines as readIndexableMessage's, in SQL in
       -- both. Were the length tested in JS there and in SQL here, a message
       -- the two measure differently would be picked by every run and skipped
       -- by every index call, holding a batch slot forever. A unit test holds
       -- the two copies equal.
       AND m.role = 'user'
       AND c."contextType" = ${FACILITATION_SURFACE_CONTEXT_TYPE}
       AND LENGTH(BTRIM(m.content, ' ' || chr(9) || chr(10) || chr(13))) >= ${MIN_INDEXED_CHARS}
       AND e.id IS NULL
       AND m.id <> ALL(${given}::text[])
     ORDER BY m."createdAt" DESC
     LIMIT ${batchSize}
  `;

  let indexed = 0;
  for (const message of missing) {
    try {
      if ((await indexMessage({ userId: message.userId }, message.id)) === 'indexed') indexed++;
      backfillFailures.delete(message.id);
    } catch (err) {
      const attempts = (backfillFailures.get(message.id) ?? 0) + 1;
      backfillFailures.set(message.id, attempts);
      logger.warn('Memory backfill stopped: a message could not be embedded', {
        messageId: message.id,
        attempts,
        error: err instanceof Error ? err.message : String(err),
      });
      return { indexed, failed: 1 };
    }
  }
  return { indexed, failed: 0 };
}

/** How a search is bounded. */
export interface MemorySearchOptions {
  /** At most this many hits; capped at {@link MAX_SEARCH_RESULTS}. */
  limit: number;
  /** Leave out hits further than this cosine distance. */
  maxDistance?: number;
}

/**
 * The person's own words nearest in meaning to `query`, nearest first.
 *
 * Only vectors made by the model that embedded the query are compared: two
 * models' vectors share no space, and a distance between them means nothing.
 * After the embedding model changes, older messages are invisible to search
 * until they are re-embedded.
 *
 * **Filtered by person, then ranked.** The HNSW index ranks across everyone and
 * the person filter applies after, so on a large table a person with few
 * messages can get fewer hits than `limit` (pgvector's `ef_search`, 40 by
 * default). Revisit with iterative scans, or a partial index, if a person's
 * search comes back short.
 */
export async function searchMemory(
  subject: MemorySubject,
  query: string,
  options: MemorySearchOptions
): Promise<MemoryHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const limit = Math.max(1, Math.min(options.limit, MAX_SEARCH_RESULTS));

  const { embedding, model } = await embedText(trimmed.slice(0, MAX_INDEXED_CHARS), 'query', {
    userId: subject.userId,
    metadata: { kind: MEMORY_SEARCH_COST_KIND },
  });
  const vector = toVector(embedding);
  const maxDistance = options.maxDistance ?? null;

  const rows = await prisma.$queryRaw<
    Array<{
      messageId: string;
      conversationId: string;
      content: string;
      createdAt: Date;
      distance: number;
    }>
  >`
    SELECT e."messageId", m."conversationId", m.content, m."createdAt",
           (e.embedding <=> ${vector}::vector) AS distance
      FROM app_memory_embedding e
      JOIN ai_message m ON m.id = e."messageId"
      JOIN ai_conversation c ON c.id = m."conversationId"
     WHERE e."userId" = ${subject.userId}
       AND c."userId" = ${subject.userId}
       AND e."orgId" = ${requireOrgId()}
       AND e."embeddingModel" = ${model}
       AND (${maxDistance}::float8 IS NULL OR (e.embedding <=> ${vector}::vector) < ${maxDistance}::float8)
     ORDER BY e.embedding <=> ${vector}::vector ASC
     LIMIT ${limit}
  `;

  return rows.map((row) => ({
    sourceKind: 'message',
    sourceId: row.messageId,
    conversationId: row.conversationId,
    text: row.content,
    saidAt: row.createdAt,
    distance: Number(row.distance),
  }));
}

/**
 * Remove the person's vectors for these messages, now.
 *
 * Deleting a message already does this through the foreign key; this is for a
 * source that stays while its words go (a note wiped to a placeholder, t-107),
 * and for Daybreak's ask, which names it. Scoped to the person: another
 * person's message id removes nothing.
 */
export async function forgetMemory(
  subject: MemorySubject,
  sources: { messageIds: string[] }
): Promise<number> {
  if (sources.messageIds.length === 0) return 0;
  const { count } = await prisma.appMemoryEmbedding.deleteMany({
    where: { userId: subject.userId, messageId: { in: sources.messageIds } },
  });
  return count;
}

/** What a subject-access export returns: which of their messages are indexed, never the vector. */
export interface MemoryEntry {
  sourceKind: string;
  messageId: string | null;
  embeddingModel: string;
  createdAt: Date;
}

const ENTRY_SELECT = {
  sourceKind: true,
  messageId: true,
  embeddingModel: true,
  createdAt: true,
} as const;

/** The person's index entries, for their subject-access export (`leaf-data-export.ts`). */
export function listMemoryEntriesForSubject(subject: MemorySubject): Promise<MemoryEntry[]> {
  return prisma.appMemoryEmbedding.findMany({
    where: { userId: subject.userId },
    select: ENTRY_SELECT,
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * An org's index rows, for the org export (`leaf-data-export.ts`). Full rows, as
 * an `export` source must be: Prisma never reads an `Unsupported` column, so the
 * vectors are not among them.
 */
export function listMemoryEntriesForOrg(orgId: string): Promise<AppMemoryEmbedding[]> {
  return prisma.appMemoryEmbedding.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
}

function toVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
