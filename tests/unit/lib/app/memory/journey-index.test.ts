/**
 * The journey record's join to the memory index (f-journey-record t-149): a
 * kept synopsis, and an entry the person wrote and did not keep from her,
 * embedded and findable; a draft, one kept from her, and a synopsis still
 * flagged from a deleted exchange are not.
 *
 * ## What is faked, and what proves the rest
 *
 * `memory-index.ts` is raw SQL over `app_journey_entry` and
 * `app_memory_embedding`. The fake below answers the module's three journey
 * statements (the single-row read, the conditional insert, the backfill list
 * and its prune, and the search) by shape, reading the bound values in the
 * order the SQL binds them (rebuilt with `Prisma.sql`, so nested fragments
 * flatten as Postgres would see them). It reuses the deterministic
 * bag-of-words embedder and cosine distance from
 * `tests/unit/lib/app/memory/memory-index.test.ts`, which fakes journey
 * statements as a no-op ("the person has no journey record") and sends them
 * here instead. The `ON DELETE CASCADE` the real column carries is simulated
 * by a helper that removes the row and its vector together; what only
 * Postgres can prove is `npm run smoke:app-memory-index`.
 *
 * @see lib/app/memory/memory-index.ts
 */

import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, vi } from 'vitest';

const ME = 'user-me';
const THEM = 'user-them';
const ORG = 'install';
const DIM = 1536;

interface JourneyEntryRow {
  id: string;
  userId: string;
  kind: 'synopsis' | 'own';
  state: 'draft' | 'kept';
  withheldFromAgent: boolean;
  sourceRemovedAt: Date | null;
  summary: string | null;
  body: string;
  outcomes: unknown;
  occurredAt: Date;
  updatedAt: Date;
  orgId: string;
}
interface Embedding {
  id: string;
  userId: string;
  journeyEntryId: string;
  embedding: number[];
  embeddingModel: string;
  orgId: string;
  createdAt: Date;
}

