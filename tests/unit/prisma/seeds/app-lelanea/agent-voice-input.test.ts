/**
 * The voice-input seed: her flag goes on once, as an entry in her timeline —
 * and an admin who turns it off is never overruled (§10 t-67; `fp4`).
 *
 * A re-run that writes nothing passes for free against a seed that wrote
 * nothing, so the "left alone" cases first show the first run's write (`fp6`).
 * A small stateful fake of the three tables the unit touches; the transaction
 * forwards to the same fake (`B9`).
 *
 * @see prisma/seeds/app-lelanea/012-agent-voice-input.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface AgentRow {
  id: string;
  slug: string;
  enableVoiceInput: boolean;
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

const world = { agents: [] as AgentRow[], versions: [] as VersionRow[] };

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
        where: { id: string; enableVoiceInput: boolean };
        data: { enableVoiceInput: boolean };
      }) => {
        const rows = world.agents.filter(
          (a) => a.id === where.id && a.enableVoiceInput === where.enableVoiceInput
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
const unit = (await import('@/prisma/seeds/app-lelanea/012-agent-voice-input')).default;
const { VOICE_INPUT_CHANGE_SUMMARY } = await import('@/lib/app/agent/pins');
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
      enableVoiceInput: false,
      createdBy: 'creator',
      deletedAt: null,
    },
  ];
  world.versions = [];
});

describe('a fresh install', () => {
  it('switches voice input on, as an entry in her timeline above her initial configuration', async () => {
    await runSeed();
    expect(her().enableVoiceInput).toBe(true);
    expect(world.versions.map((v) => [v.version, v.changeSummary])).toEqual([
      [1, 'Initial configuration'],
      [2, VOICE_INPUT_CHANGE_SUMMARY],
    ]);
    expect(world.versions[0].snapshot).toMatchObject({ enableVoiceInput: false });
    expect(world.versions[1].snapshot).toMatchObject({ enableVoiceInput: true });
    expect(world.versions[1].createdBy).toBe('service-account');
  });

  it('appends to a timeline that already has history', async () => {
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
    expect(world.versions[2].changeSummary).toBe(VOICE_INPUT_CHANGE_SUMMARY);
  });

  it('touches nothing else — not the org-wide switch', async () => {
    await runSeed();
    expect(Object.keys(client)).not.toContain('aiOrchestrationSettings');
  });
});

describe('a re-run', () => {
  it('writes nothing when she already accepts voice input', async () => {
    await runSeed();
    expect(world.versions).toHaveLength(2);
    await runSeed();
    expect(world.versions).toHaveLength(2);
    expect(client.aiAgent.updateMany).toHaveBeenCalledTimes(1);
  });

  it('leaves an admin’s off alone: switched on before, then turned off, stays off', async () => {
    await runSeed();
    expect(her().enableVoiceInput).toBe(true);
    // An admin turns it off, as the admin form would.
    her().enableVoiceInput = false;

    await runSeed();
    expect(her().enableVoiceInput).toBe(false);
    expect(world.versions).toHaveLength(2);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('turned it off since')
    );
  });

  it('loses a race to an admin rather than overwriting them', async () => {
    client.aiAgent.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    await runSeed();
    expect(world.versions).toHaveLength(0);
  });
});

describe('safe on empty', () => {
  it('throws when her agent does not exist, so the runner never records success', async () => {
    world.agents = [];
    await expect(runSeed()).rejects.toThrow(/no such agent/);
    expect(world.versions).toHaveLength(0);
  });
});
