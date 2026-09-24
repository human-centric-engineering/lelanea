/**
 * The golden-set seed: what it writes, what a re-run must not, and the one case
 * where reconciling would quietly re-caption history.
 *
 * ## 1. `fp4` — idempotent, safe on empty, ownership classified
 *
 * The dataset and its cases are a pure code projection of the authored file; the
 * control agent is split, with the five columns that make it a control
 * reconciled and its name, description and temperature left to whoever edits
 * them. A re-run on a current database issues **no write at all**, which is the
 * only shape that can churn `updatedAt` in a harness with no database (`B9`).
 *
 * ## 2. The exception, and it is the interesting half
 *
 * A dataset case cannot be deleted once a run has scored it —
 * `AiEvaluationCaseResult.datasetCase` declares no `onDelete`, so Prisma's
 * default `Restrict` applies. So the seed reconciles a version nothing has run
 * yet, and **refuses** one something has, naming the remedy: bump the authored
 * version, which mints a new dataset beside the old one.
 *
 * Reconciling instead would re-caption every historical answer with a question it
 * was never asked, which is a worse outcome than a loud failure and an
 * indistinguishable one from a correct comparison.
 *
 * The freeze is about the CASES. The dataset's own name, description and tags are
 * not what any answer was given, and `contentHash` says nothing about them — so
 * they are reconciled on the unchanged-cases path, frozen version included, and
 * the suite below pins that they reach the row at all.
 *
 * ## 3. The control is reconciled back to bare
 *
 * An operator who attaches her profile to the control produces a comparison of
 * her voice with itself. `assertArmsComparable` refuses to QUEUE in that state
 * (`tests/unit/lib/app/voice/comparison.test.ts`); this file pins the half that
 * stops the state persisting.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * The seed under test projects Lelañea's authored golden set, so this file needs
 * that seam populated. A fork without one should delete this file with the seed.
 *
 * @see prisma/seeds/app-lelanea/004-voice-golden-set.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FakeDataset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  caseCount: number;
  contentHash: string;
  source: string;
  userId: string | null;
}

interface FakeCase {
  datasetId: string;
  position: number;
  input: unknown;
  metadata: unknown;
}

interface FakeAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  systemInstructions: string;
  model: string;
  provider: string;
  isActive: boolean;
  isSystem: boolean;
  knowledgeAccessMode: string;
  profileId: string | null;
  persona: string | null;
  guardrails: string | null;
  brandVoiceInstructions: string | null;
}

/** The `app_voice_golden_set` row — the pointer and its provenance (t-88). */
interface FakeGoldenSetPointer {
  id: string;
  title: string;
  version: string;
  locale: string;
  provenance: unknown;
  status: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One snapshot in `app_voice_golden_set_revision`. */
interface FakeGoldenSetRevision {
  setId: string;
  revision: number;
  title: string;
  version: string;
  locale: string;
  provenance: unknown;
  status: string;
  changedFields: string[];
  origin: string;
  editorId: string | null;
  changedAt: Date;
}

const world = {
  users: [{ id: 'service-account', accountType: 'SERVICE' }],
  datasets: [] as FakeDataset[],
  cases: [] as FakeCase[],
  agents: [] as FakeAgent[],
  runs: [] as { id: string; datasetId: string }[],
  goldenSet: null as FakeGoldenSetPointer | null,
  goldenSetRevisions: [] as FakeGoldenSetRevision[],
};

/** Every write the fake saw, so "a re-run writes nothing" is checkable. */
const writes = {
  datasetCreate: 0,
  datasetUpdate: 0,
  caseDeleteMany: 0,
  caseCreateMany: 0,
  agentCreate: 0,
  agentUpdate: 0,
  pointerCreate: 0,
  pointerRevisionCreate: 0,
};

let nextId = 0;

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * A stateful fake rather than sequenced one-shot mocks.
 *
 * The idempotence claim needs the seed's SECOND run to read what its first run
 * wrote, and the freeze claim needs a run row to exist beside the dataset. Neither
 * is expressible as "the third call returns this".
 */
const prisma = {
  user: {
    findFirst: vi.fn(
      async ({ where }: { where: { accountType: string } }) =>
        world.users.find((user) => user.accountType === where.accountType) ?? null
    ),
  },
  aiDataset: {
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) =>
        world.datasets.find((dataset) => dataset.id === where.id) ?? null
    ),
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<FakeDataset, 'userId'> & {
          userId: string | null;
          cases?: { create: Omit<FakeCase, 'datasetId'>[] };
        };
      }) => {
        writes.datasetCreate += 1;
        const { cases, ...row } = data;
        world.datasets.push(row);
        for (const entry of cases?.create ?? []) {
          world.cases.push({ datasetId: row.id, ...entry });
        }
        return row;
      }
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<FakeDataset> }) => {
        writes.datasetUpdate += 1;
        const dataset = world.datasets.find((candidate) => candidate.id === where.id);
        if (!dataset) throw new Error(`No dataset ${where.id}`);
        Object.assign(dataset, data);
        return dataset;
      }
    ),
  },
  aiDatasetCase: {
    deleteMany: vi.fn(async ({ where }: { where: { datasetId: string } }) => {
      writes.caseDeleteMany += 1;
      world.cases = world.cases.filter((entry) => entry.datasetId !== where.datasetId);
      return { count: 0 };
    }),
    createMany: vi.fn(async ({ data }: { data: FakeCase[] }) => {
      writes.caseCreateMany += 1;
      world.cases.push(...data);
      return { count: data.length };
    }),
  },
  aiEvaluationRun: {
    count: vi.fn(
      async ({ where }: { where: { datasetId: string } }) =>
        world.runs.filter((run) => run.datasetId === where.datasetId).length
    ),
  },
  aiAgent: {
    findUnique: vi.fn(
      async ({ where }: { where: { slug: string } }) =>
        world.agents.find((agent) => agent.slug === where.slug) ?? null
    ),
    create: vi.fn(async ({ data }: { data: Partial<FakeAgent> }) => {
      writes.agentCreate += 1;
      const agent = {
        id: `agent-${(nextId += 1)}`,
        profileId: null,
        // The three inheritable columns default to NULL in the schema, so a seed
        // that omits them must land NULL here — not `undefined`, which would make
        // "the control carries none of its own" pass without the seed omitting them.
        persona: null,
        guardrails: null,
        brandVoiceInstructions: null,
        ...data,
      } as FakeAgent;
      world.agents.push(agent);
      return agent;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeAgent> & { profile?: { disconnect: boolean } };
      }) => {
        writes.agentUpdate += 1;
        const agent = world.agents.find((candidate) => candidate.id === where.id);
        if (!agent) throw new Error(`No agent ${where.id}`);
        const { profile, ...columns } = data;
        Object.assign(agent, columns);
        if (profile?.disconnect) agent.profileId = null;
        return agent;
      }
    ),
  },
  // The pointer row (t-88): which authored version is current, write-once. Its
  // own two tables rather than a facet of `aiDataset`, because the platform's
  // model has nowhere to hold "which version" or the provenance block.
  appVoiceGoldenSet: {
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) =>
        (world.goldenSet && world.goldenSet.id === where.id ? world.goldenSet : null) ?? null
    ),
    create: vi.fn(async ({ data }: { data: FakeGoldenSetPointer }) => {
      writes.pointerCreate += 1;
      world.goldenSet = { ...data };
      return world.goldenSet;
    }),
  },
  appVoiceGoldenSetRevision: {
    create: vi.fn(async ({ data }: { data: FakeGoldenSetRevision }) => {
      writes.pointerRevisionCreate += 1;
      world.goldenSetRevisions.push({ ...data });
      return data;
    }),
  },
  // The seed's reconcile path batches its three writes. The fake runs them in
  // order, which is what the real client does too.
  $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
};

