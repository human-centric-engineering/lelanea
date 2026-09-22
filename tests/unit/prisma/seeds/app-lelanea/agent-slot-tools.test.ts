/**
 * The slot-tools seed: she gets the profile, with the allowlist that bounds what
 * she may read back — and an operator's later decision about either is never
 * undone (f-slots t-72).
 *
 * ## `fp4` — the grant and its config are filled once, together
 *
 * The allowlist IS the config, so it has to be written with the binding: a grant
 * created first and configured second is permissive in between. And a binding
 * that exists is an operator's — switched off, narrowed, widened, or edited by
 * hand — so a re-run leaves all four exactly as they are.
 *
 * ## Absence is only evidence over a non-empty population (`fp6`)
 *
 * "A re-run writes nothing" passes for free against a seed that wrote nothing,
 * so every such case asserts the first run's writes before the second run's
 * absence.
 *
 * A small stateful fake of the three tables the unit touches (`B9`).
 *
 * @see prisma/seeds/app-lelanea/013-agent-slot-tools.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface GrantRow {
  agentId: string;
  capabilityId: string;
  isEnabled: boolean;
  customConfig: unknown;
}

const world = {
  agents: [] as { id: string; slug: string; deletedAt: Date | null }[],
  capabilities: [] as { id: string; slug: string }[],
  grants: [] as GrantRow[],
};

vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const client = {
  aiAgent: {
    findFirst: vi.fn(
      async ({ where }: { where: { slug: string } }) =>
        world.agents.find((a) => a.slug === where.slug && a.deletedAt === null) ?? null
    ),
  },
  aiCapability: {
    findMany: vi.fn(async ({ where }: { where: { slug: { in: string[] } } }) =>
      world.capabilities.filter((c) => where.slug.in.includes(c.slug))
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
    create: vi.fn(
      async ({
        data,
      }: {
        data: { agentId: string; capabilityId: string; customConfig: unknown };
      }) => {
        const grant = { ...data, isEnabled: true };
        world.grants.push(grant);
        return grant;
      }
    ),
  },
};

const { logger } = await import('@/lib/logging');
const unit = (await import('@/prisma/seeds/app-lelanea/013-agent-slot-tools')).default;
const { SLOT_CAPABILITY_SLUGS, SLOT_EXPOSURE_CONFIG } = await import('@/lib/app/agent/pins');
const { VOICE_AGENT_SLUG } = await import('@/lib/app/voice/fingerprint');
const { getSlotTaxonomy } = await import('@/lib/app/content/slot-taxonomy');

async function runSeed(): Promise<void> {
  await unit.run({ prisma: client as never, logger });
}

const HER_ID = 'agent-hers';
const CAP_READ = 'cap-get-state';
const CAP_WRITE = 'cap-fill-slot';

beforeEach(() => {
  vi.clearAllMocks();
  world.agents = [{ id: HER_ID, slug: VOICE_AGENT_SLUG, deletedAt: null }];
  world.capabilities = [
    { id: CAP_READ, slug: 'get_state' },
    { id: CAP_WRITE, slug: 'fill_slot' },
  ];
  world.grants = [];
});

describe('what the seed grants', () => {
  it('grants both slot tools, switched on, each carrying the allowlist', async () => {
    await runSeed();

    expect(world.grants).toHaveLength(2);
    for (const grant of world.grants) {
      expect(grant.isEnabled).toBe(true);
      expect(grant.customConfig).toEqual({ read: { groups: SLOT_EXPOSURE_CONFIG.read.groups } });
    }
    expect(world.grants.map((g) => g.capabilityId).sort()).toEqual([CAP_READ, CAP_WRITE].sort());
  });

  it('is the read tool and the write tool, and only those two', () => {
    expect([...SLOT_CAPABILITY_SLUGS].sort()).toEqual(['fill_slot', 'get_state']);
  });
});

describe('the allowlist it writes', () => {
  it('restricts what she reads back and NOT what she writes, so she can still mint', () => {
    // The whole reason there is no `write` facet: a minted slug has no group, so
    // `facetAllows` refuses it under any named list. A write restriction and the
    // owner's 20 Sept 2026 ruling that she may invent a slot cannot both hold.
    // If a `write` key ever appears here, minting has been switched off by
    // accident rather than by decision.
    expect(SLOT_EXPOSURE_CONFIG).not.toHaveProperty('write');
    expect(SLOT_EXPOSURE_CONFIG.read.groups.length).toBeGreaterThan(0);
  });

  it('withholds the hidden group from her reads, by deriving rather than listing', () => {
    // §12: development is a tuning signal, never a grade. Asserted against the
    // taxonomy rather than against the string, so the case still means something
    // if the group is renamed.
    const file = getSlotTaxonomy();
    const hiddenGroups = new Set(
      file.slots.filter((s) => s.visibility === 'hidden').map((s) => s.group)
    );
    expect(hiddenGroups.size).toBeGreaterThan(0);
    for (const group of hiddenGroups) {
      expect(SLOT_EXPOSURE_CONFIG.read.groups).not.toContain(group);
    }
    // ...and every group that is NOT hidden is offered, so this is a filter and
    // not an accidental near-empty list.
    for (const group of file.groups.map((g) => g.key)) {
      if (hiddenGroups.has(group)) continue;
      expect(SLOT_EXPOSURE_CONFIG.read.groups).toContain(group);
    }
  });

  it('is a plain mutable object Prisma will accept as JSON, not a frozen constant', async () => {
    // The constant is `as const` and the taxonomy loader deep-freezes its output.
    // Handing a frozen array to Prisma's JSON input is the kind of thing that
    // fails only against a real database, so the rebuild is asserted here.
    await runSeed();
    const written = world.grants[0].customConfig as { read: { groups: string[] } };
    expect(Object.isFrozen(written.read.groups)).toBe(false);
    expect(() => written.read.groups.push('x')).not.toThrow();
  });
});

describe('a re-run', () => {
  it('writes nothing, having written two grants the first time', async () => {
    await runSeed();
    expect(world.grants).toHaveLength(2);

    client.aiAgentCapability.create.mockClear();
    await runSeed();

    expect(client.aiAgentCapability.create).not.toHaveBeenCalled();
    expect(world.grants).toHaveLength(2);
  });

  it('leaves a grant an operator switched off switched off', async () => {
    await runSeed();
    world.grants.forEach((grant) => (grant.isEnabled = false));

    await runSeed();

    expect(world.grants.every((g) => g.isEnabled === false)).toBe(true);
    expect(world.grants).toHaveLength(2);
  });

  it('leaves an allowlist an operator narrowed narrowed', async () => {
    await runSeed();
    const narrowed = { read: { groups: ['preferences'] } };
    world.grants.forEach((grant) => (grant.customConfig = narrowed));

    await runSeed();

    // Not widened back to the derived list, which is the failure this rule
    // exists to prevent: a seed that "corrected" the config would undo a
    // decision somebody made in the admin, silently, on every deploy.
    expect(world.grants.every((g) => g.customConfig === narrowed)).toBe(true);
  });

  it('leaves a grant somebody cleared the config on alone rather than refilling it', async () => {
    await runSeed();
    world.grants.forEach((grant) => (grant.customConfig = null));

    await runSeed();

    expect(world.grants.every((g) => g.customConfig === null)).toBe(true);
  });

  it('grants only the half that is missing, when only one exists', async () => {
    world.grants = [
      { agentId: HER_ID, capabilityId: CAP_READ, isEnabled: true, customConfig: null },
    ];

    await runSeed();

    expect(world.grants).toHaveLength(2);
    // The pre-existing one untouched, the new one configured.
    expect(world.grants[0].customConfig).toBeNull();
    expect(world.grants[1].capabilityId).toBe(CAP_WRITE);
    expect(world.grants[1].customConfig).toEqual({
      read: { groups: SLOT_EXPOSURE_CONFIG.read.groups },
    });
  });
});

describe('when it cannot do its job', () => {
  it('throws rather than banking success when her agent is missing', async () => {
    world.agents = [];

    await expect(runSeed()).rejects.toThrow(/no such agent/);
    expect(world.grants).toEqual([]);
  });

  it('throws rather than banking success when her agent is soft-deleted', async () => {
    world.agents[0].deletedAt = new Date();

    await expect(runSeed()).rejects.toThrow(/no such agent/);
  });

  it('throws naming the missing capability, and grants NEITHER half', async () => {
    // Read before any write: a half-granted state would leave her able to write
    // what she cannot read, or the reverse, with the unit recorded as applied.
    world.capabilities = [{ id: CAP_READ, slug: 'get_state' }];

    await expect(runSeed()).rejects.toThrow(/fill_slot/);
    expect(world.grants).toEqual([]);
  });
});

describe('the unit itself', () => {
  it('re-runs when the slugs, the allowlist source or the taxonomy changes', () => {
    // The allowlist is derived from the taxonomy file, so the taxonomy is an
    // input to this unit even though it writes no definition.
    expect(unit.hashInputs).toEqual([
      '../../../lib/app/agent/pins.ts',
      '../../../seed-data/drafted/lelanea_slot_taxonomy.json',
      '../../../lib/app/content/slot-taxonomy.ts',
    ]);
  });

  it('sorts after the taxonomy it derives its allowlist from', () => {
    // 011 seeds the definitions and projects them; this reads their groups.
    expect(unit.name).toBe('app-lelanea/013-agent-slot-tools');
    expect(unit.name > 'app-lelanea/011-slot-taxonomy').toBe(true);
  });
});
