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
  nextId: 0,
};

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
          // `getSlotHeads` orders freshest first, then slug — and the panel's
          // "the note she just wrote is at the top of its group" depends on it.
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
    create: vi.fn(async ({ data }: { data: Omit<ValueRow, 'id' | 'supersededAt'> }) => {
      const row: ValueRow = { id: `v${++world.nextId}`, supersededAt: null, ...data };
      world.values.push(row);
      return { ...row };
    }),
  },
  slotDefinition: {
    findMany: vi.fn(async () => world.projections.map((row) => ({ ...row }))),
    findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
      const row = world.projections.find((candidate) => candidate.slug === where.slug);
      return row ? { ...row } : null;
    }),
  },
  appSlotDefinition: {
    // Honours the ONE shape `ourVerdicts()` sends — an OR of equality clauses —
    // and throws on anything else, for the reason `matches()` above does: a
    // query added later must fail loudly rather than match every row.
    findMany: vi.fn(async ({ where }: { where: { OR?: Record<string, string>[] } }) => {
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
    }),
    findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
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
    reasoningNote: 'She put this together from what was said.',
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
  world.nextId = 0;
  clock = 0;
}