import { logger } from '@/lib/logging';
import unit, {
  CONTROL_KNOWLEDGE_ACCESS_MODE,
} from '@/prisma/seeds/app-lelanea/004-voice-golden-set';
import { getVoiceGoldenSet } from '@/lib/app/content/seed-input/voice-golden-set';
import { VOICE_CONTROL_AGENT_SLUG, goldenSetDatasetId } from '@/lib/app/voice/golden-set';
import { VOICE_GOLDEN_SET_ID } from '@/lib/app/content/golden-set-store';

function ctx() {
  return { prisma: prisma as never, logger: logger as never };
}

async function runSeed(): Promise<void> {
  await unit.run(ctx());
}

const goldenSet = getVoiceGoldenSet();
const datasetId = goldenSetDatasetId(goldenSet.collection.version);

function control(): FakeAgent {
  const agent = world.agents.find((candidate) => candidate.slug === VOICE_CONTROL_AGENT_SLUG);
  if (!agent) throw new Error('The seed left no control agent behind');
  return agent;
}

/** The golden set pointer row the seed left behind, or a loud failure. */
function pointer(): FakeGoldenSetPointer {
  if (!world.goldenSet) throw new Error('The seed left no golden set pointer behind');
  return world.goldenSet;
}

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 0;
  world.datasets = [];
  world.cases = [];
  world.agents = [];
  world.runs = [];
  world.goldenSet = null;
  world.goldenSetRevisions = [];
  for (const key of Object.keys(writes) as (keyof typeof writes)[]) writes[key] = 0;
});

