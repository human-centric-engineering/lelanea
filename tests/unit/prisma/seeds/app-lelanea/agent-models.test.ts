/**
 * The model-pin seed: what it fills, what it must never write over, and the entry
 * it leaves in the timeline.
 *
 * ## 1. `fp4` — three kinds of row, three ownership rules
 *
 * The agents' provider and model are **operator-owned**: filled only where both
 * are still blank, because production's model is an admin edit and a re-seed
 * that undid it would make the pin impossible to change without a deploy. The
 * default task models are operator-owned **per key**. The matrix row is
 * seed-managed under the platform's `isDefault` protocol.
 *
 * A re-run on a current database issues **no write at all** — the only shape of
 * "no timestamp churn" a harness with no database can check (`B9`).
 *
 * ## 2. Absence is only evidence over a non-empty population (`fp6`)
 *
 * "The admin's value survived" passes for free if the seed wrote nothing to
 * anyone. Every such case below runs beside a row the seed DOES write in the same
 * run, and asserts that write first.
 *
 * ## 3. Both arms resolve the same model
 *
 * The golden set compares her voice with a bare model. Pin one arm and not the
 * other and it compares two models instead, with nothing on the screen saying so.
 * The last suite feeds what the seed wrote through the platform's REAL resolver —
 * the pair a turn would actually be sent with — rather than comparing two columns
 * the seed itself just set from one constant.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this pins Lelañea's agents
 * ---------------------------------------------------------------------------
 * A fork without her agents should delete this file with the seed.
 *
 * @see prisma/seeds/app-lelanea/005-agent-models.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FakeAgent {
  id: string;
  slug: string;
  name: string;
  provider: string;
  model: string;
  fallbackProviders: string[];
  temperature: number;
  createdBy: string | null;
  grantedTags: { tagId: string }[];
  grantedDocuments: { documentId: string }[];
}

interface FakeVersion {
  agentId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changeSummary: string;
  createdBy: string | null;
}

interface FakeMatrixRow {
  id: string;
  slug: string;
  providerSlug: string;
  modelId: string;
  isDefault: boolean;
  [column: string]: unknown;
}

interface FakeSettings {
  id: string;
  slug: string;
  defaultModels: unknown;
}

const world = {
  users: [{ id: 'service-account', accountType: 'SERVICE' }],
  agents: [] as FakeAgent[],
  versions: [] as FakeVersion[],
  matrix: [] as FakeMatrixRow[],
  settings: null as FakeSettings | null,
};

/** Every write the fake saw, so "a re-run writes nothing" is checkable. */
const writes = {
  agentUpdate: 0,
  versionCreate: 0,
  matrixCreate: 0,
  matrixUpdate: 0,
  settingsCreate: 0,
  settingsUpdate: 0,
};

function totalWrites(): number {
  return Object.values(writes).reduce((sum, count) => sum + count, 0);
}

function resetWrites(): void {
  for (const key of Object.keys(writes) as (keyof typeof writes)[]) writes[key] = 0;
}

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * A stateful fake rather than sequenced one-shot mocks: the idempotence claim
 * needs the seed's SECOND run to read what its first run wrote.
 */
const tables = {
  user: {
    findFirst: vi.fn(
      async ({ where }: { where: { accountType: string } }) =>
        world.users.find((user) => user.accountType === where.accountType) ?? null
    ),
  },
  aiAgent: {
    findMany: vi.fn(async ({ where }: { where: { slug: { in: string[] } } }) =>
      world.agents.filter((agent) => where.slug.in.includes(agent.slug))
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeAgent> }) => {
      writes.agentUpdate += 1;
      const agent = world.agents.find((candidate) => candidate.id === where.id);
      if (!agent) throw new Error(`No agent ${where.id}`);
      Object.assign(agent, data);
      return agent;
    }),
  },
  aiAgentVersion: {
    findFirst: vi.fn(async ({ where }: { where: { agentId: string } }) => {
      const mine = world.versions.filter((version) => version.agentId === where.agentId);
      if (mine.length === 0) return null;
      return { version: Math.max(...mine.map((version) => version.version)) };
    }),
    create: vi.fn(async ({ data }: { data: FakeVersion }) => {
      writes.versionCreate += 1;
      // A copy: the seed snapshots a row it goes on to update, and a shared
      // reference would make v1 silently show the pin it predates.
      world.versions.push(structuredClone(data));
      return data;
    }),
  },
  aiProviderModel: {
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { slug?: string; providerSlug_modelId?: { providerSlug: string; modelId: string } };
      }) => {
        if (where.slug !== undefined) {
          return world.matrix.find((row) => row.slug === where.slug) ?? null;
        }
        const key = where.providerSlug_modelId;
        return (
          world.matrix.find(
            (row) => row.providerSlug === key?.providerSlug && row.modelId === key?.modelId
          ) ?? null
        );
      }
    ),
    create: vi.fn(async ({ data }: { data: Omit<FakeMatrixRow, 'id'> }) => {
      writes.matrixCreate += 1;
      const row = { id: `matrix-${world.matrix.length + 1}`, ...data } as FakeMatrixRow;
      world.matrix.push(row);
      return row;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<FakeMatrixRow> }) => {
        writes.matrixUpdate += 1;
        const row = world.matrix.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error(`No matrix row ${where.id}`);
        Object.assign(row, data);
        return row;
      }
    ),
  },
  aiOrchestrationSettings: {
    findUnique: vi.fn(async () => world.settings),
    create: vi.fn(async ({ data }: { data: Omit<FakeSettings, 'id'> }) => {
      writes.settingsCreate += 1;
      world.settings = { id: 'settings-1', ...data };
      return world.settings;
    }),
    update: vi.fn(async ({ data }: { data: Partial<FakeSettings> }) => {
      writes.settingsUpdate += 1;
      if (!world.settings) throw new Error('No settings row');
      Object.assign(world.settings, data);
      return world.settings;
    }),
  },
};