const world = vi.hoisted(() => ({
  entries: [] as JourneyEntryRow[],
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

function entryOf(id: string): JourneyEntryRow | undefined {
  return world.entries.find((e) => e.id === id);
}

/** JOURNEY QUALIFIES, in JS: kept, not kept from her, not flagged as source-removed. */
function qualifies(e: JourneyEntryRow): boolean {
  return e.state === 'kept' && e.withheldFromAgent === false && e.sourceRemovedAt === null;
}

/** Remove a journey entry and its vector together, as the hand-written FK cascade does. */
function removeEntryCascade(id: string): void {
  world.entries = world.entries.filter((e) => e.id !== id);
  world.embeddings = world.embeddings.filter((em) => em.journeyEntryId !== id);
}

const prismaFake = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, values: v } = sqlOf(strings, values);
    if (!text.includes('app_journey_entry')) return [];

    if (text.includes('LEFT JOIN')) {
      // backfill list: [orgId, given, limit]
      const [orgId, given, limit] = v;
      return world.entries
        .filter((e) => e.orgId === orgId && qualifies(e))
        .filter((e) => !(given as string[]).includes(e.id))
        .filter((e) => !world.embeddings.some((em) => em.journeyEntryId === e.id))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, Number(limit))
        .map((e) => ({ id: e.id, userId: e.userId }));
    }

    if (text.includes('JOIN app_journey_entry j ON j.id = e."journeyEntryId"')) {
      // search: [vector, userId(e), userId(j), orgId, model, maxDistance, vector, maxDistance, vector, limit]
      const query = parseVector(v[0]);
      const [, userE, userJ, orgId, model, max] = v;
      const limit = Number(v[9]);
      return world.embeddings
        .filter((em) => em.userId === userE && em.orgId === orgId && em.embeddingModel === model)
        .map((em) => ({ em, entry: entryOf(em.journeyEntryId) }))
        .filter(({ entry }) => entry !== undefined && entry.userId === userJ && qualifies(entry))
        .map(({ em, entry }) => ({
          journeyEntryId: entry!.id,
          kind: entry!.kind,
          summary: entry!.summary,
          body: entry!.body,
          outcomes: entry!.outcomes,
          occurredAt: entry!.occurredAt,
          distance: cosineDistance(em.embedding, query),
        }))
        .filter((row) => max === null || row.distance < Number(max))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit);
    }

    // The single-row read (indexJourneyEntry): [entryId, userId]
    const [entryId, userId] = v;
    return world.entries
      .filter((e) => e.id === entryId && e.userId === userId && qualifies(e))
      .map((e) => ({
        id: e.id,
        summary: e.summary,
        body: e.body,
        outcomes: e.outcomes,
        updatedAt: e.updatedAt,
      }));
  }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, values: v } = sqlOf(strings, values);
    if (!text.includes('app_journey_entry')) return 0;

    if (text.includes('INSERT INTO app_memory_embedding')) {
      // insert: [vec, model, provider, dimension, entryId, userId, updatedAt]
      const [vec, model, , , entryId, userId, updatedAt] = v;
      const row = entryOf(String(entryId));
      if (
        !row ||
        row.userId !== userId ||
        row.updatedAt.getTime() !== (updatedAt as Date).getTime() ||
        !qualifies(row)
      ) {
        return 0;
      }
      if (world.embeddings.some((em) => em.journeyEntryId === row.id)) return 0;
      world.embeddings.push({
        id: `emb-${world.embeddings.length + 1}`,
        userId: row.userId,
        journeyEntryId: row.id,
        embedding: parseVector(vec),
        embeddingModel: String(model),
        orgId: row.orgId,
        createdAt: new Date(),
      });
      return 1;
    }

    // The prune (forgetUnqualifiedJourneyEntries): [orgId]
    expect(text).toContain('NOT (');
    const [orgId] = v;
    const before = world.embeddings.length;
    world.embeddings = world.embeddings.filter((em) => {
      if (em.orgId !== orgId) return true;
      const entry = entryOf(em.journeyEntryId);
      // Gone already (the cascade got there first): nothing left for the prune to do.
      if (!entry) return true;
      return qualifies(entry);
    });
    return before - world.embeddings.length;
  }),
  slotDefinition: { findMany: vi.fn(async () => []) },
  appSlotDefinition: { findMany: vi.fn(async () => []) },
  appMemoryEmbedding: {
    findFirst: vi.fn(async ({ where }: { where: { journeyEntryId?: string; userId: string } }) => {
      const row = world.embeddings.find(
        (em) => em.userId === where.userId && em.journeyEntryId === where.journeyEntryId
      );
      return row ? { id: row.id } : null;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { userId: string; journeyEntryId: string } }) => {
      const before = world.embeddings.length;
      world.embeddings = world.embeddings.filter(
        (em) => !(em.userId === where.userId && em.journeyEntryId === where.journeyEntryId)
      );
      return { count: before - world.embeddings.length };
    }),
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
  indexJourneyEntry,
  queueJourneyEntryIndex,
  forgetJourneyEntry,
  journeyEntryText,
  backfillMemoryIndex,
  searchMemory,
  __resetMemoryIndexForTests,
} = await import('@/lib/app/memory/memory-index');

let clock = 0;
function journeyRow(id: string, overrides: Partial<JourneyEntryRow> = {}): JourneyEntryRow {
  const at = overrides.occurredAt ?? new Date(++clock * 1000);
  const row: JourneyEntryRow = {
    id,
    userId: ME,
    kind: 'own',
    state: 'kept',
    withheldFromAgent: false,
    sourceRemovedAt: null,
    summary: null,
    body: 'I walked by the lake and thought about my father.',
    outcomes: [],
    occurredAt: at,
    updatedAt: at,
    orgId: ORG,
    ...overrides,
  };
  world.entries.push(row);
  return row;
}

const MY_FATHER = 'my father taught me to sail on the lake';
const THEIR_FATHER = 'my father and I never spoke about the lake or about sail boats';