describe('a fresh install', () => {
  it('writes the dataset under a versioned id, with one case per authored prompt', async () => {
    await runSeed();

    expect(world.datasets).toHaveLength(1);
    expect(world.datasets[0]?.id).toBe(datasetId);
    expect(world.datasets[0]?.caseCount).toBe(goldenSet.prompts.length);
    expect(world.cases).toHaveLength(goldenSet.prompts.length);

    // The set belongs to the install, not to a person — so it survives the
    // service account and is not scoped out of anybody's view by an owner they
    // do not share.
    expect(world.datasets[0]?.userId).toBeNull();
  });

  it('carries each prompt whole, with what it is probing beside it', async () => {
    await runSeed();

    const ordered = [...world.cases].sort((a, b) => a.position - b.position);
    expect(ordered.map((entry) => entry.input)).toEqual(
      goldenSet.prompts.map((prompt) => prompt.prompt)
    );
    // `probe` is what tells whoever reads two answers what the question was
    // testing. Dropped, the surface still renders and the comparison becomes a
    // vibe — so it is pinned on the row rather than trusted to the projection.
    expect(ordered.map((entry) => entry.metadata)).toEqual(
      goldenSet.prompts.map((prompt) => ({
        key: prompt.key,
        kind: prompt.kind,
        probe: prompt.probe,
      }))
    );
  });

  it('creates the control bare, restricted, and with nothing of hers on it', async () => {
    await runSeed();

    expect(control().systemInstructions).toBe(goldenSet.control.systemInstructions);
    expect(control().knowledgeAccessMode).toBe(CONTROL_KNOWLEDGE_ACCESS_MODE);
    expect(control().profileId).toBeNull();
    expect(control().persona).toBeNull();
    expect(control().guardrails).toBeNull();
    expect(control().brandVoiceInstructions).toBeNull();

    // Empty provider/model is what makes both arms resolve to the SAME install
    // default without either naming a model — the condition the queue-time guard
    // then enforces.
    expect(control().provider).toBe('');
    expect(control().model).toBe('');
  });

  it('writes the golden set pointer at revision 1, draft, with the authored version', async () => {
    await runSeed();

    expect(pointer()).toMatchObject({
      id: VOICE_GOLDEN_SET_ID,
      version: goldenSet.collection.version,
      status: 'draft',
      revision: 1,
    });
    // One revision recorded beside it, carrying the same authored version —
    // t-92's editor reads this table, not just the pointer's current row.
    expect(world.goldenSetRevisions).toHaveLength(1);
    expect(world.goldenSetRevisions[0]).toMatchObject({
      setId: VOICE_GOLDEN_SET_ID,
      revision: 1,
      version: goldenSet.collection.version,
      status: 'draft',
      origin: 'seed',
    });
  });
});

describe('a re-run', () => {
  it('writes nothing at all on a current database', async () => {
    await runSeed();
    for (const key of Object.keys(writes) as (keyof typeof writes)[]) writes[key] = 0;

    await runSeed();

    expect(writes).toEqual({
      datasetCreate: 0,
      datasetUpdate: 0,
      caseDeleteMany: 0,
      caseCreateMany: 0,
      agentCreate: 0,
      agentUpdate: 0,
      pointerCreate: 0,
      pointerRevisionCreate: 0,
    });
  });

  it('leaves an edited golden set pointer alone on a second run', async () => {
    // f-content-seeds t-88's done-when: a second seed run leaves an edited row
    // alone. The pointer is write-once (unlike the dataset beside it) because
    // it is about to become editable in t-92, and an operator who repoints the
    // install at a different version must not have that undone on the next boot.
    await runSeed();
    expect(writes.pointerCreate).toBe(1);

    pointer().version = '9.9';
    pointer().status = 'signed_off';

    await runSeed();

    expect(pointer().version).toBe('9.9');
    expect(pointer().status).toBe('signed_off');
    // Not just "the fields survived" — nothing wrote a second time, and no
    // second revision was minted behind the operator's back.
    expect(writes.pointerCreate).toBe(1);
    expect(world.goldenSetRevisions).toHaveLength(1);
  });

  it('puts the control back when somebody gave it her profile', async () => {
    await runSeed();
    control().profileId = 'profile-core';
    control().persona = 'her persona, pasted';

    await runSeed();

    expect(control().profileId).toBeNull();
    expect(control().persona).toBeNull();
    expect(writes.agentUpdate).toBe(1);
  });

  it('puts the control instructions back when somebody edited them', async () => {
    await runSeed();
    control().systemInstructions = 'You are Lelañea.';

    await runSeed();

    expect(control().systemInstructions).toBe(goldenSet.control.systemInstructions);
  });
});

