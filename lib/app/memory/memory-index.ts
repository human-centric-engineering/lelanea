/**
 * The per-person memory index: what a person says, and the notes the app keeps
 * about them, embedded so they can be found again by meaning, for that person
 * only (f-memory t-129, t-107; product description §5 "Data storage", §3.19,
 * §12 "Deletion is real").
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
 * of the source it came from, with `ON DELETE CASCADE` foreign keys to the
 * source and to the person (`20261008100000_app_memory_embedding`,
 * `20261009100100_app_memory_note_source`). Deleting a message, an exchange
 * (t-127), a conversation, or the account takes the vector with it, with no
 * code on any of those paths.
 *
 * **A note is the exception, because a note is not deleted.** Removing one
 * (t-78) and deleting the exchange that wrote it (t-127) overwrite its versions
 * in place with a placeholder, so no cascade fires. Each calls
 * {@link forgetWipedNotes} in its own transaction, and every read here takes
 * live heads only, so a placeholder is never returned even in the instant
 * between.
 *
 * ## What is embedded
 *
 * **What the person said**: their own messages in a seat conversation, on write
 * from the turn path (`turns.ts`), off the reply's path as Sunrise embeds
 * replies. A message shorter than {@link MIN_INDEXED_CHARS} is not embedded:
 * "ok", "yes thanks" carry nothing to find again, and a vector of them would
 * come back near any short query.
 *
 * **The notes kept about them** (t-107): the head version of each note the
 * person can see in their own panel (owner ruling, 4 Oct 2026, journal on
 * `f-memory`). Coined headings are included. A slot hidden in either tier
 * (§12) is not, and neither is a special-category one: its stored value is
 * the masking sentinel, which holds nothing to find, and leaving the whole
 * slug out also covers a value stored before the slot was reclassified. Only
 * the value is embedded, never the reasoning note, which is not masked
 * (daybreak#269). A revision replaces the previous version's vector.
 *
 * Both are embedded on write where the write is ours (the turn, a capture, a
 * correction, a discovery answer), and a backfill job takes anything missed
 * and drops vectors whose source stopped qualifying (`lib/app/jobs.ts`).
 *
 * ## What it costs
 *
 * Each embedding is costed by the platform's embedder, attributed to the person
 * and the conversation, so it counts against their monthly ceiling the way
 * every other cost of their turn does (`metering.ts`, part `memory`).
 *
 * @see .context/app/memory.md
 */