const prisma = {
  ...tables,
  // The interactive form: the seed's update and its version row share one
  // transaction. The fake hands the callback the same tables.
  $transaction: vi.fn(async (work: (tx: typeof tables) => Promise<unknown>) => work(tables)),
};

import { logger } from '@/lib/logging';
import unit from '@/prisma/seeds/app-lelanea/005-agent-models';
import {
  PINNED_AGENT_SLUGS,
  PINNED_MODEL,
  PINNED_MODEL_MATRIX_ROW,
  PINNED_PROVIDER,
  PIN_CHANGE_SUMMARY,
  SIDE_ROLE_MODEL,
} from '@/lib/app/agent/pins';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { VOICE_CONTROL_AGENT_SLUG } from '@/lib/app/voice/golden-set';
import { INITIAL_VERSION_SUMMARY } from '@/lib/orchestration/agents/agent-versioning';
import { resolveAgentProviderAndModel } from '@/lib/orchestration/llm/agent-resolver';

async function runSeed(): Promise<void> {
  await unit.run({ prisma: prisma as never, logger: logger });
}

/** An agent as units 003/004 leave it: nothing chosen. */
function blankAgent(slug: string): FakeAgent {
  return {
    id: `agent-${slug}`,
    slug,
    name: slug,
    provider: '',
    model: '',
    fallbackProviders: [],
    temperature: 0.7,
    createdBy: 'service-account',
    grantedTags: [],
    grantedDocuments: [],
  };
}

function agent(slug: string): FakeAgent {
  const found = world.agents.find((candidate) => candidate.slug === slug);
  if (!found) throw new Error(`No agent ${slug} in the fake`);
  return found;
}

function versionsOf(slug: string): FakeVersion[] {
  return world.versions
    .filter((version) => version.agentId === agent(slug).id)
    .sort((a, b) => a.version - b.version);
}

beforeEach(() => {
  vi.clearAllMocks();
  world.agents = [blankAgent(VOICE_AGENT_SLUG), blankAgent(VOICE_CONTROL_AGENT_SLUG)];
  world.versions = [];
  world.matrix = [];
  world.settings = null;
  resetWrites();
});

