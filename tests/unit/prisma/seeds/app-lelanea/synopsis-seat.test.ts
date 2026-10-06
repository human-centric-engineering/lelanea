/**
 * The synopsis seat's seed: it creates the agent once, keeps its code-owned
 * columns current, and fills the seat only when it is empty
 * (f-journey-record t-146).
 *
 * ## `fp4` — operator-owned where an operator may decide
 *
 * The agent's provider, model and name are written once, so an operator's
 * pick survives a re-seed. The seat is filled only when empty, so a binding an
 * operator made is reported and left alone. Both cases assert the population
 * first (`fp6`): the operator's row exists before the run, and is the one
 * standing after it.
 *
 * The binding service and its read are mocked at the module boundary, as
 * `agent-seats.test.ts` mocks them: they use the app's own Prisma client, and
 * no unit test reaches a database (`B9`). The real service accepting the seat is
 * what `npm run smoke:app-synopsis` proves.
 *
 * @see prisma/seeds/app-lelanea/026-synopsis-seat.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeAgent {
  id: string;
  slug: string;
  name: string;
  provider: string;
  model: string;
  profileId: string | null;
  knowledgeAccessMode: string;
  systemInstructions: string;
  isSystem: boolean;
  deletedAt: Date | null;
  writes: number;
}
interface FakeBinding {
  id: string;
  role: string;
  agentId: string;
  agent: { slug: string } | null;
}

const world = {
  users: [{ id: 'service-account', accountType: 'SERVICE' }] as {
    id: string;
    accountType: string;
  }[],
  profiles: [] as { id: string; slug: string }[],
  agents: [] as FakeAgent[],
  bindings: [] as FakeBinding[],
};

const getFacilitationBindingByRole = vi.fn(
  async (role: string) => world.bindings.find((binding) => binding.role === role) ?? null
);
const bindFacilitationAgent = vi.fn(
  async ({ agentId, role }: { agentId: string; role: string; userId: string }) => {
    if (world.bindings.some((binding) => binding.role === role)) {
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
  aiAgentProfile: {
    findUnique: vi.fn(
      async ({ where }: { where: { slug: string } }) =>
        world.profiles.find((profile) => profile.slug === where.slug) ?? null
    ),
  },
  aiAgent: {
    findFirst: vi.fn(async ({ where }: { where: { slug: string } }) => {
      const agent = world.agents.find((a) => a.slug === where.slug);
      return agent ? { ...agent } : null;
    }),
    create: vi.fn(async ({ data }: { data: Omit<FakeAgent, 'id' | 'writes' | 'deletedAt'> }) => {
      const agent = { ...data, id: `agent-${world.agents.length + 1}`, deletedAt: null, writes: 1 };
      world.agents.push(agent);
      return { id: agent.id };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeAgent> }) => {
      const agent = world.agents.find((a) => a.id === where.id)!;
      Object.assign(agent, data);
      agent.writes += 1;
      return { id: agent.id };
    }),
  },
};

const { logger } = await import('@/lib/logging');
const unit = (await import('@/prisma/seeds/app-lelanea/026-synopsis-seat')).default;
const { SEATED_ROLES, SYNOPSIS_SEAT } = await import('@/lib/app/agent/pins');
const { VOICE_PROFILE_SLUG } = await import('@/lib/app/voice/fingerprint');
const { SYNOPSIS_AGENT_SLUG, SYNOPSIS_AGENT_SYSTEM_INSTRUCTIONS } =
  await import('@/lib/app/journey-record/synopsis/agent');
const { FACILITATION_ROLES } = await import('@/lib/framework/facilitation/agents/roles');

const PROFILE_ID = 'profile-voice';

async function runSeed(): Promise<void> {
  await unit.run({ prisma: prisma as never, logger });
}

function synopsisAgent(): FakeAgent | undefined {
  return world.agents.find((agent) => agent.slug === SYNOPSIS_AGENT_SLUG);
}

beforeEach(() => {
  vi.clearAllMocks();
  world.users = [{ id: 'service-account', accountType: 'SERVICE' }];
  world.profiles = [{ id: PROFILE_ID, slug: VOICE_PROFILE_SLUG }];
  world.agents = [];
  world.bindings = [];
});

describe('the seat it names', () => {
  it('is Daybreak’s synopsis seat, and not one of the conversation seats', () => {
    expect(SYNOPSIS_SEAT).toBe(FACILITATION_ROLES.synopsis);
    // In SEATED_ROLES, seed 006 would bind her chat agent to it, and the
    // misuse screen would treat it as a conversation.
    expect(SEATED_ROLES).not.toContain(SYNOPSIS_SEAT);
  });

  it('names its own unit in the runner’s hash inputs, so editing the prompt re-runs it', () => {
    expect(unit.hashInputs).toContain('../../../lib/app/journey-record/synopsis/agent.ts');
  });
});

describe('a fresh database', () => {
  it('creates the agent in her voice profile, restricted, with no model of its own, and seats it', async () => {
    await runSeed();

    const agent = synopsisAgent();
    expect(agent).toMatchObject({
      slug: SYNOPSIS_AGENT_SLUG,
      profileId: PROFILE_ID,
      knowledgeAccessMode: 'restricted',
      systemInstructions: SYNOPSIS_AGENT_SYSTEM_INSTRUCTIONS,
      provider: '',
      model: '',
      isSystem: true,
    });
    expect(world.bindings).toEqual([
      expect.objectContaining({ role: SYNOPSIS_SEAT, agentId: agent!.id }),
    ]);
    expect(bindFacilitationAgent).toHaveBeenCalledWith({
      agentId: agent!.id,
      role: SYNOPSIS_SEAT,
      userId: 'service-account',
    });
  });

  it('binds no other seat', async () => {
    await runSeed();
    expect(world.bindings.map((binding) => binding.role)).toEqual([SYNOPSIS_SEAT]);
  });
});

describe('a re-run', () => {
  it('is idempotent: one agent, one binding, no write', async () => {
    await runSeed();
    const writesAfterFirst = synopsisAgent()!.writes;

    await runSeed();

    expect(world.agents).toHaveLength(1);
    expect(world.bindings).toHaveLength(1);
    expect(synopsisAgent()!.writes).toBe(writesAfterFirst);
    expect(prisma.aiAgent.update).not.toHaveBeenCalled();
    expect(bindFacilitationAgent).toHaveBeenCalledTimes(1);
  });

  it('keeps an operator’s model and name, and corrects only the code-owned columns', async () => {
    await runSeed();
    const agent = synopsisAgent()!;
    // An operator picks a model and renames it; the instructions and the
    // profile link drift, as an older seed or a restore would leave them.
    Object.assign(agent, {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      name: 'Session writer',
      systemInstructions: 'An older prompt.',
      profileId: null,
      knowledgeAccessMode: 'full',
    });

    await runSeed();

    expect(synopsisAgent()).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      name: 'Session writer',
      systemInstructions: SYNOPSIS_AGENT_SYSTEM_INSTRUCTIONS,
      profileId: PROFILE_ID,
      knowledgeAccessMode: 'restricted',
    });
  });

  it('never overwrites a binding an operator made', async () => {
    world.agents.push({
      id: 'agent-operator',
      slug: 'operator-writer',
      name: 'Theirs',
      provider: 'openai',
      model: 'gpt-4o',
      profileId: null,
      knowledgeAccessMode: 'full',
      systemInstructions: 'Theirs.',
      isSystem: false,
      deletedAt: null,
      writes: 0,
    });
    world.bindings.push({
      id: 'binding-operator',
      role: SYNOPSIS_SEAT,
      agentId: 'agent-operator',
      agent: { slug: 'operator-writer' },
    });

    await runSeed();

    // The agent was still created — the run did its work — and the seat is theirs.
    expect(synopsisAgent()).toBeDefined();
    expect(world.bindings).toEqual([
      expect.objectContaining({ id: 'binding-operator', agentId: 'agent-operator' }),
    ]);
    expect(bindFacilitationAgent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('held by another agent'),
      expect.objectContaining({ heldBy: 'operator-writer' })
    );
  });

  it('leaves the seat alone when an operator deleted the agent', async () => {
    await runSeed();
    synopsisAgent()!.deletedAt = new Date();
    world.bindings = [];

    await runSeed();

    expect(world.bindings).toEqual([]);
    expect(prisma.aiAgent.update).not.toHaveBeenCalled();
  });
});

describe('safe on empty', () => {
  it('throws, rather than recording success, with no voice profile', async () => {
    world.profiles = [];
    await expect(runSeed()).rejects.toThrow(/no lelanea-voice-core profile/);
    expect(world.agents).toHaveLength(0);
    expect(world.bindings).toHaveLength(0);
  });

  it('throws with no service account', async () => {
    world.users = [];
    await expect(runSeed()).rejects.toThrow(/No service account/);
    expect(world.agents).toHaveLength(0);
  });
});
