/**
 * A Prisma fake for the notes store, shared by the store's own tests and the
 * route's query tests (f-slots t-73, t-79).
 *
 * Daybreak's value engine (`appendSlotValue`, `getSlotHeads`) and its
 * definition queries run for REAL against it, because the guarantees under test
 * — hidden slots withheld, one person's notes not another's — are properties of
 * those queries. The fake therefore honours the `where` clauses those functions
 * actually send, and nothing else: an unrecognised filter throws rather than
 * being ignored, so a query this file does not model fails loudly instead of
 * matching everything.
 *
 * Wire it with:
 *
 * ```ts
 * vi.mock('@/lib/db/client', async () => ({
 *   prisma: (await import('@/tests/unit/lib/app/slots/notes-fake')).prismaFake,
 * }));
 * ```
 *
 * and call {@link resetWorld} in a `beforeEach`.
 */

import { vi } from 'vitest';

export const ME = 'cmjbv4i3x00003wsloputgwul';
export const THEM = 'cmu7other0000000000000000';

export interface ValueRow {
  id: string;
  userId: string;
  slotSlug: string;
  version: number;
  value: string;
  valueJson?: unknown;
  confidence: number;
  sourceType: string;
  reasoningNote: string;
  provenance: unknown;
  supersededAt: Date | null;
  capturedAt: Date;
}

export interface DefinitionRow {
  slug: string;
  group: string;
  description: string;
  scope: string;
  visibility: string;
  mode: string;
  dataType: string;
  sensitivity: string;
  priorityWeight: number;
  isActive: boolean;
}

export const world = {
  values: [] as ValueRow[],
  /** Daybreak's projection — the row `fill_slot` judges a slot by. */
  projections: [] as DefinitionRow[],
  /** Ours — the taxonomy an admin edits. Only `visibility` is read from it. */
  ours: [] as { slug: string; visibility: string; sensitivity?: string }[],
  /** `app_turn_slot_write`, with the turn's owner flattened onto each row. */
  ledger: [] as { turnId: string; userId: string; slotSlug: string; version: number }[],
  /** `app_turn`: what locates a turn's messages (t-127). `id` is what the ledger's `turnId` names. */
  turns: [] as TurnRow[],
  /** `ai_message`, with the conversation's owner flattened onto each row (t-127). */
  messages: [] as MessageRow[],
  /** `ai_conversation`: only what an exchange deletion clears (t-127). */
  conversations: [] as ConversationRow[],
  /** `app_journey_entry`: what keeping a synopsis and deleting an exchange touch (t-147). */
  entries: [] as EntryRow[],
  nextId: 0,
};

export interface EntryRow {
  id: string;
  userId: string;
  kind: 'synopsis' | 'own';
  state: 'draft' | 'kept';
  sessionId: string | null;
  summary: string | null;
  body: string;
  outcomes: unknown;
  modules: string[];
  notes: unknown;
  withheldFromAgent: boolean;
  occurredAt: Date;
  keptAt: Date | null;
  regenerations: number;
  sourceRemovedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  orgId: string | null;
}

/** The columns a journey entry `where` may name, each by equality or `{ in }` (t-147). */
const ENTRY_WHERE = new Set([
  'id',
  'userId',
  'kind',
  'state',
  'sessionId',
  'updatedAt',
  'regenerations',
  'sourceRemovedAt',
]);

function entryMatches(row: EntryRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (!ENTRY_WHERE.has(key)) throw new Error(`the fake does not model ${key} on an entry`);
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (condition instanceof Date) {
      return actual instanceof Date && actual.getTime() === condition.getTime();
    }
    if (condition !== null && typeof condition === 'object') {
      const operators = condition as Record<string, unknown>;
      if (Object.keys(operators).join() === 'in') {
        return (operators.in as unknown[]).includes(actual);
      }
      throw new Error(`the fake does not model ${JSON.stringify(condition)} on ${key}`);
    }
    return actual === condition;
  });
}

