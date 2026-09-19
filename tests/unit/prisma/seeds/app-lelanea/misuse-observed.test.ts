/**
 * The misuse seed: her guards observe, each seat escalates an attempt, and an
 * operator's later choice about either is never undone (f-safety t-60).
 *
 * ## `fp4` — both are operator-owned
 *
 * A guard mode is written only while the column is NULL. A policy is created
 * only when no escalation for that seat and guard exists, enabled or not. A
 * re-run against a current database writes nothing.
 *
 * ## Absence is only evidence over a non-empty population (`fp6`)
 *
 * Every "writes nothing" case asserts the first run's writes before the second
 * run's absence, so a seed that wrote nothing at all cannot pass it.
 *
 * A small stateful fake of the tables the unit touches; the transaction
 * forwards to the same fake (`B9`).
 *
 * @see prisma/seeds/app-lelanea/009-misuse-observed.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface AgentRow {
  id: string;
  slug: string;
  createdBy: string | null;
  deletedAt: Date | null;
  inputGuardMode: string | null;
  outputGuardMode: string | null;
}
interface VersionRow {
  agentId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changeSummary: string;
  createdBy: string;
}
interface PolicyRow {
  kind: string;
  payload: unknown;
  enabled: boolean;
  createdBy: string | null;
}

const world = {
  agents: [] as AgentRow[],
  versions: [] as VersionRow[],
  policies: [] as PolicyRow[],
};

vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Where = { id: string } & Partial<Record<'inputGuardMode' | 'outputGuardMode', null>>;

const client = {
  user: { findFirst: vi.fn(async () => ({ id: 'service-account' })) },
  aiAgent: {
    findFirst: vi.fn(
      async ({ where }: { where: { slug: string } }) =>
        world.agents.find((a) => a.slug === where.slug && a.deletedAt === null) ?? null
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<AgentRow> }) => {
      const rows = world.agents.filter(
        (a) =>
          a.id === where.id &&
          (!('inputGuardMode' in where) || a.inputGuardMode === null) &&
          (!('outputGuardMode' in where) || a.outputGuardMode === null)
      );
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = world.agents.find((a) => a.id === where.id);
      if (!row) throw new Error('not found');
      return {
        ...row,
        grantedTags: [] as { tagId: string }[],
        grantedDocuments: [] as { documentId: string }[],
      };
    }),
  },
  aiAgentVersion: {
    findFirst: vi.fn(async ({ where }: { where: { agentId: string } }) => {
      const rows = world.versions
        .filter((v) => v.agentId === where.agentId)
        .sort((a, b) => b.version - a.version);
      return rows[0] ? { version: rows[0].version } : null;
    }),
    create: vi.fn(async ({ data }: { data: VersionRow }) => {
      world.versions.push(data);
      return data;
    }),
  },
  facilitationPolicy: {
    findMany: vi.fn(async ({ where }: { where: { kind: string } }) =>
      world.policies.filter((p) => p.kind === where.kind)
    ),
    create: vi.fn(async ({ data }: { data: Omit<PolicyRow, 'enabled'> }) => {
      const row = { ...data, enabled: true };
      world.policies.push(row);
      return row;
    }),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
};

const { logger } = await import('@/lib/logging');
const unit = (await import('@/prisma/seeds/app-lelanea/009-misuse-observed')).default;
const { ESCALATION_POLICIES, GUARD_MODES_CHANGE_SUMMARY } = await import('@/lib/app/agent/pins');

function runSeed() {
  return unit.run({ prisma: client, logger } as unknown as Parameters<typeof unit.run>[0]);
}

function her(): AgentRow {
  const row = world.agents[0];
  if (!row) throw new Error('no agent');
  return row;
}

function writes(): number {
  return (
    client.aiAgent.updateMany.mock.calls.length +
    client.aiAgentVersion.create.mock.calls.length +
    client.facilitationPolicy.create.mock.calls.length
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  world.agents = [
    {
      id: 'agent-her',
      slug: 'lelanea-guide',
      createdBy: 'author',
      deletedAt: null,
      inputGuardMode: null,
      outputGuardMode: null,
    },
  ];
  world.versions = [];
  world.policies = [];
});

describe('a fresh install', () => {
  it('sets both her guards to observe, as an entry in her timeline', async () => {
    await runSeed();

    expect(her()).toMatchObject({ inputGuardMode: 'log_only', outputGuardMode: 'log_only' });
    expect(world.versions.map((v) => v.changeSummary)).toEqual([
      expect.any(String),
      GUARD_MODES_CHANGE_SUMMARY,
    ]);
    // The initial entry is her configuration BEFORE the write, so a restore to
    // it really does restore the unset guards.
    expect(world.versions[0]?.snapshot).toMatchObject({
      inputGuardMode: null,
      outputGuardMode: null,
    });
    expect(world.versions[1]?.snapshot).toMatchObject({
      inputGuardMode: 'log_only',
      outputGuardMode: 'log_only',
    });
  });

  it('creates one input-guard escalation per seat', async () => {
    await runSeed();

    expect(world.policies).toEqual(
      ESCALATION_POLICIES.map((payload) => ({
        kind: 'escalation',
        payload,
        enabled: true,
        createdBy: 'service-account',
      }))
    );
  });

  it('writes nothing on a re-run', async () => {
    await runSeed();
    expect(writes()).toBeGreaterThan(0);
    vi.clearAllMocks();

    await runSeed();

    expect(writes()).toBe(0);
    expect(world.policies).toHaveLength(ESCALATION_POLICIES.length);
  });
});

describe("an operator's choices", () => {
  it('leaves a guard an admin set to block, and fills only the one still unset', async () => {
    her().inputGuardMode = 'block';

    await runSeed();

    expect(her()).toMatchObject({ inputGuardMode: 'block', outputGuardMode: 'log_only' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"block"'));
  });

  it('writes no timeline entry when both guards were already chosen', async () => {
    her().inputGuardMode = 'warn_and_continue';
    her().outputGuardMode = 'log_only';

    await runSeed();

    expect(world.versions).toEqual([]);
    expect(client.aiAgent.updateMany).not.toHaveBeenCalled();
    // The policies are a separate decision and still land.
    expect(world.policies).toHaveLength(ESCALATION_POLICIES.length);
  });

  it('leaves an escalation an operator switched off, and does not add a second one beside it', async () => {
    const [first] = ESCALATION_POLICIES;
    if (!first) throw new Error('no policy to switch off');
    world.policies = [
      {
        kind: 'escalation',
        payload: { ...first, priority: 'high' },
        enabled: false,
        createdBy: 'operator',
      },
    ];

    await runSeed();

    const forSeat = world.policies.filter(
      (p) =>
        typeof p.payload === 'object' &&
        p.payload !== null &&
        'scope' in p.payload &&
        JSON.stringify(p.payload.scope) === JSON.stringify(first.scope)
    );
    expect(forSeat).toEqual([expect.objectContaining({ enabled: false, createdBy: 'operator' })]);
    expect(world.policies).toHaveLength(ESCALATION_POLICIES.length);
  });

  it('does not count a malformed policy as covering a seat', async () => {
    world.policies = [
      { kind: 'escalation', payload: { nonsense: true }, enabled: true, createdBy: null },
    ];

    await runSeed();

    expect(world.policies).toHaveLength(ESCALATION_POLICIES.length + 1);
  });
});

describe('safe on empty', () => {
  it('throws rather than banking success when her agent is missing', async () => {
    world.agents = [];

    await expect(runSeed()).rejects.toThrow(/no such agent/);
    expect(writes()).toBe(0);
  });
});