describe('a fresh install', () => {
  it('pins both arms to a dated model and an explicit provider, with no fallback', async () => {
    await runSeed();

    // The slugs are asserted, not assumed: a roster that quietly lost the
    // control would still "pin every agent on it".
    expect([...PINNED_AGENT_SLUGS].sort()).toEqual(
      [VOICE_AGENT_SLUG, VOICE_CONTROL_AGENT_SLUG].sort()
    );
    for (const slug of PINNED_AGENT_SLUGS) {
      expect(agent(slug).provider).toBe(PINNED_PROVIDER);
      expect(agent(slug).model).toBe(PINNED_MODEL);
      expect(agent(slug).fallbackProviders).toEqual([]);
    }
  });

  it('pins a dated snapshot, never an alias that can be repointed', () => {
    // §8.2: "version pinning, never latest". An alias passes every other test in
    // this file, so the shape of the id is pinned on its own.
    expect(PINNED_MODEL).toMatch(/-\d{4}-\d{2}-\d{2}$/);
    expect(PINNED_PROVIDER).not.toBe('');
  });

  it('records the pin in the version timeline, over the blank state it replaced', async () => {
    await runSeed();

    for (const slug of PINNED_AGENT_SLUGS) {
      const timeline = versionsOf(slug);
      expect(timeline.map((version) => version.changeSummary)).toEqual([
        INITIAL_VERSION_SUMMARY,
        PIN_CHANGE_SUMMARY,
      ]);
      // v1 is what "restore" would return to, so it must be the state BEFORE the
      // pin — not a second copy of the pinned one.
      expect(timeline[0]?.snapshot.model).toBe('');
      expect(timeline[1]?.snapshot.model).toBe(PINNED_MODEL);
      expect(timeline[1]?.snapshot.provider).toBe(PINNED_PROVIDER);
    }
  });

  it('numbers the pin after whatever history the agent already has', async () => {
    world.versions.push({
      agentId: agent(VOICE_AGENT_SLUG).id,
      version: 4,
      snapshot: { model: '' },
      changeSummary: 'Something an admin did',
      createdBy: 'someone',
    });

    await runSeed();

    const timeline = versionsOf(VOICE_AGENT_SLUG);
    expect(timeline.map((version) => version.version)).toEqual([4, 5]);
    // History exists, so no second "Initial configuration" is invented.
    expect(timeline[1]?.changeSummary).toBe(PIN_CHANGE_SUMMARY);
  });

  it('adds the dated id to the matrix as a seed-managed row', async () => {
    await runSeed();

    expect(world.matrix).toHaveLength(1);
    expect(world.matrix[0]).toMatchObject({
      slug: PINNED_MODEL_MATRIX_ROW.slug,
      providerSlug: PINNED_PROVIDER,
      modelId: PINNED_MODEL,
      isDefault: true,
      costPerMillionTokens: PINNED_MODEL_MATRIX_ROW.costPerMillionTokens,
    });
  });

  it('fills the routing and chat defaults, creating the singleton if nothing has yet', async () => {
    await runSeed();

    expect(world.settings?.slug).toBe('global');
    expect(world.settings?.defaultModels).toEqual({
      routing: SIDE_ROLE_MODEL,
      chat: SIDE_ROLE_MODEL,
    });
  });
});

describe('a re-run', () => {
  it('writes nothing at all', async () => {
    await runSeed();
    // The population: the first run really did write, to every table it owns.
    expect(writes.agentUpdate).toBe(2);
    expect(writes.versionCreate).toBe(4);
    expect(writes.matrixCreate).toBe(1);
    expect(writes.settingsCreate).toBe(1);
    resetWrites();

    await runSeed();

    expect(totalWrites()).toBe(0);
  });
});