/** The columns keeping, regenerating and settling a deletion write (t-147). */
const ENTRY_WRITES = new Set([
  'state',
  'keptAt',
  'summary',
  'body',
  'outcomes',
  'notes',
  'regenerations',
  'sourceRemovedAt',
]);

export interface TurnRow {
  id: string;
  userId: string;
  turnId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  conversationId: string | null;
  userMessageId: string | null;
  /** The session it was taken in (t-147); null for a turn from before sessions. */
  sessionId?: string | null;
}

export interface ConversationRow {
  id: string;
  userId: string;
  title: string | null;
  summary: string | null;
  summaryUpToMessageId: string | null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  /** The conversation's owner, which `conversation: { userId }` filters on. */
  ownerId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: Date;
}

/**
 * A message `where`, applied honestly: the shapes `turn-record.ts` and
 * `delete-exchange.ts` send, and nothing else.
 */
function messageMatches(row: MessageRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'conversation') {
      return row.ownerId === (condition as { userId: string }).userId;
    }
    if (key === 'id' && typeof condition === 'object' && condition !== null) {
      const op = condition as { in?: string[]; not?: string };
      if (op.in) return op.in.includes(row.id);
      if (op.not !== undefined) return row.id !== op.not;
    }
    if (key === 'createdAt' && typeof condition === 'object' && condition !== null) {
      const op = condition as { gt?: Date; gte?: Date; lt?: Date; lte?: Date };
      const known = ['gt', 'gte', 'lt', 'lte'];
      if (Object.keys(op).some((k) => !known.includes(k))) {
        throw new Error(`the fake does not model ${JSON.stringify(condition)} on createdAt`);
      }
      const t = row.createdAt.getTime();
      return (
        (op.gt === undefined || t > op.gt.getTime()) &&
        (op.gte === undefined || t >= op.gte.getTime()) &&
        (op.lt === undefined || t < op.lt.getTime()) &&
        (op.lte === undefined || t <= op.lte.getTime())
      );
    }
    if (typeof condition === 'object' && condition !== null) {
      throw new Error(`the fake does not model ${JSON.stringify(condition)} on ${key}`);
    }
    return (row as unknown as Record<string, unknown>)[key] === condition;
  });
}

/**
 * A `where` this fake understands, applied honestly.
 *
 * Deliberately strict: an operator it does not model throws, so a query added
 * to `notes.ts` later cannot silently match every row and turn a real filter
 * into a passing test.
 */
function matches(row: ValueRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      const clauses = condition as Record<string, unknown>[];
      return clauses.some((clause) => matches(row, clause));
    }
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (condition === null) return actual === null;
    if (typeof condition === 'object') {
      const operators = condition as Record<string, unknown>;
      if ('in' in operators) return (operators.in as unknown[]).includes(actual);
      // The removal's "every version not already a placeholder" (t-78).
      if ('not' in operators && Object.keys(operators).length === 1) {
        return actual !== operators.not;
      }
      throw new Error(`the fake does not model ${JSON.stringify(condition)} on ${key}`);
    }
    return actual === condition;
  });
}

