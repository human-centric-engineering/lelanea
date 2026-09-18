/**
 * The model-pin seed: what it fills, what it must never write over, and the entry
 * it leaves in the timeline.
 *
 * ## 1. `fp4` — three kinds of row, three ownership rules
 *
 * HER provider and model are **operator-owned**: filled only where both are
 * still blank, because production's model is an admin edit and a re-seed that
 * undid it would make the pin impossible to change without a deploy. The
 * CONTROL's **follow hers** — it is an instrument, so a blank control is set to
 * whatever she is on, never to the dev pin on its own account. The matrix row is
 * seed-managed under the platform's `isDefault` protocol.
 *
 * And one thing it must NOT write: the platform's default task models. The
 * first version filled them, which pre-empted the setup wizard — see the seed's
 * header.
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
  deletedAt: Date | null;
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

const world = {
  users: [{ id: 'service-account', accountType: 'SERVICE' }],
  agents: [] as FakeAgent[],
  versions: [] as FakeVersion[],
  matrix: [] as FakeMatrixRow[],
  providers: [] as { slug: string; isActive: boolean }[],
};

/** Every write the fake saw, so "a re-run writes nothing" is checkable. */
const writes = {
  agentUpdate: 0,
  versionCreate: 0,
  matrixCreate: 0,
  matrixUpdate: 0,
  settingsTouched: 0,
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

/** Set by a test to act as "an admin, a moment before the seed's write lands". */
let beforeAgentWrite: (() => void) | undefined;

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
    findMany: vi.fn(async ({ where }: { where: { slug: { in: string[] }; deletedAt: null } }) =>
      // COPIES, as a real read returns: the seed holds these across its writes,
      // and a live reference would make "the row as it was read" and "the row as
      // it is now" the same object — so no staleness bug could ever show here.
      world.agents
        .filter(
          (agent) => where.slug.in.includes(agent.slug) && agent.deletedAt === where.deletedAt
        )
        .map((agent) => structuredClone(agent))
    ),
    // The seed's only write to an agent. The predicate is honoured, because the
    // point of it is the row that does NOT match.
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; provider: string; model: string };
        data: Partial<FakeAgent>;
      }) => {
        beforeAgentWrite?.();
        const agent = world.agents.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.provider === where.provider &&
            candidate.model === where.model
        );
        if (!agent) return { count: 0 };
        writes.agentUpdate += 1;
        Object.assign(agent, data);
        return { count: 1 };
      }
    ),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const agent = world.agents.find((candidate) => candidate.id === where.id);
      if (!agent) throw new Error(`No agent ${where.id}`);
      return agent;
    }),
  },
  aiAgentVersion: {
    findFirst: vi.fn(async ({ where }: { where: { agentId: string; changeSummary?: string } }) => {
      const mine = world.versions.filter(
        (version) =>
          version.agentId === where.agentId &&
          (where.changeSummary === undefined || version.changeSummary === where.changeSummary)
      );
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
  aiProviderConfig: {
    findMany: vi.fn(async ({ where }: { where: { isActive: boolean } }) =>
      world.providers.filter((provider) => provider.isActive === where.isActive)
    ),
  },
  // Present ONLY so a seed that reached for the settings singleton is counted
  // rather than crashing on `undefined` — this unit must not touch it at all.
  aiOrchestrationSettings: {
    findUnique: vi.fn(async () => ((writes.settingsTouched += 1), null)),
    create: vi.fn(async () => ((writes.settingsTouched += 1), null)),
    update: vi.fn(async () => ((writes.settingsTouched += 1), null)),
    upsert: vi.fn(async () => ((writes.settingsTouched += 1), null)),
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
  CONTROL_FOLLOWS_SUMMARY,
  PINNED_MODEL,
  PINNED_MODEL_MATRIX_ROW,
  PINNED_PROVIDER,
  PIN_CHANGE_SUMMARY,
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
    deletedAt: null,
    grantedTags: [],
    grantedDocuments: [],
  };
}

function agent(slug: string): FakeAgent {
  const found = world.agents.find((candidate) => candidate.slug === slug);
  if (!found) throw new Error(`No agent ${slug} in the fake`);
  return found;
}

const hers = (): FakeAgent => agent(VOICE_AGENT_SLUG);
const control = (): FakeAgent => agent(VOICE_CONTROL_AGENT_SLUG);

function versionsOf(slug: string): FakeVersion[] {
  return world.versions
    .filter((version) => version.agentId === agent(slug).id)
    .sort((a, b) => a.version - b.version);
}

/** The warnings the run logged, as their message strings. */
function warnings(): string[] {
  return vi.mocked(logger.warn).mock.calls.map(([message]) => String(message));
}

beforeEach(() => {
  vi.clearAllMocks();
  world.agents = [blankAgent(VOICE_AGENT_SLUG), blankAgent(VOICE_CONTROL_AGENT_SLUG)];
  world.versions = [];
  world.matrix = [];
  world.providers = [{ slug: PINNED_PROVIDER, isActive: true }];
  beforeAgentWrite = undefined;
  resetWrites();
});

describe('a fresh install', () => {
  it('pins both arms to a dated model and an explicit provider, with no fallback', async () => {
    await runSeed();

    for (const arm of [hers(), control()]) {
      expect(arm.provider).toBe(PINNED_PROVIDER);
      expect(arm.model).toBe(PINNED_MODEL);
      expect(arm.fallbackProviders).toEqual([]);
    }
  });

  it('pins a dated snapshot, never an alias that can be repointed', () => {
    // §8.2: "version pinning, never latest". An alias passes every other test in
    // this file, so the shape of the id is pinned on its own.
    expect(PINNED_MODEL).toMatch(/-\d{4}-\d{2}-\d{2}$/);
    expect(PINNED_PROVIDER).not.toBe('');
  });

  it('records each change in the version timeline, over the blank state it replaced', async () => {
    await runSeed();

    const herTimeline = versionsOf(VOICE_AGENT_SLUG);
    expect(herTimeline.map((version) => version.changeSummary)).toEqual([
      INITIAL_VERSION_SUMMARY,
      PIN_CHANGE_SUMMARY,
    ]);
    // v1 is the state BEFORE the pin — not a second copy of the pinned one.
    expect(herTimeline[0]?.snapshot.model).toBe('');
    expect(herTimeline[1]?.snapshot.model).toBe(PINNED_MODEL);
    expect(herTimeline[1]?.snapshot.provider).toBe(PINNED_PROVIDER);

    // The control's entry says what actually happened to it: it was matched to
    // her, not pinned on its own account.
    expect(versionsOf(VOICE_CONTROL_AGENT_SLUG).map((version) => version.changeSummary)).toEqual([
      INITIAL_VERSION_SUMMARY,
      CONTROL_FOLLOWS_SUMMARY,
    ]);
  });

  it('numbers the pin after whatever history the agent already has', async () => {
    world.versions.push({
      agentId: hers().id,
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

  it('adds the dated id to the matrix as a seed-managed row, with every column it names', async () => {
    await runSeed();

    expect(world.matrix).toHaveLength(1);
    // The WHOLE row, not a sample of it: the seed derives its column list from
    // this constant, and a column that dropped out of the derivation would be
    // created nowhere.
    expect(world.matrix[0]).toMatchObject({
      ...PINNED_MODEL_MATRIX_ROW,
      capabilities: [...PINNED_MODEL_MATRIX_ROW.capabilities],
      isDefault: true,
    });
  });

  it('does not touch the platform’s default task models', async () => {
    await runSeed();

    // Population: the run wrote — so "untouched" is a seed that wrote elsewhere,
    // not one that did nothing.
    expect(writes.agentUpdate).toBe(2);
    // Filling them here pre-empts the setup wizard, which fills the same slots
    // from the provider the operator actually configures. See the seed's header.
    expect(writes.settingsTouched).toBe(0);
  });
});

describe('a re-run', () => {
  it('writes nothing at all', async () => {
    await runSeed();
    // The population: the first run really did write, to every table it owns.
    expect(writes.agentUpdate).toBe(2);
    expect(writes.versionCreate).toBe(4);
    expect(writes.matrixCreate).toBe(1);
    resetWrites();

    await runSeed();

    expect(totalWrites()).toBe(0);
  });
});

describe('the control follows her', () => {
  it('takes the model an admin chose for her — not the dev pin', async () => {
    hers().provider = 'anthropic';
    hers().model = 'claude-sonnet-4';

    await runSeed();

    // Hers is somebody's decision and survives untouched, with no entry.
    expect(hers()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4' });
    expect(versionsOf(VOICE_AGENT_SLUG)).toEqual([]);

    // The first version of the seed pinned each arm independently, and wrote the
    // dev pin here — a mismatch manufactured by the unit meant to prevent one.
    expect(control()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4' });
    expect(versionsOf(VOICE_CONTROL_AGENT_SLUG).at(-1)?.changeSummary).toBe(
      CONTROL_FOLLOWS_SUMMARY
    );
    expect(warnings().some((message) => message.includes('different models'))).toBe(false);
  });

  it.each([
    ['a provider with no model', { provider: 'anthropic', model: '' }],
    ['a model with no provider', { provider: '', model: 'claude-sonnet-4' }],
  ])(
    'treats %s on her as an edit, guesses nothing, and leaves the control blank',
    async (_label, edit) => {
      Object.assign(hers(), edit);

      await runSeed();

      // Population: the run still wrote — the matrix row — so nothing below is a
      // seed that bailed out early.
      expect(writes.matrixCreate).toBe(1);

      expect(hers()).toMatchObject(edit);
      expect(control()).toMatchObject({ provider: '', model: '' });
      expect(writes.agentUpdate).toBe(0);
      expect(warnings().some((message) => message.includes('different models'))).toBe(true);
    }
  );

  it('leaves a control somebody set alone, and says the arms differ', async () => {
    control().provider = 'anthropic';
    control().model = 'claude-haiku-4.5';

    await runSeed();

    // Population: she WAS pinned in this run.
    expect(hers().model).toBe(PINNED_MODEL);

    expect(control()).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4.5' });
    expect(versionsOf(VOICE_CONTROL_AGENT_SLUG)).toEqual([]);
    expect(warnings().some((message) => message.includes('different models'))).toBe(true);
  });

  it('says nothing when a control somebody set already matches her', async () => {
    Object.assign(hers(), { provider: 'anthropic', model: 'claude-sonnet-4' });
    Object.assign(control(), { provider: 'anthropic', model: 'claude-sonnet-4' });

    await runSeed();

    expect(writes.agentUpdate).toBe(0);
    expect(warnings().some((message) => message.includes('different models'))).toBe(false);
  });
});

describe('what an operator chose is never written over', () => {
  it('names the matrix row after the model it is for', () => {
    // Derived, not typed out: change the pin and a NEW row is created under its
    // own slug, rather than the old row being rewritten under a stale name.
    expect(PINNED_MODEL_MATRIX_ROW.slug).toBe(`${PINNED_PROVIDER}-${PINNED_MODEL}`);
    expect(PINNED_MODEL_MATRIX_ROW.modelId).toBe(PINNED_MODEL);
  });

  it('reports a fallback list rather than clearing it', async () => {
    hers().fallbackProviders = ['anthropic'];

    await runSeed();

    expect(hers().model).toBe(PINNED_MODEL);
    expect(hers().fallbackProviders).toEqual(['anthropic']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no fallback'),
      expect.objectContaining({ fallbackProviders: ['anthropic'] })
    );
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
    row.contextLength = 'high';
    row.name = 'Something stale';

    await runSeed();

    expect(row.costPerMillionTokens).toBe(PINNED_MODEL_MATRIX_ROW.costPerMillionTokens);
    expect(row.contextLength).toBe(PINNED_MODEL_MATRIX_ROW.contextLength);
    expect(row.name).toBe(PINNED_MODEL_MATRIX_ROW.name);
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
    expect(hers().model).toBe(PINNED_MODEL);
  });
});

describe('whether there is anywhere for her turns to go', () => {
  const NO_PROVIDER_YET = 'no active provider yet';

  describe('a fresh install — no active provider at all', () => {
    beforeEach(() => {
      world.providers = [];
    });

    it('pins anyway — seeding runs before setup, and the runner does not come back', async () => {
      await runSeed();

      expect(hers().model).toBe(PINNED_MODEL);
      expect(control().model).toBe(PINNED_MODEL);
    });

    it('but says so', async () => {
      await runSeed();

      expect(warnings().some((message) => message.includes(NO_PROVIDER_YET))).toBe(true);
    });

    it('counts an inactive provider as not there', async () => {
      world.providers = [{ slug: 'anthropic', isActive: false }];

      await runSeed();

      expect(hers().model).toBe(PINNED_MODEL);
      expect(warnings().some((message) => message.includes(NO_PROVIDER_YET))).toBe(true);
    });
  });

  describe('a running install whose providers do not include the pinned one', () => {
    beforeEach(() => {
      world.providers = [
        { slug: 'anthropic', isActive: true },
        { slug: 'openai-prod', isActive: true },
      ];
    });

    it('throws, naming what the install has and both ways out', async () => {
      await expect(runSeed()).rejects.toThrow(/"anthropic", "openai-prod"/);
      await expect(runSeed()).rejects.toThrow('/admin/orchestration/agents');
    });

    it('writes nothing at all — she is working, and stays on what she was on', async () => {
      await expect(runSeed()).rejects.toThrow();

      expect(totalWrites()).toBe(0);
      expect(hers()).toMatchObject({ provider: '', model: '' });
      expect(control()).toMatchObject({ provider: '', model: '' });
    });

    it('passes once an admin has chosen her model — the remedy the error names', async () => {
      Object.assign(hers(), { provider: 'anthropic', model: 'claude-sonnet-4' });

      await runSeed();

      expect(control()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4' });
    });
  });

  it('is quiet when the pinned provider exists', async () => {
    await runSeed();

    // Population: the run did the work the warning is about.
    expect(hers().provider).toBe(PINNED_PROVIDER);
    expect(warnings().some((message) => message.includes(NO_PROVIDER_YET))).toBe(false);
  });
});

describe('a pin somebody undid', () => {
  it('stays undone — blank with a pin entry behind it is a decision, not a fresh agent', async () => {
    await runSeed();
    // An admin restores her to v1, "Initial configuration": the floating default.
    Object.assign(hers(), { provider: '', model: '' });
    resetWrites();

    // …and later a comment changes in a hashed file, so the unit runs again.
    await runSeed();

    expect(hers()).toMatchObject({ provider: '', model: '' });
    expect(writes.agentUpdate).toBe(0);
    expect(warnings().some((message) => message.includes('returned to the install default'))).toBe(
      true
    );
  });

  it('is not confused by history that is not a pin', async () => {
    // Population for the case above: other entries in her timeline do not count.
    world.versions.push({
      agentId: hers().id,
      version: 1,
      snapshot: { model: '' },
      changeSummary: 'Something an admin did',
      createdBy: 'someone',
    });

    await runSeed();

    expect(hers().model).toBe(PINNED_MODEL);
  });
});

describe('an admin who edits something else while the seed is running', () => {
  it('records what is actually there, so a later restore does not revert them', async () => {
    // The predicate on the write vouches for two columns. Everything else in the
    // snapshot has to be read after it, or v2 carries the temperature from the
    // top of the run and "restore to v2" quietly undoes the admin's edit.
    beforeAgentWrite = () => {
      beforeAgentWrite = undefined;
      hers().temperature = 0.2;
    };

    await runSeed();

    const timeline = versionsOf(VOICE_AGENT_SLUG);
    expect(timeline.at(-1)?.snapshot.model).toBe(PINNED_MODEL);
    expect(timeline.at(-1)?.snapshot.temperature).toBe(0.2);
    // v1 is how she was a moment before: the same, minus the pin.
    expect(timeline[0]?.snapshot.temperature).toBe(0.2);
    expect(timeline[0]?.snapshot.model).toBe('');
  });
});

describe('an admin who chooses her model while the seed is running', () => {
  it('keeps their choice, gets no "pinned" entry, and the control follows THEM', async () => {
    // Her row is read at the top of the run and written later. Without the
    // predicate on the write, this edit is replaced by the dev pin.
    beforeAgentWrite = () => {
      beforeAgentWrite = undefined;
      Object.assign(hers(), { provider: 'anthropic', model: 'claude-sonnet-4' });
    };

    await runSeed();

    expect(hers()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4' });
    expect(versionsOf(VOICE_AGENT_SLUG)).toEqual([]);
    // Population: the run did write — to the control, which followed what was
    // actually there rather than what the seed had meant to put there.
    expect(control()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4' });
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

  it('counts a soft-deleted agent as missing — units 003/004 will not recreate a taken slug', async () => {
    hers().deletedAt = new Date();

    await expect(runSeed()).rejects.toThrow(VOICE_AGENT_SLUG);
    expect(totalWrites()).toBe(0);
  });

  it('writes nothing before it throws — no install left with one arm pinned', async () => {
    world.agents = world.agents.filter((candidate) => candidate.slug !== VOICE_CONTROL_AGENT_SLUG);

    await expect(runSeed()).rejects.toThrow();

    expect(totalWrites()).toBe(0);
    expect(hers().model).toBe('');
  });
});

describe('the two arms of the golden set', () => {
  it('resolve to the same provider and model through the platform’s resolver', async () => {
    await runSeed();

    const [herPair, controlPair] = await Promise.all([
      resolveAgentProviderAndModel(hers()),
      resolveAgentProviderAndModel(control()),
    ]);

    expect(herPair).toEqual(controlPair);
    expect(herPair).toEqual({ providerSlug: PINNED_PROVIDER, model: PINNED_MODEL, fallbacks: [] });
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
