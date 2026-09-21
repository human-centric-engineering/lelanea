/**
 * The resources seed: the `suggest_resource` row and the grant to the guide,
 * and an operator's later decision about either is never undone
 * (f-resources t-77).
 *
 * ## The row is two halves with two owners (#545, `fp4`)
 *
 * The code-owned half — `functionDefinition`, `executionType`,
 * `executionHandler` — is re-applied on every run, because a stale schema is
 * advertised to every model and MCP client. The operator-owned half — `name`,
 * `description`, `category`, `isActive`, `rateLimit` — is written once. The
 * `update` branch is read by Sunrise's `capability-code-owned-fields` test;
 * this file asserts the behaviour on a fake.
 *
 * ## The class and the seed say the same thing
 *
 * Sunrise's parity test pins each built-in's `functionDefinition` to its seed
 * constant, and reaches ours through the two-line divergence in
 * `capability-class-seed-parity.test.ts` (ledger Row 23). This file pins the
 * same pair directly, so the invariant holds even if that divergence is ever
 * lost on a sync.
 *
 * ## Absence is only evidence over a non-empty population (`fp6`)
 *
 * Every "a re-run writes nothing" case asserts the first run's writes first.
 *
 * @see prisma/seeds/app-lelanea/014-suggest-resource.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface CapabilityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  isActive: boolean;
  rateLimit: number;
  isSystem: boolean;
  executionType: string;
  executionHandler: string;
  functionDefinition: unknown;
}

interface GrantRow {
  agentId: string;
  capabilityId: string;
  isEnabled: boolean;
}

const world = {
  agents: [] as { id: string; slug: string; deletedAt: Date | null }[],
  capabilities: [] as CapabilityRow[],
  grants: [] as GrantRow[],
};

vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const client = {
  aiCapability: {
    upsert: vi.fn(
      async ({
        where,
        update,
        create,
      }: {
        where: { slug: string };
        update: Partial<CapabilityRow>;
        create: Omit<CapabilityRow, 'id'>;
      }) => {
        const existing = world.capabilities.find((c) => c.slug === where.slug);
        if (existing) {
          Object.assign(existing, update);
          return { id: existing.id };
        }
        const row = { id: `cap-${world.capabilities.length + 1}`, ...create };
        world.capabilities.push(row);
        return { id: row.id };
      }
    ),
  },
  aiAgent: {
    findFirst: vi.fn(
      async ({ where }: { where: { slug: string } }) =>
        world.agents.find((a) => a.slug === where.slug && a.deletedAt === null) ?? null
    ),
  },
  aiAgentCapability: {
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { agentId_capabilityId: { agentId: string; capabilityId: string } };
      }) =>
        world.grants.find(
          (g) =>
            g.agentId === where.agentId_capabilityId.agentId &&
            g.capabilityId === where.agentId_capabilityId.capabilityId
        ) ?? null
    ),
    create: vi.fn(async ({ data }: { data: { agentId: string; capabilityId: string } }) => {
      const grant = { ...data, isEnabled: true };
      world.grants.push(grant);
      return grant;
    }),
  },
};

const { logger } = await import('@/lib/logging');
const unit = (await import('@/prisma/seeds/app-lelanea/014-suggest-resource')).default;
const { SUGGEST_RESOURCE_IMPL } = await import('@/prisma/seeds/app-lelanea/014-suggest-resource');
const { SuggestResourceCapability, SUGGEST_RESOURCE_DEFINITION } =
  await import('@/lib/app/resources/suggest');
const { RESOURCE_CAPABILITY_SLUGS } = await import('@/lib/app/agent/pins');
const { VOICE_AGENT_SLUG } = await import('@/lib/app/voice/fingerprint');

async function runSeed(): Promise<void> {
  await unit.run({ prisma: client as never, logger });
}

const HER_ID = 'agent-guide';

beforeEach(() => {
  vi.clearAllMocks();
  world.agents = [{ id: HER_ID, slug: VOICE_AGENT_SLUG, deletedAt: null }];
  world.capabilities = [];
  world.grants = [];
});

describe('the class and the seed', () => {
  it('advertise the same tool', () => {
    expect(SUGGEST_RESOURCE_IMPL.functionDefinition).toEqual(
      new SuggestResourceCapability().functionDefinition
    );
    expect(SUGGEST_RESOURCE_IMPL.functionDefinition).toEqual(SUGGEST_RESOURCE_DEFINITION);
    expect(SUGGEST_RESOURCE_IMPL.executionHandler).toBe(SuggestResourceCapability.name);
    expect(SUGGEST_RESOURCE_IMPL.functionDefinition.name).toBe('suggest_resource');
  });

  it('is the slug the roster grants, and nothing else', () => {
    expect([...RESOURCE_CAPABILITY_SLUGS]).toEqual(['suggest_resource']);
  });
});

describe('the row', () => {
  it('is created active, as a system capability, with the definition', async () => {
    await runSeed();

    expect(world.capabilities).toHaveLength(1);
    const row = world.capabilities[0];
    expect(row.slug).toBe('suggest_resource');
    expect(row.isSystem).toBe(true);
    expect(row.isActive).toBe(true);
    expect(row.functionDefinition).toEqual(SUGGEST_RESOURCE_IMPL.functionDefinition);
    expect(row.executionHandler).toBe('SuggestResourceCapability');
  });

  it('re-applies the code-owned fields and leaves the operator-owned ones alone', async () => {
    await runSeed();
    const row = world.capabilities[0];
    // An operator renamed it, switched it off, and something stale is on the
    // code-owned half.
    row.name = 'Renamed by an operator';
    row.isActive = false;
    row.rateLimit = 5;
    row.functionDefinition = { name: 'suggest_resource', description: 'stale', parameters: {} };

    await runSeed();

    expect(world.capabilities).toHaveLength(1);
    expect(row.functionDefinition).toEqual(SUGGEST_RESOURCE_IMPL.functionDefinition);
    expect(row.name).toBe('Renamed by an operator');
    expect(row.isActive).toBe(false);
    expect(row.rateLimit).toBe(5);
  });
});

describe('the grant', () => {
  it('binds the tool to the guide, switched on, with no config', async () => {
    await runSeed();

    expect(world.grants).toEqual([
      { agentId: HER_ID, capabilityId: world.capabilities[0].id, isEnabled: true },
    ]);
  });

  it('writes nothing on a re-run', async () => {
    await runSeed();
    expect(world.grants).toHaveLength(1);
    client.aiAgentCapability.create.mockClear();

    await runSeed();

    expect(client.aiAgentCapability.create).not.toHaveBeenCalled();
    expect(world.grants).toHaveLength(1);
  });

  it("leaves an operator's switch-off alone", async () => {
    await runSeed();
    world.grants[0].isEnabled = false;

    await runSeed();

    expect(world.grants).toHaveLength(1);
    expect(world.grants[0].isEnabled).toBe(false);
  });

  it('throws when the guide does not exist, rather than banking a grant that was not made', async () => {
    world.agents = [];

    await expect(runSeed()).rejects.toThrow(/no such agent/);
    expect(world.grants).toEqual([]);
  });
});