describe('what an operator chose is never written over', () => {
  it('leaves an admin-edited model alone, while still pinning the arm nobody touched', async () => {
    agent(VOICE_AGENT_SLUG).provider = 'anthropic';
    agent(VOICE_AGENT_SLUG).model = 'claude-sonnet-4';

    await runSeed();

    // Population first: the seed DID pin in this run, so the survival below is
    // not a seed that wrote to nobody.
    expect(agent(VOICE_CONTROL_AGENT_SLUG).model).toBe(PINNED_MODEL);

    expect(agent(VOICE_AGENT_SLUG).provider).toBe('anthropic');
    expect(agent(VOICE_AGENT_SLUG).model).toBe('claude-sonnet-4');
    expect(versionsOf(VOICE_AGENT_SLUG)).toEqual([]);
  });

  it.each([
    ['a provider with no model', { provider: 'anthropic', model: '' }],
    ['a model with no provider', { provider: '', model: 'claude-sonnet-4' }],
  ])('treats %s as an edit too, and does not guess the other half', async (_label, edit) => {
    Object.assign(agent(VOICE_AGENT_SLUG), edit);

    await runSeed();

    expect(agent(VOICE_CONTROL_AGENT_SLUG).model).toBe(PINNED_MODEL);
    expect(agent(VOICE_AGENT_SLUG)).toMatchObject(edit);
  });

  it('reports a fallback list rather than clearing it', async () => {
    agent(VOICE_AGENT_SLUG).fallbackProviders = ['anthropic'];

    await runSeed();

    expect(agent(VOICE_AGENT_SLUG).model).toBe(PINNED_MODEL);
    expect(agent(VOICE_AGENT_SLUG).fallbackProviders).toEqual(['anthropic']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no fallback'),
      expect.objectContaining({ fallbackProviders: ['anthropic'] })
    );
  });

  it('leaves admin-edited default task models alone, per key', async () => {
    world.settings = {
      id: 'settings-1',
      slug: 'global',
      defaultModels: { routing: 'claude-haiku-4.5', reasoning: 'gpt-5' },
    };

    await runSeed();

    expect(world.settings.defaultModels).toEqual({
      // The admin's, kept.
      routing: 'claude-haiku-4.5',
      // A key this unit does not own, carried through the write untouched.
      reasoning: 'gpt-5',
      // Population: the blank key WAS filled in the same write, so the two
      // above survived a seed that wrote, not one that skipped.
      chat: SIDE_ROLE_MODEL,
    });
  });

  it('does not touch the settings row when both keys are already chosen', async () => {
    world.settings = {
      id: 'settings-1',
      slug: 'global',
      defaultModels: { routing: 'claude-haiku-4.5', chat: 'claude-haiku-4.5' },
    };

    await runSeed();

    // Population: the run wrote elsewhere.
    expect(writes.agentUpdate).toBe(2);
    expect(writes.settingsUpdate).toBe(0);
    expect(writes.settingsCreate).toBe(0);
  });

  it('keeps an operator’s other keys when one stored value is not a string', async () => {
    // `parseStoredDefaults()` collapses this whole map to `{}`. Spreading that
    // back would drop `reasoning` in order to fill two keys.
    world.settings = {
      id: 'settings-1',
      slug: 'global',
      defaultModels: { reasoning: 'gpt-5', audio: 42 },
    };

    await runSeed();

    expect(world.settings.defaultModels).toMatchObject({
      reasoning: 'gpt-5',
      routing: SIDE_ROLE_MODEL,
      chat: SIDE_ROLE_MODEL,
    });
  });

  it('leaves a matrix row an admin has edited alone', async () => {
    await runSeed();
    const row = world.matrix[0];
    if (!row) throw new Error('The seed created no matrix row');
    row.isDefault = false;
    row.costPerMillionTokens = 9;
    resetWrites();

    await runSeed();

    expect(row.costPerMillionTokens).toBe(9);
    expect(writes.matrixUpdate).toBe(0);
  });

  it('reconciles a matrix row it still owns', async () => {
    // The other half of the case above: the same drift on a seed-managed row IS
    // corrected, so "left alone" there is the ownership flag and not a seed that
    // never updates.
    await runSeed();
    const row = world.matrix[0];
    if (!row) throw new Error('The seed created no matrix row');
    row.costPerMillionTokens = 9;

    await runSeed();

    expect(row.costPerMillionTokens).toBe(PINNED_MODEL_MATRIX_ROW.costPerMillionTokens);
  });

  it('does not create a second row for a model an admin already added under their own slug', async () => {
    // The table is unique on (providerSlug, modelId) — a create here would fail
    // on that constraint and take the whole seed down with it.
    world.matrix.push({
      id: 'theirs',
      slug: 'my-own-mini',
      providerSlug: PINNED_PROVIDER,
      modelId: PINNED_MODEL,
      isDefault: false,
    });

    await runSeed();

    expect(world.matrix).toHaveLength(1);
    expect(writes.matrixCreate).toBe(0);
    expect(writes.matrixUpdate).toBe(0);
    // Population: the run still pinned.
    expect(agent(VOICE_AGENT_SLUG).model).toBe(PINNED_MODEL);
  });
});

describe('an agent that is not there', () => {
  it.each([[VOICE_AGENT_SLUG], [VOICE_CONTROL_AGENT_SLUG]])(
    'throws when %s is missing, so the runner does not record success',
    async (missing) => {
      world.agents = world.agents.filter((candidate) => candidate.slug !== missing);

      await expect(runSeed()).rejects.toThrow(missing);
    }
  );

  it('writes nothing before it throws — no install left with one arm pinned', async () => {
    world.agents = world.agents.filter((candidate) => candidate.slug !== VOICE_CONTROL_AGENT_SLUG);

    await expect(runSeed()).rejects.toThrow();

    expect(totalWrites()).toBe(0);
    expect(agent(VOICE_AGENT_SLUG).model).toBe('');
  });
});

describe('the two arms of the golden set', () => {
  it('resolve to the same provider and model through the platform’s resolver', async () => {
    await runSeed();

    const [hers, control] = await Promise.all([
      resolveAgentProviderAndModel(agent(VOICE_AGENT_SLUG)),
      resolveAgentProviderAndModel(agent(VOICE_CONTROL_AGENT_SLUG)),
    ]);

    expect(hers).toEqual(control);
    expect(hers).toEqual({ providerSlug: PINNED_PROVIDER, model: PINNED_MODEL, fallbacks: [] });
  });
});

describe('the unit re-runs when what it pins changes', () => {
  it('hashes the pinned model, the pins, and both modules the slugs come from', () => {
    expect(unit.hashInputs).toEqual([
      '../../../lib/app/agent/pinned-model.ts',
      '../../../lib/app/agent/pins.ts',
      '../../../lib/app/voice/fingerprint.ts',
      '../../../lib/app/voice/golden-set.ts',
    ]);
  });
});