describe('the authored prompts changed', () => {
  /**
   * Make the stored dataset disagree with what the file now projects — which,
   * since t-92, is what an admin edit on the Voice page leaves behind.
   */
  function driftTheStoredSet(): void {
    world.datasets[0].contentHash = 'a-hash-from-an-admin-edit';
  }

  it('leaves the prompts alone while nothing has been asked of the version', async () => {
    await runSeed();
    driftTheStoredSet();
    const before = world.cases.length;
    for (const key of Object.keys(writes) as (keyof typeof writes)[]) writes[key] = 0;

    await runSeed();

    // The admin owns them now. Reconciling them back to the file here is what
    // would undo an edit made on the Voice page.
    expect(writes.caseDeleteMany).toBe(0);
    expect(writes.caseCreateMany).toBe(0);
    expect(world.cases).toHaveLength(before);
    expect(world.datasets[0]?.contentHash).toBe('a-hash-from-an-admin-edit');
  });

  it('leaves them alone once a run exists too, rather than refusing the whole seed', async () => {
    await runSeed();
    driftTheStoredSet();
    world.runs.push({ id: 'run-1', datasetId });

    await expect(runSeed()).resolves.toBeUndefined();

    expect(writes.caseDeleteMany).toBe(0);
    expect(world.cases).toHaveLength(goldenSet.prompts.length);
  });

  it('says it left them, so a skipped reconcile is not read as a seed that did nothing', async () => {
    await runSeed();
    driftTheStoredSet();
    vi.mocked(logger.info).mockClear();

    await runSeed();

    expect(
      vi
        .mocked(logger.info)
        .mock.calls.some(([message]) => String(message).includes('edited on the Voice page'))
    ).toBe(true);
  });
});

describe('the words ABOUT the questions changed', () => {
  /**
   * `contentHash` is `hashDatasetCases(cases)` — it moves when a PROMPT changes
   * and not when the dataset's description does. Editing the description in the
   * content file therefore re-runs the unit (it is a `hashInputs` file) and lands
   * on the "already at v…" branch, where a unit that simply logged and returned
   * would leave the stale words in the row for good.
   */
  function staleWordsInTheRow(): void {
    world.datasets[0].description = 'A description somebody edited in the admin UI.';
    world.datasets[0].tags = ['stale'];
  }

  it('reconciles the description and tags without touching a single case', async () => {
    await runSeed();
    staleWordsInTheRow();
    for (const key of Object.keys(writes) as (keyof typeof writes)[]) writes[key] = 0;

    await runSeed();

    expect(world.datasets[0]?.description).toBe(goldenSet.dataset.description);
    expect(world.datasets[0]?.tags).toEqual([...goldenSet.dataset.tags]);
    expect(writes.datasetUpdate).toBe(1);
    // The questions were current, and re-writing them is the one thing that
    // cannot be undone once answers hang off them.
    expect(writes.caseDeleteMany).toBe(0);
    expect(writes.caseCreateMany).toBe(0);
  });

  it('reconciles them on a version that has already been run, rather than refusing', async () => {
    await runSeed();
    staleWordsInTheRow();
    world.runs.push({ id: 'run-1', datasetId });

    // The freeze exists because an answer is only readable beside the question
    // that produced it. A tag list is not a question, and nothing was answered
    // against the description.
    await expect(runSeed()).resolves.toBeUndefined();

    expect(world.datasets[0]?.description).toBe(goldenSet.dataset.description);
    expect(writes.caseDeleteMany).toBe(0);
  });

  it('names what it corrected', async () => {
    await runSeed();
    staleWordsInTheRow();
    vi.mocked(logger.info).mockClear();

    await runSeed();

    // A silent correction of a row an operator may have edited on purpose is how
    // the next person concludes the seed is not running at all.
    const corrected = vi
      .mocked(logger.info)
      .mock.calls.find(([message]) => String(message).includes('Corrected golden set'));
    expect(corrected?.[1]).toEqual({ fields: ['description', 'tags'] });
  });
});