import type { AppMemoryEmbedding, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { embedText, getActiveEmbeddingModelSummary } from '@/lib/orchestration/knowledge/embedder';
import { requireOrgId } from '@/lib/tenancy/context';
import { FACILITATION_SURFACE_CONTEXT_TYPE } from '@/lib/framework/facilitation/agents/surface';
import { SLOT_SENSITIVITY, SLOT_VISIBILITY } from '@/lib/framework/data-slots/vocabulary';
import { redactedString } from '@/lib/security/redact';
import { REMOVED_SOURCE_TYPE } from '@/lib/app/slots/removed';

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
export interface MessageHit {
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

/** One note the app keeps about the person, found by meaning (t-107). */
export interface NoteHit {
  sourceKind: 'note';
  /** The `framework_slot_value` id of the head version. */
  sourceId: string;
  slotSlug: string;
  /** The note's value, read from the version itself. */
  text: string;
  /** When this version was written. */
  notedAt: Date;
  distance: number;
}

export type MemoryHit = MessageHit | NoteHit;

/** What `fill_slot` stores for a special-category capture: the words never land. */
const MASKED_VALUE = redactedString(SLOT_SENSITIVITY.special_category);

/**
 * The slugs whose notes the index never takes: hidden or special-category in
 * EITHER tier (Daybreak's definition, or ours), the stricter answer of the
 * two, as the notes panel reads them (`ourVerdicts` in `notes.ts`). A slug
 * with no definition in either tier, a heading the AI coined, is not here.
 *
 * Read fresh by every note statement's caller, and bound into the statement as
 * `v."slotSlug" <> ALL(…)`.
 */
async function unsearchableSlugs(): Promise<string[]> {
  const flagged = {
    OR: [
      { visibility: SLOT_VISIBILITY.hidden },
      { sensitivity: SLOT_SENSITIVITY.special_category },
    ],
  };
  const [framework, ours] = await Promise.all([
    prisma.slotDefinition.findMany({ where: flagged, select: { slug: true } }),
    prisma.appSlotDefinition.findMany({ where: flagged, select: { slug: true } }),
  ]);
  return [...new Set([...framework, ...ours].map((definition) => definition.slug))];
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
 * Embedding models seen answering in a size the column cannot hold, keyed by the
 * active model's id (`fallback` when none is active). In process memory: a
 * restart costs one more call per model, and nothing else.
 */
const unstorableModels = new Set<string>();

/**
 * Whether the index should embed with the model the platform will use now, and
 * the key a mismatch is remembered under.
 *
 * Asked BEFORE embedding, because the embedder costs the call to the person
 * whether or not the vector can be stored: a model of another size would charge
 * every turn and store nothing. The active model's recorded size answers it
 * when there is one. With none active the platform falls back down a chain
 * whose size is not guaranteed (a local model answers in its own), so only the
 * first answer can tell; {@link indexMessage} remembers a mismatch here, and
 * nothing is embedded with that model again.
 */
async function embeddingFit(): Promise<{ ok: boolean; key: string }> {
  const active = await getActiveEmbeddingModelSummary();
  const key = active?.modelId ?? 'fallback';
  const ok =
    !unstorableModels.has(key) &&
    (active === null || active.dimensions === MEMORY_EMBEDDING_DIMENSION);
  return { ok, key };
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
 * must not. A vector of the wrong size is not a throw: it is `skipped`, and the
 * model is not used again.
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
  const fit = await embeddingFit();
  if (!fit.ok) return 'skipped';

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
    // Paid for once, and never again with this model (see embeddingFit).
    unstorableModels.add(fit.key);
    logger.warn('Memory index stopped using an embedding model it cannot store', {
      model,
      dimension: embedding.length,
      stores: MEMORY_EMBEDDING_DIMENSION,
    });
    return 'skipped';
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

/**
 * Embed the head version of one of the person's notes, and drop the vector of
 * any earlier version of it, so a revision replaces what was there (t-107).
 *
 * Takes the slug rather than a version id: every caller has just written the
 * note, and what should be indexed is whatever the head is by the time this
 * runs. Two revisions in quick succession therefore index the later one twice
 * at most, never the earlier one last. The INSERT re-checks the version is
 * still a qualifying head, so one superseded, hidden or wiped while it was
 * being embedded stores nothing.
 *
 * Only `value` is embedded. The reasoning note is never read here.
 *
 * Throws when the embedder does; {@link queueNoteIndex} is the caller that
 * must not.
 */
export async function indexNote(
  subject: MemorySubject,
  slotSlug: string,
  options: IndexOptions = {}
): Promise<IndexOutcome> {
  const unsearchable = await unsearchableSlugs();
  const [head] = await prisma.$queryRaw<Array<{ id: string; value: string }>>`
    SELECT v.id, v.value
      FROM framework_slot_value v
     WHERE v."userId" = ${subject.userId}
       AND v."slotSlug" = ${slotSlug}
       -- QUALIFIES: the live head of a note the person can see, with something
       -- in it to find. The same five lines in every note statement, held equal
       -- by a unit test, so no two can disagree about which notes count.
       AND v."supersededAt" IS NULL
       AND v."sourceType" <> ${REMOVED_SOURCE_TYPE}
       AND v.value <> ${MASKED_VALUE}
       AND LENGTH(BTRIM(v.value, ' ' || chr(9) || chr(10) || chr(13))) >= ${MIN_INDEXED_CHARS}
       AND v."slotSlug" <> ALL(${unsearchable}::text[])
  `;
  const outcome = head ? await embedNote(subject, head, unsearchable, options) : 'skipped';
  await forgetEarlierVersions(subject, slotSlug, head?.id ?? null);
  return outcome;
}

async function embedNote(
  subject: MemorySubject,
  head: { id: string; value: string },
  unsearchable: string[],
  options: IndexOptions
): Promise<IndexOutcome> {
  const existing = await prisma.appMemoryEmbedding.findFirst({
    where: { slotValueId: head.id, userId: subject.userId },
    select: { id: true },
  });
  if (existing) return 'already_indexed';
  const fit = await embeddingFit();
  if (!fit.ok) return 'skipped';

  const { embedding, model, provider, dimensions } = await embedText(
    head.value.slice(0, MAX_INDEXED_CHARS),
    'document',
    {
      userId: subject.userId,
      metadata: {
        kind: MEMORY_EMBEDDING_COST_KIND,
        slotValueId: head.id,
        ...(options.turnId ? { turnId: options.turnId } : {}),
      },
    }
  );
  if (embedding.length !== MEMORY_EMBEDDING_DIMENSION) {
    unstorableModels.add(fit.key);
    logger.warn('Memory index stopped using an embedding model it cannot store', {
      model,
      dimension: embedding.length,
      stores: MEMORY_EMBEDDING_DIMENSION,
    });
    return 'skipped';
  }

  const inserted = await prisma.$executeRaw`
    INSERT INTO app_memory_embedding (
      id, "userId", "sourceKind", "slotValueId", embedding,
      "embeddingModel", "embeddingProvider", "embeddingDimension", "orgId"
    )
    SELECT gen_random_uuid()::text, v."userId", 'note'::app_memory_source_kind, v.id, ${toVector(embedding)}::vector,
           ${model}, ${provider}, ${dimensions}, v."orgId"
      FROM framework_slot_value v
     WHERE v.id = ${head.id}
       AND v."userId" = ${subject.userId}
       -- QUALIFIES: the live head of a note the person can see, with something
       -- in it to find. The same five lines in every note statement, held equal
       -- by a unit test, so no two can disagree about which notes count.
       AND v."supersededAt" IS NULL
       AND v."sourceType" <> ${REMOVED_SOURCE_TYPE}
       AND v.value <> ${MASKED_VALUE}
       AND LENGTH(BTRIM(v.value, ' ' || chr(9) || chr(10) || chr(13))) >= ${MIN_INDEXED_CHARS}
       AND v."slotSlug" <> ALL(${unsearchable}::text[])
    ON CONFLICT ("slotValueId") DO NOTHING
  `;
  return inserted === 1 ? 'indexed' : 'skipped';
}

/** Drop the vectors of every version of one note except `keep`, the head. */
async function forgetEarlierVersions(
  subject: MemorySubject,
  slotSlug: string,
  keep: string | null
): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM app_memory_embedding e
     USING framework_slot_value v
     WHERE e."slotValueId" = v.id
       AND e."userId" = ${subject.userId}
       AND v."userId" = ${subject.userId}
       AND v."slotSlug" = ${slotSlug}
       AND (${keep}::text IS NULL OR v.id <> ${keep}::text)
  `;
}

/**
 * Index a note without holding anyone up: the write that changed it has
 * already answered. A miss is picked up by the backfill.
 */
export function queueNoteIndex(
  subject: MemorySubject,
  slotSlug: string,
  options: IndexOptions = {}
): void {
  void indexNote(subject, slotSlug, options).catch((err: unknown) => {
    // No slug: a coined one is the AI's wording of what the person said.
    logger.warn('Memory index could not embed a note; the backfill will retry it', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** The client a transaction hands its callback, as far as this module needs it. */
type MemoryTx = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Drop the vector of every note version of this person's that is now a
 * placeholder. Called inside the transaction that wiped them (removing a note,
 * deleting an exchange or a conversation; `lib/app/slots/wipe.ts`), so the
 * words and their vector go together or not at all. Idempotent, and scoped to
 * the person: it cannot touch anyone else's vectors, or a sibling note's.
 */
export async function forgetWipedNotes(tx: MemoryTx, subject: MemorySubject): Promise<number> {
  return tx.$executeRaw`
    DELETE FROM app_memory_embedding e
     USING framework_slot_value v
     WHERE e."slotValueId" = v.id
       AND e."userId" = ${subject.userId}
       AND v."userId" = ${subject.userId}
       AND v."sourceType" = ${REMOVED_SOURCE_TYPE}
  `;
}

/** What one backfill run did. */
export interface MemoryBackfillResult {
  indexed: number;
  failed: number;
  /** Note vectors dropped because their source stopped qualifying. */
  forgotten: number;
}

/** How many messages one backfill run takes on. */
export const MEMORY_BACKFILL_BATCH = 25;

/** After this many proven failures, a message is left out of the backfill. */
export const MAX_BACKFILL_ATTEMPTS = 3;

/**
 * Messages the embedder failed on while it was taking others, and how often. In
 * process memory, like the job clock: a restart gives each one three more
 * tries, which costs a few calls and nothing else.
 */
const backfillFailures = new Map<string, number>();

/** For tests: forget every recorded failure and every unstorable model. */
export function __resetMemoryIndexForTests(): void {
  backfillFailures.clear();
  unstorableModels.clear();
}

/**
 * Embed what the turn path and the note writes missed: the person's messages
 * stored before the index existed, notes written before t-107 or by a path
 * that does not queue one, and anything whose embedding failed. One org per
 * call (the job runs per org), newest first, a batch of each at a time. Then
 * drop the vectors of notes that stopped qualifying: superseded by a revision
 * the queued index missed, hidden since, or wiped in a race with their own
 * embedding.
 *
 * **A failure is blamed on a source only when the next one embeds.** One
 * failure might be the embedder (no provider, a provider down) or the source
 * (too long in tokens for the model, say), and the two need opposite answers.
 * So after a failure the run tries the next one. If that fails too, the
 * embedder is down: the run stops, and nobody is blamed, so an outage of any
 * length leaves nothing behind it. If it embeds, the first failure was the
 * source's: it counts, the run carries on, and after
 * {@link MAX_BACKFILL_ATTEMPTS} such failures the source is left out, so it
 * cannot hold back the rest.
 *
 * Embeds nothing while the active embedding model answers in a size the column
 * cannot hold: every call would be charged and nothing stored. The prune still
 * runs; it costs nothing.
 */
export async function backfillMemoryIndex(
  batchSize: number = MEMORY_BACKFILL_BATCH
): Promise<MemoryBackfillResult> {
  const orgId = requireOrgId();
  const forgotten = await forgetUnqualifiedNotes(orgId);
  if (!(await embeddingFit()).ok) {
    logger.warn(
      'Memory backfill skipped: the active embedding model is not the size the index stores',
      {
        dimension: MEMORY_EMBEDDING_DIMENSION,
      }
    );
    return { indexed: 0, failed: 0, forgotten };
  }
  const given = [...backfillFailures]
    .filter(([, attempts]) => attempts >= MAX_BACKFILL_ATTEMPTS)
    .map(([id]) => id);
  const messages = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
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
  const unsearchable = await unsearchableSlugs();
  const notes = await prisma.$queryRaw<Array<{ id: string; userId: string; slotSlug: string }>>`
    SELECT v.id, v."userId", v."slotSlug"
      FROM framework_slot_value v
      LEFT JOIN app_memory_embedding e ON e."slotValueId" = v.id
     WHERE v."orgId" = ${orgId}
       -- QUALIFIES: the live head of a note the person can see, with something
       -- in it to find. The same five lines in every note statement, held equal
       -- by a unit test, so no two can disagree about which notes count.
       AND v."supersededAt" IS NULL
       AND v."sourceType" <> ${REMOVED_SOURCE_TYPE}
       AND v.value <> ${MASKED_VALUE}
       AND LENGTH(BTRIM(v.value, ' ' || chr(9) || chr(10) || chr(13))) >= ${MIN_INDEXED_CHARS}
       AND v."slotSlug" <> ALL(${unsearchable}::text[])
       AND e.id IS NULL
       AND v.id <> ALL(${given}::text[])
     ORDER BY v."capturedAt" DESC
     LIMIT ${batchSize}
  `;
  const sources: Array<{ id: string; index: () => Promise<IndexOutcome> }> = [
    ...messages.map((m) => ({
      id: m.id,
      index: () => indexMessage({ userId: m.userId }, m.id),
    })),
    ...notes.map((n) => ({
      id: n.id,
      index: () => indexNote({ userId: n.userId }, n.slotSlug),
    })),
  ];

  let indexed = 0;
  let failed = 0;
  // The last source that failed, not yet known to be its own fault.
  let suspect: string | null = null;
  for (const source of sources) {
    try {
      if ((await source.index()) === 'indexed') indexed++;
      backfillFailures.delete(source.id);
      if (suspect) {
        backfillFailures.set(suspect, (backfillFailures.get(suspect) ?? 0) + 1);
        suspect = null;
      }
    } catch (err) {
      failed++;
      logger.warn('Memory backfill could not embed a source', {
        sourceId: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
      if (suspect) {
        logger.warn('Memory backfill stopped: the embedder is failing');
        break;
      }
      suspect = source.id;
    }
  }
  return { indexed, failed, forgotten };
}

/**
 * Drop the vectors of an org's note versions that no longer qualify (see
 * the QUALIFIES lines). The wipes drop theirs in their own transaction and a
 * revision drops the previous one when it is indexed; this is the floor under
 * both, for whatever a race or a missed queue left behind. A search never
 * returns such a vector meanwhile, because it applies the same predicate.
 */
async function forgetUnqualifiedNotes(orgId: string): Promise<number> {
  const unsearchable = await unsearchableSlugs();
  return prisma.$executeRaw`
    DELETE FROM app_memory_embedding e
     USING framework_slot_value v
     WHERE e."slotValueId" = v.id
       AND e."orgId" = ${orgId}
       AND NOT (
         -- QUALIFIES, negated: the same five lines as every other note statement.
         v."supersededAt" IS NULL
         AND v."sourceType" <> ${REMOVED_SOURCE_TYPE}
         AND v.value <> ${MASKED_VALUE}
         AND LENGTH(BTRIM(v.value, ' ' || chr(9) || chr(10) || chr(13))) >= ${MIN_INDEXED_CHARS}
         AND v."slotSlug" <> ALL(${unsearchable}::text[])
       )
  `;
}

/** How a search is bounded, and whom its query embedding is charged to. */
export interface MemorySearchOptions {
  /** At most this many hits; capped at {@link MAX_SEARCH_RESULTS}. */
  limit: number;
  /** Leave out hits further than this cosine distance. */
  maxDistance?: number;
  /**
   * Messages never to return: the turn's own message, which the AI already
   * has in front of it and which would otherwise come back as the nearest hit.
   */
  excludeMessageIds?: string[];
  /**
   * Where the query embedding's cost row points. The person is always the
   * subject; this adds the agent, the conversation and the turn (`turnId` in
   * `metadata` is what the per-turn meter matches, `metering.ts`).
   */
  attribution?: {
    agentId?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  };
}

/**
 * The person's own words, and the notes kept about them, nearest in meaning to
 * `query`, nearest first.
 *
 * Two statements, one per source kind, each limited and then merged: a note's
 * text lives in a different table from a message's, and each is joined back to
 * its source to be filtered by the person there too. A note is returned only
 * while it is a live, visible head (the QUALIFIES lines), so a vector the
 * prune has not reached yet still never reaches a prompt.
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

  const { attribution } = options;
  const { embedding, model } = await embedText(trimmed.slice(0, MAX_INDEXED_CHARS), 'query', {
    userId: subject.userId,
    ...(attribution?.agentId ? { agentId: attribution.agentId } : {}),
    ...(attribution?.conversationId ? { conversationId: attribution.conversationId } : {}),
    metadata: { ...(attribution?.metadata ?? {}), kind: MEMORY_SEARCH_COST_KIND },
  });
  const vector = toVector(embedding);
  const maxDistance = options.maxDistance ?? null;
  const excluded = options.excludeMessageIds ?? [];

  const orgId = requireOrgId();
  const unsearchable = await unsearchableSlugs();
  const messageRows = prisma.$queryRaw<
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
       AND e."orgId" = ${orgId}
       AND e."embeddingModel" = ${model}
       AND (${maxDistance}::float8 IS NULL OR (e.embedding <=> ${vector}::vector) < ${maxDistance}::float8)
       AND e."messageId" <> ALL(${excluded}::text[])
     ORDER BY e.embedding <=> ${vector}::vector ASC
     LIMIT ${limit}
  `;
  const noteRows = prisma.$queryRaw<
    Array<{
      slotValueId: string;
      slotSlug: string;
      value: string;
      capturedAt: Date;
      distance: number;
    }>
  >`
    SELECT e."slotValueId", v."slotSlug", v.value, v."capturedAt",
           (e.embedding <=> ${vector}::vector) AS distance
      FROM app_memory_embedding e
      JOIN framework_slot_value v ON v.id = e."slotValueId"
     WHERE e."userId" = ${subject.userId}
       AND v."userId" = ${subject.userId}
       AND e."orgId" = ${orgId}
       AND e."embeddingModel" = ${model}
       -- QUALIFIES: the live head of a note the person can see, with something
       -- in it to find. The same five lines in every note statement, held equal
       -- by a unit test, so no two can disagree about which notes count.
       AND v."supersededAt" IS NULL
       AND v."sourceType" <> ${REMOVED_SOURCE_TYPE}
       AND v.value <> ${MASKED_VALUE}
       AND LENGTH(BTRIM(v.value, ' ' || chr(9) || chr(10) || chr(13))) >= ${MIN_INDEXED_CHARS}
       AND v."slotSlug" <> ALL(${unsearchable}::text[])
       AND (${maxDistance}::float8 IS NULL OR (e.embedding <=> ${vector}::vector) < ${maxDistance}::float8)
     ORDER BY e.embedding <=> ${vector}::vector ASC
     LIMIT ${limit}
  `;
  const [messages, notes] = await Promise.all([messageRows, noteRows]);

  const hits: MemoryHit[] = [
    ...messages.map((row): MessageHit => ({
      sourceKind: 'message',
      sourceId: row.messageId,
      conversationId: row.conversationId,
      text: row.content,
      saidAt: row.createdAt,
      distance: Number(row.distance),
    })),
    ...notes.map((row): NoteHit => ({
      sourceKind: 'note',
      sourceId: row.slotValueId,
      slotSlug: row.slotSlug,
      text: row.value,
      notedAt: row.capturedAt,
      distance: Number(row.distance),
    })),
  ];
  return hits.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

/**
 * Remove the person's vectors for these sources, now.
 *
 * Deleting a message or a note version already does this through the foreign
 * key, and a wipe has {@link forgetWipedNotes}; this is Daybreak's ask, which
 * names it, for a caller that holds ids. Scoped to the person: another
 * person's id removes nothing.
 */
export async function forgetMemory(
  subject: MemorySubject,
  sources: { messageIds?: string[]; slotValueIds?: string[] }
): Promise<number> {
  const messageIds = sources.messageIds ?? [];
  const slotValueIds = sources.slotValueIds ?? [];
  if (messageIds.length === 0 && slotValueIds.length === 0) return 0;
  const { count } = await prisma.appMemoryEmbedding.deleteMany({
    where: {
      userId: subject.userId,
      OR: [{ messageId: { in: messageIds } }, { slotValueId: { in: slotValueIds } }],
    },
  });
  return count;
}

/**
 * What a subject-access export returns: which of their messages and note
 * versions are indexed, never the vector.
 */
export interface MemoryEntry {
  sourceKind: string;
  messageId: string | null;
  slotValueId: string | null;
  embeddingModel: string;
  createdAt: Date;
}

const ENTRY_SELECT = {
  sourceKind: true,
  messageId: true,
  slotValueId: true,
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