export const prismaFake = {
  /**
   * The conversation sweep's one raw query (t-128): our turns whose
   * conversation is gone, distinct by conversation, up to the bound limit. The
   * fake cannot run SQL, so it answers that one question from the world and
   * records the bound values for the test to assert on. The smoke runs the SQL.
   */
  $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    // Bound in order: the org, the ids given up on, the limit.
    const given = new Set(values[1] as string[]);
    const limit = values[2] as number;
    const live = new Set([...world.conversations.map((row) => row.id), ...given]);
    const gone = [
      ...new Set(
        world.turns
          .map((row) => row.conversationId)
          .filter((id): id is string => id !== null && !live.has(id))
      ),
    ];
    return gone.slice(0, limit).map((conversationId) => ({ conversationId }));
  }),
  slotValue: {
    findMany: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: { capturedAt?: string; slotSlug?: string }[];
      }) => {
        const rows = world.values.filter((row) => matches(row, where));
        if (orderBy) {
          // `getSlotHeads` orders freshest first, then slug — and the panel's "the
          // note the agent just wrote is at the top of its group" depends on it.
          rows.sort(
            (a, b) =>
              b.capturedAt.getTime() - a.capturedAt.getTime() ||
              a.slotSlug.localeCompare(b.slotSlug)
          );
        }
        return rows.map((row) => ({ ...row }));
      }
    ),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const rows = world.values
        .filter((row) => matches(row, where))
        .sort((a, b) => b.version - a.version);
      return rows[0] ? { ...rows[0] } : null;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: { supersededAt: Date } }) => {
        const row = world.values.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('no such row');
        row.supersededAt = data.supersededAt;
        return { ...row };
      }
    ),
    // The removal's one write (t-78): every matching row overwritten with the
    // same fields. Only the fields a removal sends are modelled; anything else
    // throws, so a later write cannot quietly pass through as a no-op.
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const allowed = new Set([
          'value',
          'valueJson',
          'confidence',
          'sourceType',
          'reasoningNote',
          'provenance',
          'capturedAt',
          'slotSlug',
        ]);
        for (const key of Object.keys(data)) {
          if (!allowed.has(key)) throw new Error(`the fake does not model writing ${key}`);
        }
        const rows = world.values.filter((row) => matches(row, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      }
    ),
    count: vi.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        world.values.filter((row) => matches(row, where)).length
    ),
    create: vi.fn(async ({ data }: { data: Omit<ValueRow, 'id' | 'supersededAt'> }) => {
      const row: ValueRow = { id: `v${++world.nextId}`, supersededAt: null, ...data };
      world.values.push(row);
      return { ...row };
    }),
  },
  appTurnSlotWrite: {
    // The panel's exchange read (t-127): `{ slotSlug: { in }, turn: { userId } }`,
    // oldest first. The ledger is kept in write order, so insertion order is it.
    findMany: vi.fn(
      async ({ where }: { where: { slotSlug: { in: string[] }; turn: { userId: string } } }) => {
        if (Object.keys(where).sort().join() !== 'slotSlug,turn' || !where.slotSlug.in) {
          throw new Error(`the fake does not model ${JSON.stringify(where)}`);
        }
        return world.ledger
          .filter(
            (row) => where.slotSlug.in.includes(row.slotSlug) && row.userId === where.turn.userId
          )
          .map((row) => ({ slotSlug: row.slotSlug, turnId: row.turnId }));
      }
    ),
    // The removal's ledger move (t-78): `{ slotSlug, turn: { userId } }` and
    // nothing else, so a later query of another shape fails loudly.
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { slotSlug: string; turn: { userId: string } };
        data: { slotSlug: string };
      }) => {
        if (Object.keys(where).sort().join() !== 'slotSlug,turn' || !where.turn.userId) {
          throw new Error(`the fake does not model ${JSON.stringify(where)}`);
        }
        const rows = world.ledger.filter(
          (row) => row.slotSlug === where.slotSlug && row.userId === where.turn.userId
        );
        for (const row of rows) row.slotSlug = data.slotSlug;
        return { count: rows.length };
      }
    ),
  },
  appTurn: {
    // The exchange deletion's read (t-127): `{ id: { in }, userId }`; and the
    // conversation deletion's (t-128): `{ conversationId: { in } }`, with or
    // without `userId`. Each with its ledger rows as `slotWrites`.
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          id?: { in: string[] };
          conversationId?: { in: string[] };
          userId?: string;
        };
      }) => {
        const keys = Object.keys(where).sort().join();
        const byId = keys === 'id,userId' && where.id?.in;
        const byConversation =
          (keys === 'conversationId' || keys === 'conversationId,userId') &&
          where.conversationId?.in;
        if (!byId && !byConversation) {
          throw new Error(`the fake does not model ${JSON.stringify(where)}`);
        }
        return world.turns
          .filter((row) =>
            byId
              ? where.id!.in.includes(row.id) && row.userId === where.userId
              : row.conversationId !== null &&
                where.conversationId!.in.includes(row.conversationId) &&
                (where.userId === undefined || row.userId === where.userId)
          )
          .map((row) => ({
            ...row,
            sessionId: row.sessionId ?? null,
            slotWrites: world.ledger
              .filter((write) => write.turnId === row.id)
              .map((write) => ({ slotSlug: write.slotSlug, version: write.version })),
          }));
      }
    ),
    // And its delete, which cascades to the ledger as the FK does. The
    // conversation deletion (t-128) also narrows to turns still pointing at a
    // deleted conversation.
    deleteMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          id: { in: string[] };
          userId: string;
          conversationId?: { in: string[] };
        };
      }) => {
        const keys = Object.keys(where).sort().join();
        if (
          !where.id.in ||
          (keys !== 'id,userId' &&
            !(keys === 'conversationId,id,userId' && where.conversationId?.in))
        ) {
          throw new Error(`the fake does not model ${JSON.stringify(where)}`);
        }
        const gone = world.turns.filter(
          (row) =>
            where.id.in.includes(row.id) &&
            row.userId === where.userId &&
            (!where.conversationId ||
              (row.conversationId !== null && where.conversationId.in.includes(row.conversationId)))
        );
        const ids = new Set(gone.map((row) => row.id));
        world.turns = world.turns.filter((row) => !ids.has(row.id));
        world.ledger = world.ledger.filter((row) => !ids.has(row.turnId));
        return { count: gone.length };
      }
    ),
  },
  aiConversation: {
    // Which of these conversations still exist (t-128): `{ id: { in } }` only.
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
      if (Object.keys(where).join() !== 'id' || !where.id.in) {
        throw new Error(`the fake does not model ${JSON.stringify(where)}`);
      }
      return world.conversations
        .filter((row) => where.id.in.includes(row.id))
        .map((row) => ({ id: row.id }));
    }),
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      if (Object.keys(where).sort().join() !== 'id,userId') {
        throw new Error(`the fake does not model ${JSON.stringify(where)}`);
      }
      const row = world.conversations.find(
        (candidate) => candidate.id === where.id && candidate.userId === where.userId
      );
      return row ? { ...row } : null;
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; userId: string };
        data: Partial<Omit<ConversationRow, 'id' | 'userId'>>;
      }) => {
        const allowed = new Set(['title', 'summary', 'summaryUpToMessageId']);
        for (const key of Object.keys(data)) {
          if (!allowed.has(key)) throw new Error(`the fake does not model writing ${key}`);
        }
        const rows = world.conversations.filter(
          (row) => row.id === where.id && row.userId === where.userId
        );
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      }
    ),
  },
  aiMessage: {
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: { createdAt: 'asc' | 'desc' };
      }) => {
        const rows = world.messages.filter((row) => messageMatches(row, where));
        rows.sort((a, b) =>
          orderBy?.createdAt === 'desc'
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime()
        );
        return rows[0] ? { ...rows[0] } : null;
      }
    ),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      world.messages.filter((row) => messageMatches(row, where)).map((row) => ({ ...row }))
    ),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const gone = world.messages.filter((row) => messageMatches(row, where));
      const ids = new Set(gone.map((row) => row.id));
      world.messages = world.messages.filter((row) => !ids.has(row.id));
      return { count: gone.length };
    }),
  },
  appJourneyEntry: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = world.entries.find((candidate) => entryMatches(candidate, where));
      return row ? { ...row } : null;
    }),
    // Every conditional write keeping makes (t-147). `regenerations` takes a
    // number or Prisma's `{ increment | decrement: 1 }`; `updatedAt` moves on,
    // as `@updatedAt` does, so a later write conditional on it misses.
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        for (const key of Object.keys(data)) {
          if (!ENTRY_WRITES.has(key)) throw new Error(`the fake does not model writing ${key}`);
        }
        const rows = world.entries.filter((row) => entryMatches(row, where));
        for (const row of rows) {
          for (const [key, next] of Object.entries(data)) {
            if (key === 'regenerations' && typeof next === 'object' && next !== null) {
              const step = next as { increment?: number; decrement?: number };
              row.regenerations += (step.increment ?? 0) - (step.decrement ?? 0);
            } else {
              (row as unknown as Record<string, unknown>)[key] = next;
            }
          }
          row.updatedAt = new Date(row.updatedAt.getTime() + 1);
        }
        return { count: rows.length };
      }
    ),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const gone = world.entries.filter((row) => entryMatches(row, where));
      world.entries = world.entries.filter((row) => !gone.includes(row));
      return { count: gone.length };
    }),
  },
  slotDefinition: {
    findMany: vi.fn(async () => world.projections.map((row) => ({ ...row }))),
    findFirst: vi.fn(async ({ where }: { where: { slug: string } }) => {
      const row = world.projections.find((candidate) => candidate.slug === where.slug);
      return row ? { ...row } : null;
    }),
  },
  appSlotDefinition: {
    // Honours the ONE shape `ourVerdicts()` sends — an OR of equality clauses —
    // and throws on anything else, for the reason `matches()` above does: a
    // query added later must fail loudly rather than match every row.
    findMany: vi.fn(
      async ({ where }: { where: { OR?: Record<string, string>[]; slug?: { in: string[] } } }) => {
        // The exchange deletion's "which of these slugs are ours" (t-127).
        if (where.slug?.in && Object.keys(where).length === 1) {
          const wanted = where.slug.in;
          return world.ours.filter((row) => wanted.includes(row.slug)).map((row) => ({ ...row }));
        }
        if (!where.OR) throw new Error(`the fake does not model ${JSON.stringify(where)}`);
        const clauses = where.OR;
        return world.ours
          .filter((row) =>
            clauses.some((clause) =>
              Object.entries(clause).every(
                ([key, want]) => (row as Record<string, string | undefined>)[key] === want
              )
            )
          )
          .map((row) => ({ sensitivity: 'standard', ...row }));
      }
    ),
    findFirst: vi.fn(async ({ where }: { where: { slug: string } }) => {
      const row = world.ours.find((candidate) => candidate.slug === where.slug);
      return row ? { ...row } : null;
    }),
  },
};