beforeEach(() => {
  world.entries = [];
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

describe('indexing a journey entry', () => {
  it('embeds a kept own entry and a kept synopsis, each under the right source kind', async () => {
    const own = journeyRow('own-1', { kind: 'own', body: MY_FATHER });
    const synopsis = journeyRow('syn-1', {
      kind: 'synopsis',
      summary: 'The lake',
      body: 'We talked about the lake and my father.',
    });

    expect(await indexJourneyEntry({ userId: ME }, own.id)).toBe('indexed');
    expect(await indexJourneyEntry({ userId: ME }, synopsis.id)).toBe('indexed');
    expect(world.embeddings).toHaveLength(2);

    const hits = await searchMemory({ userId: ME }, 'lake father', { limit: 5 });
    expect(hits.find((h) => h.sourceId === own.id)).toMatchObject({ sourceKind: 'own_entry' });
    expect(hits.find((h) => h.sourceId === synopsis.id)).toMatchObject({ sourceKind: 'synopsis' });
  });

  it('skips a draft, an entry kept from her, and a synopsis flagged as written from a deleted exchange', async () => {
    const draft = journeyRow('draft-1', { kind: 'synopsis', state: 'draft' });
    const withheld = journeyRow('withheld-1', { kind: 'own', withheldFromAgent: true });
    const flagged = journeyRow('flagged-1', {
      kind: 'synopsis',
      sourceRemovedAt: new Date(),
    });

    for (const id of [draft.id, withheld.id, flagged.id]) {
      expect(await indexJourneyEntry({ userId: ME }, id)).toBe('skipped');
    }
    expect(world.embeddings).toEqual([]);
    expect(embedText).not.toHaveBeenCalled();
  });

  it('does not embed an entry twice', async () => {
    const entry = journeyRow('e1', { body: MY_FATHER });
    await indexJourneyEntry({ userId: ME }, entry.id);
    embedText.mockClear();

    expect(await indexJourneyEntry({ userId: ME }, entry.id)).toBe('already_indexed');
    expect(embedText).not.toHaveBeenCalled();
    expect(world.embeddings).toHaveLength(1);
  });

  it('stores nothing when the entry is edited while its embedding is still being made', async () => {
    const entry = journeyRow('e2', { body: MY_FATHER });
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

    const call = indexJourneyEntry({ userId: ME }, entry.id);
    await vi.waitFor(() => expect(embedText).toHaveBeenCalledTimes(1));

    // Changed mid-flight: a redraft, a correction, anything that moves updatedAt.
    entry.updatedAt = new Date(entry.updatedAt.getTime() + 1000);
    entry.body = 'something else entirely, written after the embed started';

    release();
    expect(await call).toBe('skipped');
    expect(world.embeddings).toEqual([]);
  });

  it('never fails the write: a queued index that throws is logged and dropped', async () => {
    const entry = journeyRow('e3', { body: MY_FATHER });
    world.embedFails = true;
    expect(() => queueJourneyEntryIndex({ userId: ME }, entry.id)).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ entryId: entry.id });
    expect(world.embeddings).toEqual([]);
  });
});

describe('what a search never returns', () => {
  it('excludes an entry opted out after it was indexed, even before the prune catches its vector', async () => {
    const entry = journeyRow('e4', { body: MY_FATHER });
    await indexJourneyEntry({ userId: ME }, entry.id);
    expect(world.embeddings).toHaveLength(1);

    entry.withheldFromAgent = true;

    const hits = await searchMemory({ userId: ME }, MY_FATHER, { limit: 5 });
    expect(hits.map((h) => h.sourceId)).not.toContain(entry.id);
  });

  it('excludes an entry the person removed, its row and its vector gone together as the cascade does', async () => {
    const entry = journeyRow('e5', { body: MY_FATHER });
    await indexJourneyEntry({ userId: ME }, entry.id);
    expect(world.embeddings).toHaveLength(1);

    removeEntryCascade(entry.id);
    expect(world.embeddings).toEqual([]);

    const hits = await searchMemory({ userId: ME }, MY_FATHER, { limit: 5 });
    expect(hits.map((h) => h.sourceId)).not.toContain(entry.id);
  });

  it('never returns another person’s entry, even when theirs is the nearer match', async () => {
    const mine = journeyRow('mine', { body: MY_FATHER });
    const theirs = journeyRow('theirs', { userId: THEM, body: THEIR_FATHER });
    await indexJourneyEntry({ userId: ME }, mine.id);
    await indexJourneyEntry({ userId: THEM }, theirs.id);
    // The population is non-empty before this asserts absence: both are indexed.
    expect(world.embeddings).toHaveLength(2);

    // Querying with THEIR sentence word for word: the nearest vector in the
    // index is theirs, at distance zero, and it is still not mine to see.
    const hits = await searchMemory({ userId: ME }, THEIR_FATHER, { limit: 5 });
    expect(hits.map((h) => h.sourceId)).toEqual(['mine']);

    const theirHits = await searchMemory({ userId: THEM }, THEIR_FATHER, { limit: 5 });
    expect(theirHits.map((h) => h.sourceId)).toEqual(['theirs']);
  });
});

