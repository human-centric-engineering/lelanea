/**
 * The reachability seed: she becomes `public` and can look in her material —
 * and an operator's later decision about either is never undone (§08 t-54).
 *
 * ## `fp4` — visibility is operator-owned, the grant is filled once
 *
 * Widened only while she is still `internal` AND her timeline holds no entry of
 * this unit's: `internal` with that entry behind it is an admin narrowing her,
 * which a re-run must leave alone. A grant that exists — switched off included —
 * is an operator's, and is never rewritten.
 *
 * ## Absence is only evidence over a non-empty population (`fp6`)
 *
 * "A re-run writes nothing" passes for free against a seed that wrote nothing,
 * so each such case asserts the first run's writes before the second run's
 * absence.
 *
 * A small stateful fake of the five tables the unit touches. The transaction
 * forwards to the same fake, as the platform's own seed tests do (`B9`).
 *
 * @see prisma/seeds/app-lelanea/007-agent-reachable.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface AgentRow {
  id: string;
  slug: string;
  visibility: string;
  createdBy: string | null;
  deletedAt: Date | null;
}
interface VersionRow {
  agentId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changeSummary: string;
  createdBy: string;
}

const world = {
  agents: [] as AgentRow[],
  capabilities: [] as { id: string; slug: string }[],
  grants: [] as { agentId: string; capabilityId: string; isEnabled: boolean }[],
  versions: [] as VersionRow[],
};

vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const client = {
  user: { findFirst: vi.fn(async () => ({ id: 'service-account' })) },
  aiAgent: {
    findFirst: vi.fn(
      async ({ where }: { where: { slug: string } }) =>
        world.agents.find((a) => a.slug === where.slug && a.deletedAt === null) ?? null
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; visibility: string };
        data: { visibility: string };
      }) => {
        const rows = world.agents.filter(
          (a) => a.id === where.id && a.visibility === where.visibility
        );
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }
    ),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = world.agents.find((a) => a.id === where.id);
      if (!row) throw new Error('not found');
      return { ...row, grantedTags: [], grantedDocuments: [] };
    }),
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
    create: vi.fn(async ({ data }: { data: { agentId: string; capabilityId: string } }) => {
      const grant = { ...data, isEnabled: true };
      world.grants.push(grant);
      return grant;
    }),
  },
  aiAgentVersion: {
    findFirst: vi.fn(async ({ where }: { where: { agentId: string; changeSummary?: string } }) => {
      const rows = world.versions
        .filter(
          (v) =>
            v.agentId === where.agentId &&
            (where.changeSummary === undefined || v.changeSummary === where.changeSummary)
        )
        .sort((a, b) => b.version - a.version);
      return rows[0] ? { version: rows[0].version } : null;
    }),
    create: vi.fn(async ({ data }: { data: VersionRow }) => {
      world.versions.push(data);
      return data;
    }),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
};

const { logger } = await import('@/lib/logging');
const unit = (await import('@/prisma/seeds/app-lelanea/007-agent-reachable')).default;
const { GRANTED_CAPABILITY_SLUGS, REACHABLE_CHANGE_SUMMARY } = await import('@/lib/app/agent/pins');
const { VOICE_AGENT_SLUG } = await import('@/lib/app/voice/fingerprint');

async function runSeed(): Promise<void> {
  await unit.run({ prisma: client as never, logger });
}

const HER_ID = 'agent-hers';
const her = (): AgentRow => world.agents[0];

beforeEach(() => {
  vi.clearAllMocks();
  world.agents = [
    {
      id: HER_ID,
      slug: VOICE_AGENT_SLUG,
      visibility: 'internal',
      createdBy: 'creator',
      deletedAt: null,
    },
  ];
  world.capabilities = [{ id: 'cap-search', slug: 'search_knowledge_base' }];
  world.grants = [];
  world.versions = [];
});

describe('a fresh install', () => {
  it('grants exactly the knowledge search tool', () => {
    expect(GRANTED_CAPABILITY_SLUGS).toEqual(['search_knowledge_base']);
  });

  it('makes her public, as an entry in her timeline above her initial configuration', async () => {
    await runSeed();

    expect(her().visibility).toBe('public');
    expect(world.versions.map((v) => [v.version, v.changeSummary])).toEqual([
      [1, 'Initial configuration'],
      [2, REACHABLE_CHANGE_SUMMARY],
    ]);
    // The snapshots say what changed: from internal, to public.
    expect(world.versions[0].snapshot).toMatchObject({ visibility: 'internal' });
    expect(world.versions[1].snapshot).toMatchObject({ visibility: 'public' });
    expect(world.versions[1].createdBy).toBe('service-account');
  });

  it('grants her the search tool, switched on', async () => {
    await runSeed();

    expect(world.grants).toEqual([
      { agentId: HER_ID, capabilityId: 'cap-search', isEnabled: true },
    ]);
  });

  it('appends to a timeline that already has history, rather than writing v1 again', async () => {
    world.versions = [
      {
        agentId: HER_ID,
        version: 1,
        snapshot: {},
        changeSummary: 'Initial configuration',
        createdBy: 'x',
      },
      { agentId: HER_ID, version: 2, snapshot: {}, changeSummary: 'Pinned model', createdBy: 'x' },
    ];

    await runSeed();

    expect(world.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(world.versions[2].changeSummary).toBe(REACHABLE_CHANGE_SUMMARY);
  });
});

describe('a re-run', () => {
  it('writes nothing', async () => {
    await runSeed();
    // The population: the first run wrote a grant and two versions.
    expect(world.grants).toHaveLength(1);
    expect(world.versions).toHaveLength(2);

    await runSeed();

    expect(world.grants).toHaveLength(1);
    expect(world.versions).toHaveLength(2);
    expect(client.aiAgent.updateMany).toHaveBeenCalledTimes(1);
  });

  it('leaves her internal when an admin narrowed her after the seed widened her', async () => {
    await runSeed();
    expect(her().visibility).toBe('public');
    her().visibility = 'internal'; // an admin's decision

    await runSeed();

    expect(her().visibility).toBe('internal');
    expect(world.versions).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('narrowed her since'));
  });

  it('leaves a grant an operator switched off switched off', async () => {
    world.grants = [{ agentId: HER_ID, capabilityId: 'cap-search', isEnabled: false }];

    await runSeed();

    expect(world.grants).toEqual([
      { agentId: HER_ID, capabilityId: 'cap-search', isEnabled: false },
    ]);
    expect(client.aiAgentCapability.create).not.toHaveBeenCalled();
  });

  it('leaves a visibility somebody else chose alone', async () => {
    her().visibility = 'invite_only';

    await runSeed();

    expect(her().visibility).toBe('invite_only');
    expect(world.versions).toHaveLength(0);
  });
});

describe('safe on empty', () => {
  it('throws, writing nothing, when her agent does not exist', async () => {
    world.agents = [];

    await expect(runSeed()).rejects.toThrow(/no such agent/);
    expect(world.grants).toHaveLength(0);
  });

  it('throws, writing nothing, when the capability does not exist', async () => {
    world.capabilities = [];

    await expect(runSeed()).rejects.toThrow(/no such capability/);
    expect(her().visibility).toBe('internal');
    expect(world.versions).toHaveLength(0);
  });
});

describe('the edges', () => {
  it('throws when there is no service account to write the timeline as', async () => {
    client.user.findFirst.mockResolvedValueOnce(null as never);

    await expect(runSeed()).rejects.toThrow(/No service account/);
    expect(world.grants).toHaveLength(0);
  });

  it('writes no timeline entry when an admin changed her between the read and the write', async () => {
    // Somebody else widens her first: the predicate matches nothing.
    client.aiAgent.updateMany.mockResolvedValueOnce({ count: 0 });

    await runSeed();

    expect(world.versions).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('changed while this ran'));
  });

  it('carries her knowledge grants into both snapshots, so a restore keeps them', async () => {
    client.aiAgent.findUniqueOrThrow.mockImplementationOnce(async () => ({
      ...her(),
      grantedTags: [{ tagId: 'tag-b' }, { tagId: 'tag-a' }],
      grantedDocuments: [{ documentId: 'doc-1' }],
    }));

    await runSeed();

    for (const version of world.versions) {
      expect(version.snapshot).toMatchObject({
        grantedTagIds: ['tag-a', 'tag-b'],
        grantedDocumentIds: ['doc-1'],
      });
    }
  });

  it('versions under her creator when the agent has none recorded', async () => {
    her().createdBy = null;

    await runSeed();

    expect(world.versions[0].createdBy).toBe('service-account');
  });
});
