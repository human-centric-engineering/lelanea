/**
 * Two versions' answers land beside each other because they answer the same
 * QUESTION — not because they happened to be in the same row.
 *
 * The join is the only real logic in the read layer, and getting it wrong is
 * silent in the worst way: line the greeting up against the decline and the
 * surface renders a regression that nothing about her voice caused. Two versions
 * of the golden set are explicitly allowed to reorder, drop and add prompts —
 * that is what a version IS — so joining on `position` would produce exactly that
 * every time the set was edited.
 *
 * The other thing pinned here is the gap. A question one version asked and the
 * other did not has to render as an empty column rather than vanishing, because a
 * case silently missing from a comparison reads as a case that passed.
 *
 * Two more gaps, both of which render as a working page: an arm whose run has
 * been deleted (`ON DELETE SET NULL` keeps the prompt and the version; nothing
 * keeps the answers), and a question two versions worded differently under the
 * same key. Each has its own suite below.
 *
 * @see lib/app/voice/comparison-admin.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FakeRun {
  id: string;
  status: string;
  progress: unknown;
  summary: unknown;
  datasetId: string;
}

const world = {
  comparisons: [] as {
    id: string;
    goldenSetVersion: string;
    datasetContentHash: string;
    createdAt: Date;
    arms: {
      arm: string;
      agentSlug: string;
      fingerprintVersion: string | null;
      systemPrompt: string;
      evaluationRunId: string | null;
    }[];
  }[],
  runs: [] as FakeRun[],
  cases: [] as { datasetId: string; position: number; input: unknown; metadata: unknown }[],
  results: [] as {
    runId: string;
    casePosition: number;
    subjectOutput: string;
    errorMessage: string | null;
    metricScores: unknown;
  }[],
};

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appVoiceComparison: {
      findMany: vi.fn(async ({ where }: { where?: { id: { in: string[] } } }) =>
        where ? world.comparisons.filter((c) => where.id.in.includes(c.id)) : world.comparisons
      ),
    },
    aiEvaluationRun: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        world.runs.filter((run) => where.id.in.includes(run.id))
      ),
    },
    aiDatasetCase: {
      findMany: vi.fn(async ({ where }: { where: { datasetId: { in: string[] } } }) =>
        world.cases.filter((entry) => where.datasetId.in.includes(entry.datasetId))
      ),
    },
    aiEvaluationCaseResult: {
      findMany: vi.fn(async ({ where }: { where: { runId: { in: string[] } } }) =>
        world.results.filter((result) => where.runId.in.includes(result.runId))
      ),
    },
  },
}));

import { prisma } from '@/lib/db/client';
import { getVoiceComparison, listVoiceComparisons } from '@/lib/app/voice/comparison-admin';
import { VOICE_RUN_DELETED_STATUS } from '@/lib/validations/app-voice-comparison';
import { BRAND_VOICE_JUDGE_SLUG, VOICE_ARM_LABELS } from '@/lib/app/voice/golden-set';

const PROGRESS = { casesTotal: 2, casesDone: 2, casesFailed: 0 };

function score(value: number) {
  return { [BRAND_VOICE_JUDGE_SLUG]: { score: value, reasoning: 'because' } };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Two comparisons over two VERSIONS of the set. v1.1 reorders the two shared
  // prompts and swaps one of them for a new question — the exact shape a
  // position-based join gets wrong.
  world.cases = [
    {
      datasetId: 'set-v1.0',
      position: 0,
      input: 'Hi.',
      metadata: { key: 'hello', kind: 'greeting', probe: 'p' },
    },
    {
      datasetId: 'set-v1.0',
      position: 1,
      input: 'Diagnose me.',
      metadata: { key: 'decline', kind: 'decline', probe: 'p' },
    },
    {
      datasetId: 'set-v1.1',
      position: 0,
      input: 'Diagnose me.',
      metadata: { key: 'decline', kind: 'decline', probe: 'p' },
    },
    {
      datasetId: 'set-v1.1',
      position: 1,
      input: 'Rank me.',
      metadata: { key: 'ranking', kind: 'decline', probe: 'p' },
    },
  ];

  world.runs = [
    {
      id: 'run-a1',
      status: 'completed',
      progress: PROGRESS,
      summary: { stats: { [BRAND_VOICE_JUDGE_SLUG]: { mean: 0.9 } } },
      datasetId: 'set-v1.0',
    },
    { id: 'run-a2', status: 'completed', progress: PROGRESS, summary: {}, datasetId: 'set-v1.0' },
    {
      id: 'run-b1',
      status: 'running',
      progress: { casesTotal: 2, casesDone: 1, casesFailed: 0 },
      summary: null,
      datasetId: 'set-v1.1',
    },
    {
      id: 'run-b2',
      status: 'queued',
      progress: { casesTotal: 2, casesDone: 0, casesFailed: 0 },
      summary: null,
      datasetId: 'set-v1.1',
    },
  ];

  world.comparisons = [
    {
      id: 'cmp-a',
      goldenSetVersion: '1.0',
      datasetContentHash: 'hash-a',
      createdAt: new Date('2026-09-01T10:00:00Z'),
      arms: [
        {
          arm: 'bare',
          agentSlug: 'voice-control-bare',
          fingerprintVersion: null,
          systemPrompt: 'bare prompt',
          evaluationRunId: 'run-a2',
        },
        {
          arm: 'fingerprint',
          agentSlug: 'lelanea-guide',
          fingerprintVersion: '1.0',
          systemPrompt: 'her prompt v1.0',
          evaluationRunId: 'run-a1',
        },
      ],
    },
    {
      id: 'cmp-b',
      goldenSetVersion: '1.1',
      datasetContentHash: 'hash-b',
      createdAt: new Date('2026-09-02T10:00:00Z'),
      arms: [
        {
          arm: 'bare',
          agentSlug: 'voice-control-bare',
          fingerprintVersion: null,
          systemPrompt: 'bare prompt',
          evaluationRunId: 'run-b2',
        },
        {
          arm: 'fingerprint',
          agentSlug: 'lelanea-guide',
          fingerprintVersion: '1.1',
          systemPrompt: 'her prompt v1.1',
          evaluationRunId: 'run-b1',
        },
      ],
    },
  ];

  world.results = [
    {
      runId: 'run-a1',
      casePosition: 0,
      subjectOutput: 'v1.0 on hello',
      errorMessage: null,
      metricScores: score(0.9),
    },
    {
      runId: 'run-a1',
      casePosition: 1,
      subjectOutput: 'v1.0 on decline',
      errorMessage: null,
      metricScores: score(0.8),
    },
    // v1.1 answers the SHARED prompt at a different position.
    {
      runId: 'run-b1',
      casePosition: 0,
      subjectOutput: 'v1.1 on decline',
      errorMessage: null,
      metricScores: score(0.95),
    },
  ];
});

describe('listVoiceComparisons', () => {
  it('labels each arm with the version it was wearing, and reports its run status', async () => {
    const list = await listVoiceComparisons();

    const fingerprint = list
      .find((entry) => entry.id === 'cmp-a')
      ?.arms.find((arm) => arm.arm === 'fingerprint');
    expect(fingerprint?.label).toBe(`${VOICE_ARM_LABELS.fingerprint} · v1.0`);
    expect(fingerprint?.brandVoiceMean).toBe(0.9);
    expect(fingerprint?.status).toBe('completed');

    // The bare arm carries no version, so its label carries none either — a
    // bare column headed `· v1.0` would be a lie on the one column whose whole
    // job is to have no fingerprint. Through the constant, not the wording: the
    // rule is the behaviour, the label text is copy.
    const bare = list.find((entry) => entry.id === 'cmp-a')?.arms.find((arm) => arm.arm === 'bare');
    expect(bare?.label).toBe(VOICE_ARM_LABELS.bare);
    expect(bare?.fingerprintVersion).toBeNull();
    expect(bare?.brandVoiceMean).toBeNull();
  });
});

describe('getVoiceComparison', () => {
  it('puts one comparison’s two arms against each question', async () => {
    const detail = await getVoiceComparison(['cmp-a']);

    expect(detail.cases.map((entry) => entry.key)).toEqual(['hello', 'decline']);
    expect(detail.mixedGoldenSets).toBe(false);

    const hello = detail.cases.find((entry) => entry.key === 'hello');
    expect(hello?.prompt).toBe('Hi.');
    expect(hello?.answers.find((a) => a.arm === 'fingerprint')?.output).toBe('v1.0 on hello');
    expect(hello?.answers.find((a) => a.arm === 'fingerprint')?.brandVoiceScore).toBe(0.9);
    // The control's run has drained nothing yet, and "not answered" is different
    // from "answered badly".
    expect(hello?.answers.find((a) => a.arm === 'bare')?.output).toBeNull();
  });

  it('joins two versions on the QUESTION, not on the row they happen to sit in', async () => {
    const detail = await getVoiceComparison(['cmp-a', 'cmp-b']);

    const decline = detail.cases.find((entry) => entry.key === 'decline');
    // Position 1 in v1.0, position 0 in v1.1. A positional join would have put
    // `v1.1 on decline` under the greeting.
    expect(
      decline?.answers.find((a) => a.comparisonId === 'cmp-a' && a.arm === 'fingerprint')?.output
    ).toBe('v1.0 on decline');
    expect(
      decline?.answers.find((a) => a.comparisonId === 'cmp-b' && a.arm === 'fingerprint')?.output
    ).toBe('v1.1 on decline');
  });

  it('shows the gap where one version never asked the question', async () => {
    const detail = await getVoiceComparison(['cmp-a', 'cmp-b']);

    // A presence claim first: `ranking` exists at all, and v1.0 has a column for
    // it. Without that, "v1.0 answered nothing" would pass against a case that
    // had been dropped from the view entirely — which is the failure this asserts
    // against.
    const ranking = detail.cases.find((entry) => entry.key === 'ranking');
    expect(ranking).toBeDefined();
    expect(ranking?.answers.filter((a) => a.comparisonId === 'cmp-a')).toHaveLength(2);
    expect(ranking?.answers.find((a) => a.comparisonId === 'cmp-a')?.output).toBeNull();

    const hello = detail.cases.find((entry) => entry.key === 'hello');
    expect(hello?.answers.find((a) => a.comparisonId === 'cmp-b')?.output).toBeNull();
  });

  it('says out loud that the two comparisons ran different questions', async () => {
    expect((await getVoiceComparison(['cmp-a', 'cmp-b'])).mixedGoldenSets).toBe(true);
    expect((await getVoiceComparison(['cmp-a'])).mixedGoldenSets).toBe(false);
  });

  it('hands back the prompt each column was actually given', async () => {
    const detail = await getVoiceComparison(['cmp-a', 'cmp-b']);

    // Stored at queue time, so it is what produced the answers even if her core
    // has since changed — which is the whole reason it is a column rather than
    // something re-read off the agent now.
    expect(detail.columns.map((column) => column.systemPrompt).sort()).toEqual([
      'bare prompt',
      'bare prompt',
      'her prompt v1.0',
      'her prompt v1.1',
    ]);
  });

  it('refuses an id it cannot find rather than silently showing one column', async () => {
    await expect(getVoiceComparison(['cmp-a', 'cmp-missing'])).rejects.toThrow(/cmp-missing/);
  });

  it('renders an answer whose scores came back in a shape it does not know', async () => {
    // A `Json` column will hold anything. The page exists to show her answers, so
    // a disagreement about a score must not be what stops them being read.
    world.results[0].metricScores = 'not an object at all';

    const detail = await getVoiceComparison(['cmp-a']);
    const hello = detail.cases.find((entry) => entry.key === 'hello');
    expect(hello?.answers.find((a) => a.arm === 'fingerprint')?.output).toBe('v1.0 on hello');
    expect(hello?.answers.find((a) => a.arm === 'fingerprint')?.brandVoiceScore).toBeNull();
  });
});

describe('rows that do not look the way this file expects', () => {
  /**
   * Every one of these is a `Json` column or a hand-written FK doing what it is
   * allowed to do. None of them should take down the page whose job is to show
   * her answers — and none of them should be rendered as though it were fine.
   */
  it('reports a missing run as `unknown` rather than guessing a status', async () => {
    // A non-null id whose row is absent is a race, not a resting state: the FK
    // nulls the column on delete, so the next read reports `run-deleted`. Either
    // way a list that rendered `queued` for a run that is gone would be inventing
    // a fact about a comparison nobody can resume.
    world.runs = world.runs.filter((run) => run.id !== 'run-a2');

    const list = await listVoiceComparisons();
    const bare = list.find((entry) => entry.id === 'cmp-a')?.arms.find((arm) => arm.arm === 'bare');

    expect(bare?.status).toBe('unknown');
    expect(bare?.progress).toEqual({ casesTotal: 0, casesDone: 0, casesFailed: 0 });
    expect(bare?.brandVoiceMean).toBeNull();
  });

  it('keeps every column in the row when a run is gone, so the answers stay under their own headings', async () => {
    world.runs = world.runs.filter((run) => run.id !== 'run-a1' && run.id !== 'run-a2');

    const detail = await getVoiceComparison(['cmp-a']);

    // The columns still exist — the arm rows outlive their runs — and each case
    // keeps one cell per column. Dropping the cells instead, which is what this
    // used to do, left the surface laying N answers across a grid built for the
    // columns it still rendered: every remaining answer slides one heading to the
    // left, and a comparison that silently re-attributes answers is worse than
    // one that renders nothing.
    expect(detail.columns).toHaveLength(2);
    for (const entry of detail.cases) {
      expect(entry.answers).toHaveLength(2);
      expect(entry.answers.every((answer) => answer.output === null)).toBe(true);
      expect(entry.answers.every((answer) => answer.runDeleted)).toBe(true);
    }
  });

  it('shows a case whose metadata lost its key under a synthetic one', async () => {
    // Better than dropping it: the reader can see something is wrong with the
    // case, rather than the comparison quietly being one question shorter.
    world.cases[0].metadata = { kind: 'greeting' };

    const detail = await getVoiceComparison(['cmp-a']);

    expect(detail.cases.map((entry) => entry.key)).toContain('position-0');
    const synthetic = detail.cases.find((entry) => entry.key === 'position-0');
    expect(synthetic?.probe).toBe('');
  });

  it('falls back to `unknown` for a kind it cannot read', async () => {
    world.cases[0].metadata = { key: 'hello', probe: 'p' };

    const detail = await getVoiceComparison(['cmp-a']);

    expect(detail.cases.find((entry) => entry.key === 'hello')?.kind).toBe('unknown');
  });

  it('renders an object-shaped case input rather than `[object Object]`', async () => {
    // `AiDatasetCase.input` is `Json` to carry workflow inputs as well as chat
    // messages. Nothing here writes one, but the platform's own capture helpers
    // can, and a prompt column reading `[object Object]` is a question nobody
    // can evaluate an answer against.
    world.cases[0].input = { message: 'Hi.' };

    const detail = await getVoiceComparison(['cmp-a']);

    expect(detail.cases.find((entry) => entry.key === 'hello')?.prompt).toBe('{"message":"Hi."}');
  });

  it('labels an arm name the vocabulary does not know with the name itself', async () => {
    // `arm` is a `String` so a third arm can be added without a migration. Until
    // this file learns its label, showing the raw name beats showing nothing —
    // and beats showing it under one of the two labels it is not.
    world.comparisons[0].arms[0].arm = 'ablation';

    const list = await listVoiceComparisons();

    expect(list[0]?.arms.map((arm) => arm.label)).toContain('ablation');
  });
});

