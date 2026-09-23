/**
 * A small stateful Prisma stand-in for the content tables (f-content-seeds
 * t-91), so a test can run the REAL seed, the REAL admin service and the REAL
 * public route against one set of rows and watch an edit arrive.
 *
 * Unit tests here have no database (`B9`), and the admin services are exactly
 * the code whose correctness is in how its writes land together: a position
 * parked before another moves into it, a revision written beside every change,
 * a cascade on delete. A per-call mock proves none of that. This fake does
 * enough to: equality, `in`, `startsWith` and `NOT` in a `where`; `orderBy`; the
 * compound-unique lookups the services use; `include` of a set's questions; the
 * unique indexes an ordering write could break; the cascades the schema
 * declares; and a transaction that rolls back when its callback throws.
 *
 * It is not Prisma. `select` returns whole rows (callers read only what they
 * selected), and only the models the content admin touches exist.
 *
 * ```ts
 * const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
 * vi.mock('@/lib/db/client', () => ({ get prisma() { return db.current!.client; } }));
 * ```
 */

import { Prisma } from '@prisma/client';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

interface ModelSpec {
  /** The primary key column. */
  key: string;
  /** Unique indexes beyond the key, as column lists. */
  unique?: string[][];
  /** Compound-unique lookup names, as Prisma spells them, and their columns. */
  compound?: Record<string, string[]>;
  /** Defaults applied on create. */
  defaults?: () => Row;
  /** Rows elsewhere deleted with this one: [model, foreign key column]. */
  cascade?: [string, string][];
  /** Rows elsewhere that forbid deleting this one: [model, foreign key column]. */
  restrict?: [string, string][];
}

const revision = (parent: string): ModelSpec => ({
  key: 'id',
  unique: [[parent, 'revision']],
  compound: { [`${parent}_revision`]: [parent, 'revision'] },
  defaults: () => ({ changedAt: new Date() }),
});

const stamped = () => ({ createdAt: new Date(), updatedAt: new Date() });

const MODELS: Record<string, ModelSpec> = {
  appDocumentCollection: { key: 'id', defaults: stamped },
  appFoundationalDocument: {
    key: 'id',
    unique: [['collectionId', 'position']],
    defaults: () => ({ ...stamped(), revision: 1 }),
    cascade: [['appFoundationalDocumentRevision', 'documentId']],
    restrict: [['appResource', 'documentId']],
  },
  appFoundationalDocumentRevision: revision('documentId'),
  appJourney: { key: 'id', defaults: stamped },
  appJourneyTier: {
    key: 'id',
    defaults: () => ({ ...stamped(), revision: 1 }),
    cascade: [['appJourneyTierRevision', 'tierId']],
  },
  appJourneyTierRevision: revision('tierId'),
  appJourneyModule: {
    key: 'id',
    // What Postgres holds for a JSON column the seed writes `undefined` to.
    defaults: () => ({ ...stamped(), revision: 1, phaseTiers: null, produces: null }),
    cascade: [['appJourneyModuleRevision', 'moduleId']],
  },
  appJourneyModuleRevision: {
    ...revision('moduleId'),
    defaults: () => ({ changedAt: new Date(), phaseTiers: null, produces: null }),
  },
  appQuestionSet: {
    key: 'id',
    defaults: () => ({ ...stamped(), revision: 1 }),
    cascade: [['appQuestionSetRevision', 'setId']],
  },
  appQuestionSetRevision: revision('setId'),
  appDiscoveryQuestion: {
    key: 'id',
    unique: [['setId', 'number']],
    defaults: () => ({ ...stamped(), revision: 1, hint: null, conditionalFollowUp: null }),
    cascade: [['appDiscoveryQuestionRevision', 'questionId']],
  },
  appDiscoveryQuestionRevision: {
    ...revision('questionId'),
    defaults: () => ({ changedAt: new Date(), hint: null, conditionalFollowUp: null }),
  },
  appResourceCollection: { key: 'id', defaults: stamped },
  appResource: {
    key: 'id',
    unique: [['collectionId', 'kind', 'position']],
    defaults: () => ({
      ...stamped(),
      revision: 1,
      retired: false,
      relatesTo: null,
      duration: null,
      readingTime: null,
      href: null,
      documentId: null,
    }),
    cascade: [['appResourceRevision', 'resourceId']],
  },
  appResourceRevision: {
    ...revision('resourceId'),
    defaults: () => ({ changedAt: new Date(), retired: false }),
  },
  appResourceWords: {
    key: 'key',
    defaults: () => ({ ...stamped(), revision: 1 }),
    cascade: [['appResourceWordsRevision', 'wordsKey']],
  },
  appResourceWordsRevision: revision('wordsKey'),
  appAcknowledgement: { key: 'id', defaults: () => ({ acknowledgedAt: new Date() }) },
  user: { key: 'id' },
};