export function definition(slug: string, overrides: Partial<DefinitionRow> = {}): DefinitionRow {
  return {
    slug,
    group: 'life_areas',
    description: `What ${slug} looks like for this person.`,
    scope: 'global',
    visibility: 'open',
    mode: 'targeted',
    dataType: 'text',
    sensitivity: 'standard',
    priorityWeight: 50,
    isActive: true,
    ...overrides,
  };
}

let clock = 0;
export function value(
  userId: string,
  slotSlug: string,
  overrides: Partial<ValueRow> = {}
): ValueRow {
  clock += 1000;
  return {
    id: `v${++world.nextId}`,
    userId,
    slotSlug,
    version: 1,
    value: `something about ${slotSlug}`,
    confidence: 6,
    sourceType: 'inferred',
    reasoningNote: 'Put together from what was said.',
    provenance: { conversationId: 'conv-1' },
    supersededAt: null,
    capturedAt: new Date(clock),
    ...overrides,
  };
}

/** A session's synopsis, a draft unless said otherwise (t-147). */
export function synopsisEntry(overrides: Partial<EntryRow> = {}): EntryRow {
  const at = new Date('2026-10-01T09:00:00.000Z');
  return {
    id: `cmentry${String(++world.nextId).padStart(18, '0')}`,
    userId: ME,
    kind: 'synopsis',
    state: 'draft',
    sessionId: 'ses_one',
    summary: 'Where the work came from',
    body: 'You talked about the shop.',
    outcomes: [],
    modules: [],
    notes: [],
    withheldFromAgent: false,
    occurredAt: at,
    keptAt: null,
    regenerations: 0,
    sourceRemovedAt: null,
    createdAt: at,
    updatedAt: at,
    orgId: 'install',
    ...overrides,
  };
}

/** Empty the world and rewind the clock. */
export function resetWorld(): void {
  world.values = [];
  world.projections = [];
  world.ours = [];
  world.ledger = [];
  world.turns = [];
  world.messages = [];
  world.conversations = [];
  world.entries = [];
  world.nextId = 0;
  clock = 0;
}