describe('a set that projected to nothing', () => {
  it('THROWS rather than returning, so the runner cannot bank the abort as applied', async () => {
    // `prisma/runner.ts` upserts the `SeedHistory` row the moment `run()`
    // resolves and logs `✓ applied`, so a quiet return would make every later
    // `db:seed` skip the unit — leaving an install with no golden set,
    // permanently, until somebody deleted the history row by hand.
    vi.doMock('@/lib/app/voice/golden-set', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/app/voice/golden-set')>();
      return { ...actual, projectGoldenSetCases: () => [] };
    });
    vi.resetModules();

    const emptyUnit = (await import('@/prisma/seeds/app-lelanea/004-voice-golden-set')).default;
    await expect(emptyUnit.run(ctx())).rejects.toThrow(/projected to no cases/);
    expect(world.datasets).toHaveLength(0);

    vi.doUnmock('@/lib/app/voice/golden-set');
    vi.resetModules();
  });
});

describe('what a change to the tree has to re-run', () => {
  const SEED_PATH = join(
    process.cwd(),
    'prisma',
    'seeds',
    'app-lelanea',
    '004-voice-golden-set.ts'
  );

  it('names every input between the authored words and the rows', () => {
    // This unit had no pin at all, which is how its loader entry went stale
    // unnoticed: t-89 moved `getVoiceGoldenSet()` into `seed-input/` and the
    // list kept naming `lib/app/content/index.ts`, a module this unit does not
    // import. Nothing was asserting the list, so nothing had to be updated.
    //
    // Without a correct `hashInputs` the unit's content hash covers only its own
    // source: change what the loader projects, run `db:seed` against a seeded
    // database, and the unit is skipped — leaving stale dataset cases and a
    // stale control prompt with nothing anywhere to say so.
    //
    // `seed-input/golden-set-seed.ts` is absent on purpose, which this pin is
    // the natural place to "correct". `buildGoldenSetSeed()` does choose what
    // lands in the pointer row — but its only consumer is write-once, as
    // `a re-run > leaves an edited golden set pointer alone on a second run`
    // pins, so hashing it would re-run the unit and no-op on the way past.
    // The premise is that case, not this comment: if it ever goes, add it.
    expect(unit.hashInputs).toEqual([
      '../../../seed-data/drafted/lelanea_voice_golden_set.json',
      '../../../lib/app/content/seed-input/voice-golden-set.ts',
      '../../../lib/app/content/schemas.ts',
      '../../../lib/app/voice/golden-set.ts',
    ]);
  });

  it('names paths that resolve', () => {
    // RESOLVED, not just compared to a string. `prisma/runner.ts` throws on a
    // hashInput it cannot read — at seed time, which is the wrong moment to find
    // out a relative path is one `../` short.
    expect(unit.hashInputs?.length).toBeGreaterThan(0);
    for (const relative of unit.hashInputs ?? []) {
      expect(existsSync(resolve(dirname(SEED_PATH), relative)), relative).toBe(true);
    }
  });

  it('names a seed-input module this unit actually imports', () => {
    // The case above cannot catch a path that is stale but still resolves, which
    // is exactly what was here: `lib/app/content/index.ts` resolves, so a
    // resolution check would have passed while the hash covered the wrong module.
    //
    // Scoped to `seed-input/` on purpose: a seed reaches its loader and builder
    // directly, because that folder is the only way to the file. The rest of the
    // list is reached transitively and would need a graph walk, which is what
    // `tests/unit/lib/app/content/runtime-import-graph.test.ts` is for.
    const source = readFileSync(SEED_PATH, 'utf-8');
    const seedInputs = (unit.hashInputs ?? []).filter((relative) =>
      relative.includes('/lib/app/content/seed-input/')
    );

    expect(seedInputs.length).toBeGreaterThan(0);
    for (const relative of seedInputs) {
      const specifier = `@${relative.replace(/^(\.\.\/)+/, '/').replace(/\.tsx?$/, '')}`;
      expect(source, `${relative} is hashed but never imported`).toContain(`from '${specifier}'`);
    }
  });

  it('is filed where the runner will discover it', () => {
    expect(unit.name).toBe('app-lelanea/004-voice-golden-set');
  });
});