let sequence = 0;

/** The value a nullable JSON column holds after Prisma writes `DbNull`. */
function normalise(value: unknown): unknown {
  if (value === Prisma.DbNull || value === Prisma.JsonNull) return null;
  if (value === undefined) return undefined;
  return value instanceof Date ? new Date(value) : structuredClone(value);
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
}

function matches(row: Row, where: Where | undefined, spec: ModelSpec): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, condition]) => {
    if (field === 'NOT') return !matches(row, condition as Where, spec);
    if (field === 'OR') return (condition as Where[]).some((part) => matches(row, part, spec));
    if (field === 'AND') return (condition as Where[]).every((part) => matches(row, part, spec));
    const compound = spec.compound?.[field];
    if (compound) {
      return compound.every((column) => same(row[column], (condition as Row)[column]));
    }
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const test = condition as Record<string, unknown>;
      if ('in' in test) return (test.in as unknown[]).some((value) => same(row[field], value));
      if ('startsWith' in test) {
        return typeof row[field] === 'string' && row[field].startsWith(test.startsWith as string);
      }
      if ('not' in test) return !same(row[field], test.not);
    }
    return same(row[field], condition);
  });
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, 'asc' | 'desc'>[];
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const [field, direction] = Object.entries(key)[0];
      const x = a[field] as number | string | Date;
      const y = b[field] as number | string | Date;
      if (x < y) return direction === 'asc' ? -1 : 1;
      if (x > y) return direction === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

