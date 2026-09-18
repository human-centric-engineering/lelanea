/**
 * The seat seed: which seats it fills, and the one it must leave alone.
 *
 * ## `fp4` — a projection limited to the seats it owns, filling only empty ones
 *
 * A seat holds one agent (`@@unique([role])`), and reassigning it is an unbind
 * plus a rebind. So a seat already held by ANOTHER agent is a binding this seed
 * did not create, and taking it back would mean deleting an operator's row on
 * every re-run. It is reported and left alone; so are the four seats outside
 * `SEATED_ROLES`, which this unit never reads.
 *
 * ## Absence is only evidence over a non-empty population (`fp6`)
 *
 * "The other agent's binding survived" passes for free against a seed that bound
 * nobody. The case below asserts the OTHER seat was filled in the same run first.
 *
 * The binding service and its read are mocked at the module boundary, as
 * `journey-map.test.ts` mocks the map services: they use the app's own Prisma
 * client rather than the seed context's, and no unit test can reach a database
 * (`B9`). That the real service accepts these roles and writes the row is what the
 * dev-database smoke in the PR proves.
 *
 * @see prisma/seeds/app-lelanea/006-agent-seats.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FakeBinding {
  id: string;
  role: string;
  agentId: string;
  agent: { slug: string } | null;
}

const world = {
  users: [{ id: 'service-account', accountType: 'SERVICE' }],
  agents: [] as { id: string; slug: string; deletedAt: Date | null }[],
  bindings: [] as FakeBinding[],
};

const getFacilitationBindingByRole = vi.fn(
  async (role: string) => world.bindings.find((binding) => binding.role === role) ?? null
);
const bindFacilitationAgent = vi.fn(
  async ({ agentId, role }: { agentId: string; role: string; userId: string }) => {
    if (world.bindings.some((binding) => binding.role === role)) {
      // What the real service does on the unique index.
      throw new Error('That facilitation seat is already bound to an agent');
    }
    const binding = { id: `binding-${world.bindings.length + 1}`, role, agentId, agent: null };
    world.bindings.push(binding);
    return binding;
  }
);

vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/framework/facilitation/agents/binding-service', () => ({ bindFacilitationAgent }));
vi.mock('@/lib/framework/facilitation/agents/binding-queries', () => ({
  getFacilitationBindingByRole,
}));

const prisma = {
  user: {
    findFirst: vi.fn(
      async ({ where }: { where: { accountType: string } }) =>
        world.users.find((user) => user.accountType === where.accountType) ?? null
    ),
  },
  aiAgent: {
    findFirst: vi.fn(
      async ({ where }: { where: { slug: string; deletedAt: null } }) =>
        world.agents.find((agent) => agent.slug === where.slug && agent.deletedAt === null) ?? null
    ),
  },
};

const { logger } = await import('@/lib/logging');
const unit = (await import('@/prisma/seeds/app-lelanea/006-agent-seats')).default;
const { SEATED_ROLES } = await import('@/lib/app/agent/pins');
const { VOICE_AGENT_SLUG } = await import('@/lib/app/voice/fingerprint');
const { FACILITATION_ROLES, isFacilitationRole } =
  await import('@/lib/framework/facilitation/agents/roles');

async function runSeed(): Promise<void> {
  await unit.run({ prisma: prisma as never, logger: logger });
}

const HER_ID = 'agent-hers';

function seat(role: string): FakeBinding | undefined {
  return world.bindings.find((binding) => binding.role === role);
}

beforeEach(() => {
  vi.clearAllMocks();
  world.agents = [{ id: HER_ID, slug: VOICE_AGENT_SLUG, deletedAt: null }];
  world.bindings = [];
});

describe('the seats this seed owns', () => {
  it('are the facilitator and onboarding seats, both real seats in Daybreak’s vocabulary', () => {
    expect([...SEATED_ROLES].sort()).toEqual(
      [FACILITATION_ROLES.facilitator, FACILITATION_ROLES.onboarding].sort()
    );
    // The binding service is mocked here, so its own seat check is not running:
    // a role it would reject has to be caught against the real vocabulary.
    for (const role of SEATED_ROLES) expect(isFacilitationRole(role)).toBe(true);
  });
});

describe('a fresh install', () => {
  it('binds her to both seats, as the service account', async () => {
    await runSeed();

    for (const role of SEATED_ROLES) expect(seat(role)?.agentId).toBe(HER_ID);
    expect(world.bindings).toHaveLength(SEATED_ROLES.length);
    expect(bindFacilitationAgent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'service-account' })
    );
  });

  it('fills no seat outside the two it owns', async () => {
    await runSeed();

    const others = Object.values(FACILITATION_ROLES).filter((role) => !SEATED_ROLES.includes(role));
    // Population: there ARE other seats, and the run DID bind.
    expect(others.length).toBeGreaterThan(0);
    expect(world.bindings.length).toBeGreaterThan(0);

    for (const role of others) {
      expect(seat(role)).toBeUndefined();
      expect(getFacilitationBindingByRole).not.toHaveBeenCalledWith(role);
    }
  });
});

describe('a re-run', () => {
  it('binds nothing a second time', async () => {
    await runSeed();
    expect(bindFacilitationAgent).toHaveBeenCalledTimes(SEATED_ROLES.length);
    bindFacilitationAgent.mockClear();

    await runSeed();

    expect(bindFacilitationAgent).not.toHaveBeenCalled();
    expect(world.bindings).toHaveLength(SEATED_ROLES.length);
  });
});

describe('a seat somebody else holds', () => {
  it('is left alone and reported, while the empty seat is still filled', async () => {
    world.bindings.push({
      id: 'theirs',
      role: FACILITATION_ROLES.facilitator,
      agentId: 'agent-someone-else',
      agent: { slug: 'someone-else' },
    });

    await runSeed();

    // Population first: this run DID bind, so the survival below is not a seed
    // that bound nobody.
    expect(seat(FACILITATION_ROLES.onboarding)?.agentId).toBe(HER_ID);

    expect(seat(FACILITATION_ROLES.facilitator)).toMatchObject({
      id: 'theirs',
      agentId: 'agent-someone-else',
    });
    expect(bindFacilitationAgent).not.toHaveBeenCalledWith(
      expect.objectContaining({ role: FACILITATION_ROLES.facilitator })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(FACILITATION_ROLES.facilitator),
      expect.objectContaining({ heldBy: 'someone-else' })
    );
  });
});

describe('an agent that is not there', () => {
  it('throws, so the runner does not record "seated nobody" as applied', async () => {
    world.agents = [];

    await expect(runSeed()).rejects.toThrow(VOICE_AGENT_SLUG);
    expect(bindFacilitationAgent).not.toHaveBeenCalled();
  });

  it('treats a soft-deleted agent as not there', async () => {
    world.agents = [{ id: HER_ID, slug: VOICE_AGENT_SLUG, deletedAt: new Date() }];

    await expect(runSeed()).rejects.toThrow(VOICE_AGENT_SLUG);
  });
});

describe('the unit re-runs when what it seats changes', () => {
  it('hashes the pins, her slug, and the seat vocabulary', () => {
    expect(unit.hashInputs).toEqual([
      '../../../lib/app/agent/pins.ts',
      '../../../lib/app/voice/fingerprint.ts',
      '../../../lib/framework/facilitation/agents/roles.ts',
    ]);
  });
});