describe('forgetting a journey entry', () => {
  it('removes only the caller’s vector for that entry, and never another person’s id or another entry of theirs', async () => {
    const mine = journeyRow('shared-id', { body: MY_FATHER });
    const mineOther = journeyRow('mine-other', { body: 'a different entry entirely of mine' });
    await indexJourneyEntry({ userId: ME }, mine.id);
    await indexJourneyEntry({ userId: ME }, mineOther.id);
    expect(world.embeddings).toHaveLength(2);

    // Someone else's id against my entry removes nothing.
    expect(await forgetJourneyEntry({ userId: THEM }, mine.id)).toBe(0);
    expect(world.embeddings).toHaveLength(2);

    expect(await forgetJourneyEntry({ userId: ME }, mine.id)).toBe(1);
    expect(world.embeddings.map((e) => e.journeyEntryId)).toEqual(['mine-other']);
  });
});

describe('the backfill', () => {
  it('indexes a qualifying entry the queue missed, and prunes a vector whose entry stopped qualifying', async () => {
    const missed = journeyRow('missed-1', { body: MY_FATHER });
    const stale = journeyRow('stale-1', { body: 'a routine update about weekend plans' });
    await indexJourneyEntry({ userId: ME }, stale.id);
    expect(world.embeddings).toHaveLength(1);

    stale.withheldFromAgent = true;

    const result = await backfillMemoryIndex();

    expect(result).toEqual({ indexed: 1, failed: 0, forgotten: 1 });
    expect(world.embeddings.map((e) => e.journeyEntryId)).toEqual([missed.id]);
  });
});

describe('the same JOURNEY QUALIFIES lines in every journey statement', () => {
  it('carries the same three lines in every journey statement', () => {
    const source = readFileSync(join(process.cwd(), 'lib/app/memory/memory-index.ts'), 'utf8');
    const LINES = [
      `j.state::text = 'kept'`,
      'AND j."withheldFromAgent" = false',
      'AND j."sourceRemovedAt" IS NULL',
    ];
    const markers = source.match(/-- JOURNEY QUALIFIES/g) ?? [];
    // The single-row read, the insert, the backfill list, the prune (negated) and the search.
    expect(markers).toHaveLength(5);
    for (const line of LINES) {
      expect(source.split(line).length - 1, line).toBe(markers.length);
    }
  });
});

describe('journeyEntryText', () => {
  it('joins the line, the words and each outcome, one to a line', () => {
    const text = journeyEntryText({
      summary: 'The lake',
      body: 'We walked by the water.',
      outcomes: [
        { kind: 'action', text: 'Call him Sunday' },
        { kind: 'insight', text: 'He forgives easily' },
      ],
    });

    expect(text).toBe('The lake\nWe walked by the water.\nCall him Sunday\nHe forgives easily');
  });

  it('omits a null summary rather than leaving a blank line, for an own entry with no line', () => {
    const text = journeyEntryText({ summary: null, body: 'Just my own words.', outcomes: [] });

    expect(text).toBe('Just my own words.');
  });

  it('survives unreadable outcomes: they drop out, the entry’s line and words do not', () => {
    const text = journeyEntryText({
      summary: 'Title',
      body: 'Body text.',
      outcomes: [{ shape: 'not an outcome' }],
    });

    expect(text).toBe('Title\nBody text.');
  });
});