export function createContentDbFake() {
  let tables: Record<string, Row[]> = Object.fromEntries(
    Object.keys(MODELS).map((name) => [name, []])
  );

  const out = (row: Row | undefined): Row | null => (row ? structuredClone(row) : null);

  function checkUnique(model: string, candidate: Row, except?: Row) {
    const spec = MODELS[model];
    for (const columns of [[spec.key], ...(spec.unique ?? [])]) {
      const clash = tables[model].find(
        (row) => row !== except && columns.every((column) => same(row[column], candidate[column]))
      );
      if (clash) {
        throw new Error(`Unique constraint failed on ${model} (${columns.join(', ')})`);
      }
    }
  }

  function remove(model: string, row: Row) {
    const spec = MODELS[model];
    for (const [other, column] of spec.restrict ?? []) {
      if (tables[other].some((candidate) => candidate[column] === row[spec.key])) {
        throw new Error(`Foreign key constraint failed: ${other}.${column} restricts ${model}`);
      }
    }
    for (const [other, column] of spec.cascade ?? []) {
      for (const child of tables[other].filter(
        (candidate) => candidate[column] === row[spec.key]
      )) {
        remove(other, child);
      }
    }
    tables[model] = tables[model].filter((candidate) => candidate !== row);
  }

  function apply(row: Row, data: Row) {
    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[field] = normalise(value);
    }
  }

  function delegate(model: string) {
    const spec = MODELS[model];
    const rows = () => tables[model];
    const find = (where?: Where) => rows().filter((row) => matches(row, where, spec));

    const withInclude = (row: Row | null, include?: Record<string, unknown>) => {
      if (!row || !include) return row;
      if (model === 'appQuestionSet' && include.questions) {
        const nested = include.questions as { orderBy?: unknown };
        return {
          ...row,
          questions: sortRows(
            tables.appDiscoveryQuestion.filter((q) => q.setId === row.id),
            nested.orderBy
          ).map((q) => structuredClone(q)),
        };
      }
      return row;
    };

    return {
      findMany: async (args: { where?: Where; orderBy?: unknown } = {}) =>
        sortRows(find(args.where), args.orderBy).map((row) => structuredClone(row)),
      findFirst: async (args: { where?: Where; orderBy?: unknown } = {}) =>
        out(sortRows(find(args.where), args.orderBy)[0]),
      findUnique: async (args: { where: Where; include?: Record<string, unknown> }) =>
        withInclude(out(find(args.where)[0]), args.include),
      findUniqueOrThrow: async (args: { where: Where }) => {
        const row = find(args.where)[0];
        if (!row) throw new Error(`No ${model} found`);
        return structuredClone(row);
      },
      count: async (args: { where?: Where } = {}) => find(args.where).length,
      create: async (args: { data: Row }) => {
        const row: Row = { ...(spec.defaults?.() ?? {}) };
        if (spec.key === 'id' && args.data.id === undefined) row.id = `fake-${++sequence}`;
        apply(row, args.data);
        checkUnique(model, row);
        rows().push(row);
        return structuredClone(row);
      },
      createMany: async (args: { data: Row[] }) => {
        for (const data of args.data) {
          const row: Row = { ...(spec.defaults?.() ?? {}) };
          if (spec.key === 'id' && data.id === undefined) row.id = `fake-${++sequence}`;
          apply(row, data);
          checkUnique(model, row);
          rows().push(row);
        }
        return { count: args.data.length };
      },
      update: async (args: { where: Where; data: Row }) => {
        const row = find(args.where)[0];
        if (!row) throw new Error(`No ${model} to update`);
        const next = { ...row };
        apply(next, args.data);
        if ('updatedAt' in row && args.data.updatedAt === undefined)
          next.updatedAt = new Date(Date.now() + ++sequence);
        checkUnique(model, next, row);
        Object.assign(row, next);
        return structuredClone(row);
      },
      updateMany: async (args: { where: Where; data: Row }) => {
        const targets = find(args.where);
        for (const row of targets) {
          const next = { ...row };
          apply(next, args.data);
          if ('updatedAt' in row && args.data.updatedAt === undefined)
            next.updatedAt = new Date(Date.now() + ++sequence);
          checkUnique(model, next, row);
          Object.assign(row, next);
        }
        return { count: targets.length };
      },
      delete: async (args: { where: Where }) => {
        const row = find(args.where)[0];
        if (!row) throw new Error(`No ${model} to delete`);
        remove(model, row);
        return structuredClone(row);
      },
      deleteMany: async (args: { where?: Where } = {}) => {
        const targets = find(args.where);
        for (const row of targets) remove(model, row);
        return { count: targets.length };
      },
    };
  }

  const client: Record<string, unknown> = Object.fromEntries(
    Object.keys(MODELS).map((name) => [name, delegate(name)])
  );
  client.$transaction = async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    const saved = structuredClone(tables);
    try {
      return await (arg as (tx: unknown) => Promise<unknown>)(client);
    } catch (error) {
      tables = saved;
      throw error;
    }
  };

  return {
    /** Hand this to the code under test as its Prisma client. */
    client,
    /** The rows of one table, as stored (a copy). */
    rows: (model: keyof typeof MODELS) => structuredClone(tables[model]),
    /** Add rows directly, bypassing every service. */
    insert: (model: keyof typeof MODELS, ...rows: Row[]) => {
      for (const row of rows) tables[model].push({ ...(MODELS[model].defaults?.() ?? {}), ...row });
    },
    /** Every table, as a count, for "wrote nothing" assertions. */
    fingerprint: () => JSON.stringify(tables),
  };
}

export type ContentDbFake = ReturnType<typeof createContentDbFake>;