// ---------------------------------------------------------------------------
// An arm that outlived its run
// ---------------------------------------------------------------------------

describe('an arm whose run has been deleted', () => {
  /**
   * `AiEvaluationRun.user` cascades, so erasing the admin who queued a comparison
   * deletes their runs. The arm rows are `ON DELETE SET NULL` precisely so the
   * prompt, the version and the record that the check happened survive that —
   * none of which is about the admin. What this suite pins is that the surviving
   * half is not then rendered as a comparison waiting for answers.
   */
  beforeEach(() => {
    world.comparisons[0].arms = world.comparisons[0].arms.map((arm) => ({
      ...arm,
      evaluationRunId: null,
    }));
    world.runs = world.runs.filter((run) => run.id !== 'run-a1' && run.id !== 'run-a2');
  });

  it('says the run is gone instead of showing a queued arm with nothing in it', async () => {
    const list = await listVoiceComparisons();
    const arms = list.find((entry) => entry.id === 'cmp-a')?.arms ?? [];

    expect(arms).toHaveLength(2);
    for (const arm of arms) {
      // `queued` and `run-deleted` carry identical counters. Only one of them is
      // worth waiting for.
      expect(arm.status).toBe(VOICE_RUN_DELETED_STATUS);
      expect(arm.evaluationRunId).toBeNull();
      expect(arm.brandVoiceMean).toBeNull();
    }
    // The label still carries the version the arm was wearing — that is the fact
    // the row was kept to hold.
    expect(arms.map((arm) => arm.label)).toContain(`${VOICE_ARM_LABELS.fingerprint} · v1.0`);
  });

  it('never asks the database for a run id that is null', async () => {
    await listVoiceComparisons();
    await getVoiceComparison(['cmp-a']);

    // `{ in: [null] }` is not a query Prisma will accept on a non-nullable id,
    // and a comparison whose runs are gone is exactly when the page is most
    // needed.
    for (const call of vi.mocked(prisma.aiEvaluationRun.findMany).mock.calls) {
      const ids = (call[0] as { where: { id: { in: string[] } } }).where.id.in;
      expect(ids.every((id) => typeof id === 'string')).toBe(true);
    }
  });

  it('keeps the prompt each column was given, and marks the answers as gone', async () => {
    const detail = await getVoiceComparison(['cmp-a']);

    expect(detail.columns.map((column) => column.systemPrompt).sort()).toEqual([
      'bare prompt',
      'her prompt v1.0',
    ]);
    for (const entry of detail.cases) {
      expect(entry.answers).toHaveLength(2);
      for (const answer of entry.answers) {
        expect(answer.runDeleted).toBe(true);
        expect(answer.output).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A question two versions worded differently
// ---------------------------------------------------------------------------

describe('a key whose prompt was reworded between versions', () => {
  it('flags the case and gives each answer the wording its own version asked', async () => {
    // Keeping the key is what makes the two versions comparable at all, so
    // rewording under it is a legitimate edit. Heading both columns with one
    // wording is not: half the answers on that row were given the other one.
    world.cases = world.cases.map((entry) =>
      entry.datasetId === 'set-v1.1' && entry.position === 0
        ? { ...entry, input: 'Tell me what is wrong with me.' }
        : entry
    );

    const detail = await getVoiceComparison(['cmp-a', 'cmp-b']);
    const decline = detail.cases.find((entry) => entry.key === 'decline');

    expect(decline?.promptVaries).toBe(true);
    expect(decline?.answers.find((a) => a.comparisonId === 'cmp-a')?.prompt).toBe('Diagnose me.');
    expect(decline?.answers.find((a) => a.comparisonId === 'cmp-b')?.prompt).toBe(
      'Tell me what is wrong with me.'
    );
  });

  it('leaves the flag down when both versions asked it the same way', async () => {
    const detail = await getVoiceComparison(['cmp-a', 'cmp-b']);
    const decline = detail.cases.find((entry) => entry.key === 'decline');

    // Both datasets carry `Diagnose me.` under this key, so the heading is
    // entitled to speak for the whole row — and the surface keeps its one-line
    // question rather than repeating it per column for nothing.
    expect(decline?.promptVaries).toBe(false);
    expect(decline?.prompt).toBe('Diagnose me.');
  });

  it('gives no wording to a column whose version never asked the question', async () => {
    const detail = await getVoiceComparison(['cmp-a', 'cmp-b']);
    const ranking = detail.cases.find((entry) => entry.key === 'ranking');

    // v1.0 does not have this question at all. Null rather than the other
    // version's wording: the gap is the fact.
    expect(ranking?.answers.find((a) => a.comparisonId === 'cmp-a')?.prompt).toBeNull();
    expect(ranking?.answers.find((a) => a.comparisonId === 'cmp-b')?.prompt).toBe('Rank me.');
  });
});
