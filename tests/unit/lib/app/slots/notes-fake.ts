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
  nextId: 0,
};

export interface TurnRow {
  id: string;
  userId: string;
  turnId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  conversationId: string | null;
  userMessageId: string | null;
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
    // The exchange deletion's read (t-127): `{ id: { in }, userId }`, with its
    // ledger rows as `slotWrites`.
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; userId: string } }) => {
      if (Object.keys(where).sort().join() !== 'id,userId' || !where.id.in) {
        throw new Error(`the fake does not model ${JSON.stringify(where)}`);
      }
      return world.turns
        .filter((row) => where.id.in.includes(row.id) && row.userId === where.userId)
        .map((row) => ({
          ...row,
          slotWrites: world.ledger
            .filter((write) => write.turnId === row.id)
            .map((write) => ({ slotSlug: write.slotSlug, version: write.version })),
        }));
    }),
    // And its delete, which cascades to the ledger as the FK does.
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; userId: string } }) => {
      if (Object.keys(where).sort().join() !== 'id,userId' || !where.id.in) {
        throw new Error(`the fake does not model ${JSON.stringify(where)}`);
      }
      const gone = world.turns.filter(
        (row) => where.id.in.includes(row.id) && row.userId === where.userId
      );
      const ids = new Set(gone.map((row) => row.id));
      world.turns = world.turns.filter((row) => !ids.has(row.id));
      world.ledger = world.ledger.filter((row) => !ids.has(row.turnId));
      return { count: gone.length };
    }),
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

/** Empty the world and rewind the clock. */
export function resetWorld(): void {
  world.values = [];
  world.projections = [];
  world.ours = [];
  world.ledger = [];
  world.turns = [];
  world.messages = [];
  world.nextId = 0;
  clock = 0;
}
